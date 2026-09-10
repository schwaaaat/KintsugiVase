import { cleanLine, tokenizeLine } from './tokenizer';
import { KinematicStateMachine } from './state-machine';
import { continuousConnection } from './junction-connection';
import { SpiralSurface } from './spiral-surface';
import { alignFlatTurnToBaseContour, emitFlatTurn, FlatTurnPlan, planFlatTurn } from './flat-turn';
import {
  extractPhysicalZ,
  extractXY,
  findClosestApproach,
  getLayerZFromComment,
  locateOuterWallFirstEntry,
  locateOuterWallLastExit,
  reorderLayerOuterWallFirstAt,
  rotateLastOuterWallSeam,
  trimAfterLastDepositingMove,
  MATCH_THRESHOLD_MM,
  scanForZCrossing,
  truncateMoveAtZ,
  generateOuterWallLapExtension,
  computeTangentialLeadIn,
} from './seam-solver';
import { applySpeedRamp, OutputGCodeObject } from './flow-modulator';
import { emitTransitionBlock } from './emitter';
import { SeamMatchResult, SlicerMeta, SplicerOptions, SplicerResult } from './types';

export function parseTimeStr(str: string): number {
  if (!str) return 0;
  let total = 0;
  const h = str.match(/(\d+)h/i);
  const m = str.match(/(\d+)m/i);
  const s = str.match(/(\d+)s/i);
  if (h) total += parseInt(h[1], 10) * 3600;
  if (m) total += parseInt(m[1], 10) * 60;
  if (s) total += parseInt(s[1], 10);
  return total;
}

export function extractSlicerMeta(linesArray: string[]): SlicerMeta {
  let time = 0;
  let maxZ = 0.1;
  const scanRange = [...linesArray.slice(0, 2000), ...linesArray.slice(-2000)];
  for (const line of scanRange) {
    if (!time) {
      const tMatch = line.match(/(?:total estimated time|model printing time)[ :=]+([0-9hms ]+)/i);
      if (tMatch) time = parseTimeStr(tMatch[1]);
    }
    if (maxZ === 0.1) {
      const zMatch = line.match(/max_z_height:[ \t]*([-0-9.]+)/i);
      if (zMatch) maxZ = parseFloat(zMatch[1]);
    }
  }
  return {
    time,
    maxZ,
    filamentUsedMM: 0,
    filamentType: 'PLA',
    hasZHop: false,
  };
}

export interface CollectBandOptions {
  flowMultiplier: number;
  isFirstBand: boolean;
  isLastBand: boolean;
  taperEnabled: boolean;
  taperDistanceMM: number;
  taperStartRatio: number;
  resumeX: number;
  resumeY: number;
  startZ: number;
}

export function collectBandContent(
  lines: string[],
  startLineIndex: number,
  zEnd: number,
  useFineStopDetection: boolean,
  opts: CollectBandOptions
): {
  outputObjs: OutputGCodeObject[];
  extrudedE: number;
  layerCount: number;
  minExtrudedZ: number | null;
  maxExtrudedZ: number;
  foundAnyLayer: boolean;
} {
  let isRelativeE = true;
  let lastE = 0;
  let currentF = 3000;
  let currentPrintF = 3000;
  let curZ = opts.startZ || 0;
  let started = false;
  let extrudedE = 0;
  let layerCount = 0;
  let minExtrudedZ: number | null = null;
  let maxExtrudedZ = 0;
  let taperCumDist = 0;
  let taperActive = !opts.isFirstBand && opts.taperEnabled && opts.taperDistanceMM > 0;
  let px = opts.resumeX || 0;
  let py = opts.resumeY || 0;
  const outputObjs: OutputGCodeObject[] = [];

  for (let i = startLineIndex; i < lines.length; i++) {
    const line = lines[i];
    let outLine = line;
    const cleaned = cleanLine(outLine);

    if (cleaned.match(/^M82/)) isRelativeE = false;
    if (cleaned.match(/^M83/)) isRelativeE = true;
    if (cleaned.match(/^G92.*[Ee]0/)) lastE = 0;

    const czStop = getLayerZFromComment(line);
    if (czStop !== null) {
      started = true;
      if (!useFineStopDetection && !opts.isLastBand && czStop > zEnd + 1e-6) break;
    } else if (useFineStopDetection && started && !opts.isLastBand) {
      const pzStop = extractPhysicalZ(line);
      const eMatchStop = cleaned.match(/^[Gg][0-3]\b.*[Ee]([+-]?[0-9.]+)/);
      if (pzStop !== null && eMatchStop && parseFloat(eMatchStop[1]) > 0 && pzStop >= zEnd - 1e-6) {
        if (curZ < zEnd - 1e-6) {
          const trunc = truncateMoveAtZ(outLine, curZ, pzStop, zEnd, px, py);
          if (trunc) {
            const eRaw = parseFloat(eMatchStop[1]);
            const eDeltaFull = isRelativeE ? eRaw : eRaw - lastE;
            const eDeltaTrunc = eDeltaFull * trunc.f;
            const truncText =
              `G1 X${trunc.tx.toFixed(3)} Y${trunc.ty.toFixed(3)} Z${zEnd.toFixed(4)}` +
              (trunc.feed ? ` F${trunc.feed}` : '') +
              (eDeltaTrunc > 0 ? ` E${eDeltaTrunc.toFixed(5)}` : '') +
              ` ; Kintsugi: truncated multi-turn move at transition boundary`;
            if (eDeltaTrunc > 0) {
              extrudedE += eDeltaTrunc;
              if (minExtrudedZ === null) minExtrudedZ = zEnd;
              if (zEnd > maxExtrudedZ) maxExtrudedZ = zEnd;
              currentPrintF = currentF;
            }
            outputObjs.push({ text: truncText, isExtrusion: eDeltaTrunc > 0, origF: currentPrintF, z: zEnd });
          }
        }
        break;
      }
    }

    const { x: lx, y: ly } = extractXY(outLine);
    const nx = lx !== null ? lx : px;
    const ny = ly !== null ? ly : py;
    const xyLen = Math.hypot(nx - px, ny - py);

    let effMultiplier = opts.flowMultiplier;
    if (taperActive) {
      const ratio =
        opts.taperStartRatio + (1 - opts.taperStartRatio) * Math.min(1, taperCumDist / opts.taperDistanceMM);
      effMultiplier *= ratio;
    }
    if (effMultiplier !== 1.0) {
      outLine = outLine.replace(/([Ee])([+-]?[0-9.]+)/, (_m, p1, p2) => {
        let eVal = parseFloat(p2);
        if (eVal > 0 || !isRelativeE) eVal *= effMultiplier;
        return p1 + eVal.toFixed(5);
      });
    }

    if (czStop !== null) {
      // A spiral's declared layer top is not its current physical Z.
      if (!useFineStopDetection) curZ = czStop;
      layerCount++;
    } else {
      const pzOut = extractPhysicalZ(outLine);
      if (pzOut !== null) curZ = pzOut;
    }

    const fMatch = cleaned.match(/[Ff]([+-]?[0-9.]+)/);
    if (fMatch) currentF = parseFloat(fMatch[1]);

    const eMatch = cleaned.match(/^[Gg][0-3]\b.*[Ee]([+-]?[0-9.]+)/);
    let isExtr = false;
    if (eMatch) {
      const eRaw = parseFloat(eMatch[1]);
      const eDelta = isRelativeE ? eRaw : eRaw - lastE;
      if (eDelta > 0) {
        extrudedE += eDelta;
        isExtr = true;
        currentPrintF = currentF;
        if (minExtrudedZ === null) minExtrudedZ = curZ;
        if (curZ > maxExtrudedZ) maxExtrudedZ = curZ;
        if (taperActive) {
          taperCumDist += xyLen;
          if (taperCumDist >= opts.taperDistanceMM) taperActive = false;
        }
      }
      lastE = eRaw;
    }
    px = nx;
    py = ny;

    outputObjs.push({ text: outLine, isExtrusion: isExtr, origF: currentPrintF, z: curZ });
  }

  return { outputObjs, extrudedE, layerCount, minExtrudedZ, maxExtrudedZ, foundAnyLayer: started };
}

export function spliceGcode(baseText: string, vaseText: string, options: SplicerOptions): SplicerResult {
  const sortedTransitions = [...new Set(options.transitions)].filter((z) => isFinite(z) && z > 0).sort((a, b) => a - b);
  if (sortedTransitions.length === 0) {
    throw new Error('At least one transition height must be specified.');
  }

  const junctionOptions = sortedTransitions.map(z => ({ ...options, ...Object.fromEntries(
    Object.entries(options.junctions?.find(j => j.z === z)?.overrides ?? {}).filter(([, value]) => value !== undefined)
  ) }));
  const generatedBlocks: string[] = [];
  const planarPlans: (FlatTurnPlan | null)[] = new Array(sortedTransitions.length).fill(null);
  const baseLines = baseText.split('\n');
  const vaseLines = vaseText.split('\n');
  const fileLines = { base: baseLines, vase: vaseLines };
  const fileMeta = { base: extractSlicerMeta(baseLines), vase: extractSlicerMeta(vaseLines) };

  let nominalLayerHeight = 0.2;
  for (const line of baseLines.slice(0, 2000)) {
    const hm = line.match(/\b(?:HEIGHT|layer_height)[ \t]*[:=][ \t]*([-0-9.]+)/i);
    if (hm) {
      nominalLayerHeight = parseFloat(hm[1]);
      break;
    }
  }

  let vaseNominalLayerHeight = 0.2;
  for (const line of vaseLines.slice(0, 2000)) {
    const hm = line.match(/\b(?:HEIGHT|layer_height)[ \t]*[:=][ \t]*([-0-9.]+)/i);
    if (hm) {
      vaseNominalLayerHeight = parseFloat(hm[1]);
      break;
    }
  }

  const isBaseFirst = (options.firstMode ?? 'base') === 'base';
  const boundaries = [0, ...sortedTransitions, Infinity];
  interface Band {
    sourceKey: 'base' | 'vase';
    zStart: number;
    zEnd: number;
    isFirstBand: boolean;
    isLastBand: boolean;
  }
  const bands: Band[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const isBase = isBaseFirst ? i % 2 === 0 : i % 2 !== 0;
    bands.push({
      sourceKey: isBase ? 'base' : 'vase',
      zStart: boundaries[i],
      zEnd: boundaries[i + 1],
      isFirstBand: i === 0,
      isLastBand: i === boundaries.length - 2,
    });
  }
  for (let bandIdx = 0; bandIdx < bands.length; bandIdx++) {
    const band = bands[bandIdx];
    if (band.sourceKey === 'vase' && !band.isFirstBand && !band.isLastBand &&
        junctionOptions[bandIdx - 1]?.planarTransitionEnabled && junctionOptions[bandIdx]?.planarTransitionEnabled) {
      const minimumPlanarSpan = nominalLayerHeight + 3 * vaseNominalLayerHeight;
      if (band.zEnd - band.zStart < minimumPlanarSpan - 1e-6) {
        throw new Error(`Transitions at ${band.zStart.toFixed(2)}mm and ${band.zEnd.toFixed(2)}mm are too close for complete planar turns.`);
      }
    }
  }
  const spiralSurface = junctionOptions.some(local => local.planarTransitionEnabled)
    ? new SpiralSurface(vaseText) : null;

  const seamMatches: (SeamMatchResult | null)[] = new Array(sortedTransitions.length).fill(null);

  for (let k = 0; k < sortedTransitions.length; k++) {
    const isVaseToBase = bands[k].sourceKey === 'vase';
    const z = sortedTransitions[k];
    const local = junctionOptions[k];
  const seamMatchEnabled = local.seamMatchEnabled ?? true;
  const seamMatchBeforeMM =
    (local.seamMatchLayersBefore ?? 1) * Math.max(nominalLayerHeight, vaseNominalLayerHeight);
  const seamMatchAfterMM =
    (local.seamMatchLayersAfter ?? 1) * Math.max(nominalLayerHeight, vaseNominalLayerHeight);


    if (isVaseToBase) {
      const entry = locateOuterWallFirstEntry(baseLines, z);
      if (!entry) continue;
      let matchedZ: number | null = null;
      let distance: number | null = null;
      let approach = null;
      if (seamMatchEnabled && entry.reordered.outerStartX !== null && entry.reordered.outerStartY !== null) {
        approach = findClosestApproach(
          vaseLines,
          entry.reordered.outerStartX,
          entry.reordered.outerStartY,
          z,
          seamMatchBeforeMM,
          seamMatchAfterMM
        );
        if (approach && approach.distance <= MATCH_THRESHOLD_MM) {
          matchedZ = approach.z;
          distance = approach.distance;
        } else {
          approach = null;
        }
      }
      seamMatches[k] = { direction: 'vaseToBase', nominalZ: z, entry, matchedZ, distance, approach };
      if (local.planarTransitionEnabled && spiralSurface) {
        let plan = planFlatTurn(spiralSurface, {
          direction: 'exit', baseLayerZ: entry.startInfo.z,
          layerHeight: nominalLayerHeight,
          sourceLayerHeight: vaseNominalLayerHeight,
          adjacentLayerHeight: nominalLayerHeight,
          width: local.slicedWidth ?? 0.42,
          speed: local.transSpeed ?? 20,
          samples: local.planarSamples,
        });
        entry.reordered = reorderLayerOuterWallFirstAt(entry.layerLines, entry.startInfo.x, entry.startInfo.y,
          plan.crossing.x, plan.crossing.y);
        if (local.seamMatchEnabled === false) throw new Error(`Level transition at ${z.toFixed(2)}mm requires seam matching.`);
        if (!entry.reordered.outerPath) throw new Error(`Could not align a complete base outer-wall contour for the level transition at ${z.toFixed(2)}mm.`);
        plan = alignFlatTurnToBaseContour(plan, spiralSurface, entry.reordered.outerPath, {
          layerHeight: nominalLayerHeight, width: local.slicedWidth ?? 0.42,
          speed: local.transSpeed ?? 20, samples: local.planarSamples,
        });
        planarPlans[k] = plan;
        const d = Math.hypot(plan.crossing.x - (entry.reordered.outerStartX ?? plan.crossing.x),
          plan.crossing.y - (entry.reordered.outerStartY ?? plan.crossing.y));
        const scan = scanForZCrossing(vaseLines, plan.planeZ, true);
        approach = scan ? { ...scan, lineIndex: plan.crossing.line, x: plan.crossing.x, y: plan.crossing.y, z: plan.planeZ, distance: d } : null;
        seamMatches[k] = { direction: 'vaseToBase', nominalZ: z, entry,
          matchedZ: d <= MATCH_THRESHOLD_MM ? plan.planeZ : null,
          distance: d, approach: d <= MATCH_THRESHOLD_MM ? approach : null };
      }
    } else {
      const exit = locateOuterWallLastExit(baseLines, z);
      if (!exit) continue;
      let matchedZ: number | null = null;
      let distance: number | null = null;
      let approach = null;
      if (seamMatchEnabled && exit.reordered.outerEndX !== null && exit.reordered.outerEndY !== null) {
        // Invariant: forward-only search for base->vase
        approach = findClosestApproach(
          vaseLines,
          exit.reordered.outerEndX,
          exit.reordered.outerEndY,
          z,
          0,
          seamMatchAfterMM
        );
        if (approach && approach.distance <= MATCH_THRESHOLD_MM) {
          matchedZ = approach.z;
          distance = approach.distance;
        } else {
          approach = null;
        }
      }
      seamMatches[k] = { direction: 'baseToVase', nominalZ: z, exit, matchedZ, distance, approach };
      if (local.planarTransitionEnabled && spiralSurface) {
        const baseLayerZ = exit.layerLines.map(getLayerZFromComment).filter((value): value is number => value !== null)
          .reduce((highest, value) => Math.max(highest, value), 0);
        let plan = planFlatTurn(spiralSurface, {
          direction: 'entry', baseLayerZ,
          layerHeight: vaseNominalLayerHeight,
          sourceLayerHeight: vaseNominalLayerHeight,
          adjacentLayerHeight: nominalLayerHeight,
          width: local.slicedWidth ?? 0.42,
          speed: local.transSpeed ?? 20,
          samples: local.planarSamples,
        });
        exit.reordered = rotateLastOuterWallSeam(exit.reordered, plan.crossing.x, plan.crossing.y);
        if (local.seamMatchEnabled === false) throw new Error(`Level transition at ${z.toFixed(2)}mm requires seam matching.`);
        if (!exit.reordered.outerPath) throw new Error(`Could not align a complete base outer-wall contour for the level transition at ${z.toFixed(2)}mm.`);
        plan = alignFlatTurnToBaseContour(plan, spiralSurface, exit.reordered.outerPath, {
          layerHeight: vaseNominalLayerHeight, width: local.slicedWidth ?? 0.42,
          speed: local.transSpeed ?? 20, samples: local.planarSamples,
        });
        planarPlans[k] = plan;
        const d = Math.hypot(plan.crossing.x - (exit.reordered.outerEndX ?? plan.crossing.x),
          plan.crossing.y - (exit.reordered.outerEndY ?? plan.crossing.y));
        const scan = scanForZCrossing(vaseLines, plan.planeZ, true);
        approach = scan ? { ...scan, lineIndex: plan.crossing.line, x: plan.crossing.x, y: plan.crossing.y, z: plan.planeZ, distance: d } : null;
        seamMatches[k] = { direction: 'baseToVase', nominalZ: z, exit,
          matchedZ: d <= MATCH_THRESHOLD_MM ? plan.planeZ : null,
          distance: d, approach: d <= MATCH_THRESHOLD_MM ? approach : null };
      }
    }
  }

  const outputLines: string[] = [
    `; Generated by KintsugiVase 2.0`,
    `; Initial Mode: ${options.firstMode ?? 'base'}`,
  ];
  let totalExtrudedE = 0;
  let finalLayerCount = 0;
  let estimatedSeconds = 0;
  let anyLayersFound = false;
  const emittedState = new KinematicStateMachine();
  let emittedCursor = 0;
  let retractDebt = 0;
  let relativeXYZ = false;
  function trackEmitted() {
    while (emittedCursor < outputLines.length) {
      for (const line of outputLines[emittedCursor++].split('\n')) {
        if (/^\s*G91\b/i.test(line)) relativeXYZ = true;
        if (/^\s*G90\b/i.test(line)) relativeXYZ = false;
        const result = emittedState.process(tokenizeLine(line));
        retractDebt = Math.max(0, retractDebt - result.deltaE);
      }
    }
  }

  for (let bandIdx = 0; bandIdx < bands.length; bandIdx++) {
    const band = bands[bandIdx];
    const incoming = band.isFirstBand ? options : junctionOptions[bandIdx - 1];
    const outgoing = band.isLastBand ? options : junctionOptions[bandIdx];
  let flowMultiplier = incoming.flowMultiplier ?? 1.0;
  if (incoming.useWallThickness && incoming.slicedWidth && incoming.targetWidth) {
    flowMultiplier *= incoming.targetWidth / incoming.slicedWidth;
  }

  const hopHeight = incoming.hopHeight ?? 0.4;
  const travelSpeed = incoming.travelSpeed ?? 3000;
  const primeSpeed = incoming.primeSpeed ?? 1800;
  const taperEnabled = incoming.taperEnabled ?? false;
  const taperDistanceMM = incoming.taperDistanceMM ?? 0;
  const taperStartRatio = Math.max(0, Math.min(1, incoming.taperStartRatio ?? 0.25));
  const overlapEnabled = incoming.overlapEnabled ?? true;
  const overlapDistanceMM = Math.max(0, incoming.overlapDistanceMM ?? 8.0);
  const leadInEnabled = incoming.leadInEnabled ?? true;
  const leadInDistanceMM = Math.max(0, incoming.leadInDistanceMM ?? 1.5);


    const overrideTemp = incoming.transTemp ?? null;
    const overrideFan = incoming.transFan ?? null;
    const lines = fileLines[band.sourceKey];
    const useFineDetection = band.sourceKey === 'vase';
    const isSwitchingFromVaseToBase =
      !band.isFirstBand && band.sourceKey === 'base' && bands[bandIdx - 1].sourceKey === 'vase';
    const isSwitchingFromBaseToVase =
      !band.isLastBand && band.sourceKey === 'base' && bands[bandIdx + 1].sourceKey === 'vase';

    let startInfo: {
      lineIndex: number;
      x: number;
      y: number;
      z: number;
      tempHotend: string | null;
      tempWait: string | null;
      fan: string | null;
      foundAnyLayer: boolean;
    };

    if (band.isFirstBand) {
      startInfo = {
        lineIndex: 0,
        x: 0,
        y: 0,
        z: 0,
        tempHotend: null,
        tempWait: null,
        fan: null,
        foundAnyLayer: false,
      };
    } else {
      const incomingSeam = seamMatches[bandIdx - 1];
      if (band.sourceKey === 'vase' && incomingSeam && incomingSeam.matchedZ !== null && incomingSeam.approach) {
        const a = incomingSeam.approach;
        startInfo = {
          lineIndex: a.lineIndex,
          x: a.x,
          y: a.y,
          z: a.z,
          tempHotend: a.tempHotend,
          tempWait: a.tempWait,
          fan: a.fan,
          foundAnyLayer: a.foundAnyLayer,
        };
      } else {
        const scanRes = scanForZCrossing(lines, band.zStart, useFineDetection);
        if (!scanRes) {
          throw new Error(
            `The ${band.sourceKey} file never reaches ${band.zStart.toFixed(
              2
            )}mm — check that each transition height is within both files' height range.`
          );
        }
        startInfo = scanRes;
      }
    }

    let effectiveLines = lines;
    const planarEntry = band.sourceKey === 'vase' && !band.isFirstBand && planarPlans[bandIdx - 1]?.direction === 'entry'
      ? planarPlans[bandIdx - 1] : null;
    const planarExit = band.sourceKey === 'vase' && !band.isLastBand && planarPlans[bandIdx]?.direction === 'exit'
      ? planarPlans[bandIdx] : null;
    const planarEntryEndZ = planarEntry?.blendPoints?.at(-1)?.z ?? planarEntry?.planeZ;
    const planarExitStartZ = planarExit?.cutZ ?? planarExit?.planeZ;
    if (planarEntry && planarExit && planarEntryEndZ !== undefined && planarExitStartZ !== undefined &&
        planarEntryEndZ >= planarExitStartZ - 1e-6) {
      throw new Error(`Transitions at ${band.zStart.toFixed(2)}mm and ${band.zEnd.toFixed(2)}mm are too close for complete planar turns.`);
    }
    if (planarEntry && spiralSurface) {
      const remainder = spiralSurface.remainderAfter(planarEntry.resumeQ ?? planarEntry.crossingQ);
      const generated = [`;Z:${planarEntry.planeZ.toFixed(4)}`, ...emitFlatTurn(planarEntry),
        ...remainder.points.slice(1).map((point, index) =>
          `G1 X${point.x.toFixed(3)} Y${point.y.toFixed(3)} Z${point.z.toFixed(4)} E${point.e.toFixed(5)}${index === 0 ? ` F${point.f.toFixed(0)}` : ''} ; Kintsugi: resume source move`)
      ];
      effectiveLines = [...lines.slice(0, planarEntry.crossing.line), ...generated, ...lines.slice(remainder.nextLine)];
      startInfo = { ...startInfo, lineIndex: planarEntry.crossing.line,
        x: planarEntry.handoff?.x ?? planarEntry.crossing.x,
        y: planarEntry.handoff?.y ?? planarEntry.crossing.y, z: planarEntry.planeZ };
    }
    const reorderSpans: { start: number; end: number; replacement: string[] }[] = [];
    if (isSwitchingFromVaseToBase && startInfo.lineIndex < lines.length) {
      const seamInfo = seamMatches[bandIdx - 1];
      const entry = seamInfo && seamInfo.entry ? seamInfo.entry : locateOuterWallFirstEntry(lines, band.zStart);
      if (entry && (entry.reordered.wasReordered || entry.reordered.outerStartX !== null)) {
        reorderSpans.push({ start: startInfo.lineIndex, end: entry.nextLayerIdx, replacement: entry.reordered.lines });
        if (entry.reordered.outerStartX !== null && entry.reordered.outerStartY !== null) {
          startInfo.x = entry.reordered.outerStartX;
          startInfo.y = entry.reordered.outerStartY;
        }
      }
    }

    if (isSwitchingFromBaseToVase) {
      const seamInfo = seamMatches[bandIdx];
      const exit = seamInfo && seamInfo.exit ? seamInfo.exit : locateOuterWallLastExit(lines, band.zEnd);
      const overlapsEntrySpan =
        exit && reorderSpans.some((s) => exit.layerStartIdx < s.end && exit.nextLayerIdx > s.start);
      if (exit && !overlapsEntrySpan && (exit.reordered.wasReordered || exit.reordered.outerEndX !== null)) {
        let replacementLines = [...exit.reordered.lines];
        if (planarPlans[bandIdx]?.direction === 'entry') {
          replacementLines = trimAfterLastDepositingMove(replacementLines);
        }
        if (!planarPlans[bandIdx] && (outgoing.overlapEnabled ?? true) && (outgoing.overlapDistanceMM ?? 8) > 0) {
          const lap = generateOuterWallLapExtension(exit.reordered.lines, outgoing.overlapDistanceMM ?? 8);
          if (lap.lines.length > 0) {
            replacementLines.push(...lap.lines);
          }
        }
        reorderSpans.push({ start: exit.layerStartIdx, end: exit.nextLayerIdx, replacement: replacementLines });
      }
    }

    if (reorderSpans.length > 0) {
      reorderSpans.sort((a, b) => a.start - b.start);
      const parts: string[] = [];
      let cursor = 0;
      for (const s of reorderSpans) {
        parts.push(...lines.slice(cursor, s.start));
        parts.push(...s.replacement);
        cursor = s.end;
      }
      parts.push(...lines.slice(cursor));
      effectiveLines = parts;
    }

    const outgoingSeamMatch = band.sourceKey === 'vase' && !band.isLastBand ? seamMatches[bandIdx] : null;
    const effectiveZEnd = planarExit?.cutZ ?? planarExit?.planeZ ??
      (outgoingSeamMatch && outgoingSeamMatch.matchedZ !== null ? outgoingSeamMatch.matchedZ : band.zEnd);

    const effectiveTaperEnabled = !planarEntry && (taperEnabled || (overlapEnabled && overlapDistanceMM > 0));
    const effectiveTaperDist = overlapEnabled && overlapDistanceMM > 0 ? overlapDistanceMM : taperDistanceMM;
    const effectiveTaperStartRatio = overlapEnabled && overlapDistanceMM > 0 ? 0.05 : taperStartRatio;

    const collected = collectBandContent(effectiveLines, startInfo.lineIndex, effectiveZEnd, useFineDetection, {
      flowMultiplier: band.sourceKey === 'vase' ? flowMultiplier : 1,
      isFirstBand: band.isFirstBand,
      isLastBand: band.isLastBand,
      taperEnabled: effectiveTaperEnabled,
      taperDistanceMM: effectiveTaperDist,
      taperStartRatio: effectiveTaperStartRatio,
      resumeX: startInfo.x,
      resumeY: startInfo.y,
      startZ: startInfo.z,
    });

    if (collected.foundAnyLayer) anyLayersFound = true;

    if (planarExit) {
      const flatLines = emitFlatTurn(planarExit, flowMultiplier);
      let generatedZ = planarExit.cutZ ?? planarExit.planeZ;
      let generatedF = (outgoing.transSpeed ?? 20) * 60;
      for (const text of flatLines) {
        const cmd = tokenizeLine(text);
        if (cmd.type === 'motion') {
          if (cmd.z !== undefined) generatedZ = cmd.z;
          if (cmd.f !== undefined) generatedF = cmd.f;
        }
        const isExtrusion = cmd.type === 'motion' && cmd.e !== undefined && cmd.e > 0;
        collected.outputObjs.push({ text, isExtrusion, origF: generatedF, z: generatedZ });
        if (isExtrusion) {
          if (collected.minExtrudedZ === null) collected.minExtrudedZ = generatedZ;
          collected.maxExtrudedZ = Math.max(collected.maxExtrudedZ, generatedZ);
        }
      }
    }

    // Before and after zones belong to different junctions in a middle band.
    for (const [local, before] of [[outgoing, true], [incoming, false]] as const) {
      if (!local.advSpeedEnabled) continue;
      applySpeedRamp(collected.outputObjs, {
        isFirstBand: band.isFirstBand,
        isLastBand: band.isLastBand,
        beforeZoneMM: before ? (local.transLayersBefore ?? 0) * nominalLayerHeight : 0,
        afterZoneMM: before ? 0 : (local.transLayersAfter ?? 0) * nominalLayerHeight,
        targetFMMmin: (local.transSpeed ?? 20) * 60,
        rampMode: local.rampMode !== 'flat',
        minExtrudedZ: collected.minExtrudedZ,
        maxExtrudedZ: collected.maxExtrudedZ,
      });
    }

    if (!band.isFirstBand) {
      const incomingSeamMatch = seamMatches[bandIdx - 1];
      const isMatched = !!(incomingSeamMatch && incomingSeamMatch.matchedZ !== null);
      const hopZ = Math.max(band.zStart, startInfo.z) + hopHeight;
      const incomingPlanar = planarPlans[bandIdx - 1];
      let bridgeE: number | undefined;
      let verticalOnly = false;
      if (isMatched && incomingPlanar) {
        trackEmitted();
        const state = emittedState.state;
        const xyDistance = Math.hypot(startInfo.x-state.x, startInfo.y-state.y);
        verticalOnly = xyDistance <= 0.05;
        if (xyDistance > 0.05) {
          const length = Math.hypot(xyDistance, startInfo.z-state.z);
          const bridgeHeight = band.sourceKey === 'vase' ? vaseNominalLayerHeight : nominalLayerHeight;
          const bridgeWidth = incoming.slicedWidth ?? 0.42;
          bridgeE = length * bridgeWidth * bridgeHeight / (Math.PI * (1.75/2) ** 2);
        }
      }

      let leadInCoords: { leadInX: number; leadInY: number } | undefined = undefined;
      if (leadInEnabled && leadInDistanceMM > 0) {
        let nextX = startInfo.x;
        let nextY = startInfo.y;
        for (let j = startInfo.lineIndex; j < Math.min(effectiveLines.length, startInfo.lineIndex + 50); j++) {
          const { x, y } = extractXY(effectiveLines[j]);
          if (x !== null && y !== null && (Math.abs(x - startInfo.x) > 0.1 || Math.abs(y - startInfo.y) > 0.1)) {
            nextX = x;
            nextY = y;
            break;
          }
        }
        leadInCoords = computeTangentialLeadIn(
          startInfo.x,
          startInfo.y,
          nextX,
          nextY,
          128,
          128,
          leadInDistanceMM
        );
      }

      const blockLines = emitTransitionBlock({
        matched: isMatched,
        distance: incomingSeamMatch?.distance ?? undefined,
        resumeX: startInfo.x,
        resumeY: startInfo.y,
        resumeZ: startInfo.z,
        leadInX: leadInCoords?.leadInX,
        leadInY: leadInCoords?.leadInY,
        hopZ,
        travelSpeed,
        primeSpeed,
        overrideTemp,
        overrideFan,
        tempHotend: startInfo.tempHotend,
        tempWait: startInfo.tempWait,
        fan: startInfo.fan,
        bridgeE,
        verticalOnly,
      });
      const custom = options.junctions?.find(j => j.z === band.zStart)?.gcode;
      if (incoming.continuousConnection && !planarEntry && custom?.replacement === undefined) {
        if (/^\s*(?:G(?:[0-3]|90|91|92)|M8[23])\b/im.test(custom?.before ?? '')) {
          throw new Error('Use a custom junction body when before-junction code changes motion or extrusion state.');
        }
        trackEmitted();
        const state = emittedState.state;
        const connection = continuousConnection({
          matched: isMatched, x: state.x, y: state.y, z: state.z,
          resumeX: startInfo.x, resumeY: startInfo.y, resumeZ: startInfo.z,
          retractDebt, relativeXYZ,
          layerHeight: nominalLayerHeight,
          width: (incoming.useWallThickness ? incoming.targetWidth : incoming.slicedWidth) ?? 0.42,
          speed: incoming.transSpeed ?? 20,
        });
        // Replace only the generated hand-off motion, retaining thermal commands.
        const direct = blockLines.findIndex(line => line.includes('direct travel to resume point'));
        if (direct !== -1) blockLines.splice(direct, 1, ...connection);
      }
      const generated = blockLines.join('\n');
      generatedBlocks[bandIdx - 1] = generated;
      if (custom) {
        for (const text of Object.values(custom)) {
          if (/KINTSUGIVASE TRANSITION/i.test(text ?? '')) throw new Error('Custom G-code must not contain reserved transition markers.');
        }
      }
      // Keep classification markers owned by the engine even when the body is edited.
      outputLines.push(blockLines[0]);
      if (custom?.before) outputLines.push('; Custom before junction', custom.before);
      outputLines.push(custom?.replacement ?? blockLines.slice(1, -1).join('\n'));
      if (custom?.after) outputLines.push('; Custom after junction', custom.after);
      outputLines.push(blockLines[blockLines.length - 1]);
    }

    for (const obj of collected.outputObjs) {
      outputLines.push(obj.text);
    }

    totalExtrudedE += collected.extrudedE;
    finalLayerCount += collected.layerCount;

    const meta = fileMeta[band.sourceKey];
    if (meta.maxZ > 0) {
      const bandZEnd = isFinite(band.zEnd) ? Math.min(band.zEnd, meta.maxZ) : meta.maxZ;
      const bandHeight = Math.max(0, bandZEnd - band.zStart);
      estimatedSeconds += meta.time * (bandHeight / meta.maxZ);
    }
  }

  if (!anyLayersFound) {
    throw new Error('No print layers found in the uploaded files. Check that the G-code is valid and exported correctly.');
  }

  const previewTransitions = sortedTransitions.map((z, k) =>
    seamMatches[k] && seamMatches[k]!.matchedZ !== null ? seamMatches[k]!.matchedZ! : z
  );

  const transitionSummaries: SplicerResult['transitions'] = sortedTransitions.map((z, k) => ({
    nominalZ: z,
    generatedGcode: generatedBlocks[k] ?? '',
    customGcode: Object.entries(options.junctions?.find(j => j.z === z)?.gcode ?? {}).some(([key, v]) => key === 'replacement' ? v !== undefined : !!v),
    planarTransition: planarPlans[k]?.direction === 'entry' ? 'bondingLoop' : planarPlans[k]?.direction === 'exit' ? 'supportingRim' : null,
    matchedZ: seamMatches[k]?.matchedZ ?? null,
    distance: seamMatches[k]?.distance ?? null,
    direction:
      seamMatches[k]?.direction ??
      ((bands[k].sourceKey === 'vase' ? 'vaseToBase' : 'baseToVase') as 'vaseToBase' | 'baseToVase'),
  }));

  // Include emitted flow adjustments and custom junction extrusion in the estimate.
  trackEmitted();
  totalExtrudedE = emittedState.state.totalExtrudedE;

  return {
    splicedGcode: outputLines.join('\n'),
    estimatedSeconds,
    totalExtrudedE,
    finalLayerCount,
    transitions: transitionSummaries,
    previewTransitions,
  };
}
