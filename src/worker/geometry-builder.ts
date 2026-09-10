import { cleanLine } from '../core/tokenizer';
import { extractPhysicalZ, extractXY } from '../core/seam-solver';
import { classifyType } from '../core/flow-modulator';
import { tessellateArc } from '../viewer/arc';
import { ToolpathGeometryData, ToolpathMetrics, TransitionJunction } from './protocol';
import { readLayerHeights } from '../ui/layers';

export function buildToolpathGeometry(
  gcode: string,
  transitionsArr: number[],
  firstMode: 'base' | 'vase' = 'base'
): ToolpathGeometryData {
  if (gcode.includes('; Initial Mode: vase')) {
    firstMode = 'vase';
  } else if (gcode.includes('; Initial Mode: base')) {
    firstMode = 'base';
  }
  let maxRenderZ = 0;
  const zSet = new Set<number>();

  const previewMaxes = { f: 1, flow: 0.1, width: 0.1, height: 0.1, temp: 1 };
  const previewMins = { temp: 999 };
  let currentLayerHeight = 0.2;
  let currentTemp = 0;

  let lastX = 0;
  let lastY = 0;
  let lastZ = 0;
  let currentF = 3000;
  let isRelativeE = true;
  let lastE = 0;
  let cumTimeSec = 0;
  const hasTransitionMarkers = gcode.includes('KINTSUGIVASE TRANSITION END');
  let currentBandIdx = 0;

  const lines = gcode.split('\n');

  let capacity = 32768;
  let count = 0;

  let positions = new Float32Array(capacity * 6);
  let colorsType = new Float32Array(capacity * 6);
  let speeds = new Float32Array(capacity);
  let flows = new Float32Array(capacity);
  let widths = new Float32Array(capacity);
  let heights = new Float32Array(capacity);
  let temps = new Float32Array(capacity);
  let zCoords = new Float32Array(capacity);
  let cumTimes = new Float32Array(capacity);

  function ensureCapacity(needed: number) {
    if (needed > capacity) {
      capacity = Math.max(capacity * 2, needed);
      const newPos = new Float32Array(capacity * 6);
      newPos.set(positions);
      positions = newPos;

      const newColors = new Float32Array(capacity * 6);
      newColors.set(colorsType);
      colorsType = newColors;

      const newSpeeds = new Float32Array(capacity);
      newSpeeds.set(speeds);
      speeds = newSpeeds;

      const newFlows = new Float32Array(capacity);
      newFlows.set(flows);
      flows = newFlows;

      const newWidths = new Float32Array(capacity);
      newWidths.set(widths);
      widths = newWidths;

      const newHeights = new Float32Array(capacity);
      newHeights.set(heights);
      heights = newHeights;

      const newTemps = new Float32Array(capacity);
      newTemps.set(temps);
      temps = newTemps;

      const newZ = new Float32Array(capacity);
      newZ.set(zCoords);
      zCoords = newZ;

      const newTimes = new Float32Array(capacity);
      newTimes.set(cumTimes);
      cumTimes = newTimes;
    }
  }

  const baseColor = { r: 0x3b / 255, g: 0x82 / 255, b: 0xf6 / 255 };
  const vaseColor = { r: 0xf9 / 255, g: 0x73 / 255, b: 0x16 / 255 };

  const junctions: TransitionJunction[] = [];
  let justTransitioned = false;
  let nextTransIdx = 0;

  for (const line of lines) {
    const cleaned = cleanLine(line);

    if (cleaned.startsWith(';')) {
      if (cleaned.includes('KINTSUGIVASE TRANSITION END')) {
        currentBandIdx++;
        justTransitioned = true;
      }
      const hMatch = cleaned.match(/\b(?:HEIGHT|layer_height)[ \t]*[:=][ \t]*([-0-9.]+)/i);
      if (hMatch) currentLayerHeight = parseFloat(hMatch[1]);
      continue;
    }

    if (cleaned.match(/^M82/)) isRelativeE = false;
    if (cleaned.match(/^M83/)) isRelativeE = true;
    if (cleaned.match(/^G92.*[Ee]0/)) lastE = 0;

    const tMatch = cleaned.match(/^M10[49]\s+S([0-9.]+)/i);
    if (tMatch) {
      currentTemp = parseFloat(tMatch[1]);
      if (currentTemp > previewMaxes.temp) previewMaxes.temp = currentTemp;
      if (currentTemp < previewMins.temp && currentTemp > 0) previewMins.temp = currentTemp;
    }

    const gWordMatch = cleaned.match(/^[Gg]([0-3])\b/);
    if (!gWordMatch) continue;
    const isArc = gWordMatch[1] === '2' || gWordMatch[1] === '3';
    const isClockwise = gWordMatch[1] === '2';

    const { x: lx, y: ly } = extractXY(line);
    const pz = extractPhysicalZ(line);
    const eMatch = cleaned.match(/[Ee]([+-]?[0-9.]+)/);
    const fMatch = cleaned.match(/[Ff]([+-]?[0-9.]+)/);
    const iMatch = cleaned.match(/[Ii]([+-]?[0-9.]+)/);
    const jMatch = cleaned.match(/[Jj]([+-]?[0-9.]+)/);
    const pMatch = cleaned.match(/[Pp]([0-9]+)/);

    if (fMatch) currentF = parseFloat(fMatch[1]);

    const currentX = lx !== null ? lx : lastX;
    const currentY = ly !== null ? ly : lastY;
    const currentZ = pz !== null ? pz : lastZ;

    let eDelta = 0;
    if (eMatch) {
      const eRaw = parseFloat(eMatch[1]);
      eDelta = isRelativeE ? eRaw : eRaw - lastE;
      lastE = eRaw;
    }

    if (eDelta > 0) {
      if (currentZ > maxRenderZ) maxRenderZ = currentZ;
      zSet.add(Math.round(currentZ * 100) / 100);
      if (currentF > previewMaxes.f) previewMaxes.f = currentF;

      let lHeight = currentLayerHeight;
      if (lHeight <= 0) lHeight = 0.2;

      let waypoints;
      if (isArc && iMatch && jMatch) {
        waypoints = tessellateArc(
          lastX,
          lastY,
          currentX,
          currentY,
          parseFloat(iMatch[1]),
          parseFloat(jMatch[1]),
          isClockwise,
          pMatch ? parseFloat(pMatch[1]) : 0,
          0.03,
          48
        );
      } else {
        waypoints = [{ x: currentX, y: currentY, t: 1 }];
      }

      ensureCapacity(count + waypoints.length);

      let segStartX = lastX;
      let segStartY = lastY;
      let segStartZ = lastZ;
      let prevT = 0;

      for (const wp of waypoints) {
        const segT = wp.t - prevT;
        prevT = wp.t;
        const segZ = lastZ + (currentZ - lastZ) * wp.t;
        const segE = eDelta * segT;

        const dx = wp.x - segStartX;
        const dy = wp.y - segStartY;
        const dz = segZ - segStartZ;
        const dist = Math.hypot(dx, dy, dz);

        let flow = 0;
        let lineWidth = 0;
        if (dist > 0.001) {
          const volume = segE * 2.40528;
          flow = (volume * currentF) / (60 * dist);
          lineWidth = volume / dist / lHeight;
        }

        if (flow > previewMaxes.flow && flow < 50) previewMaxes.flow = flow;
        if (lineWidth > previewMaxes.width && lineWidth < 3) previewMaxes.width = lineWidth;
        if (lHeight > previewMaxes.height && lHeight < 1) previewMaxes.height = lHeight;

        const durationSec = dist > 0.001 && currentF > 0 ? (dist * 60) / currentF : 0;
        cumTimeSec += durationSec;

        const isVase = hasTransitionMarkers
          ? (firstMode === 'vase' ? currentBandIdx % 2 === 0 : currentBandIdx % 2 !== 0)
          : classifyType(segZ, transitionsArr, firstMode) === 'vase';

        const len = Math.hypot(dx, dy);
        let shade = 1.0;
        if (len > 0) {
          const nx = -dy / len;
          const ny = dx / len;
          const dot = Math.abs(nx * -0.707 + ny * 0.707);
          shade = 0.4 + 0.6 * dot;
        }

        const color = isVase ? vaseColor : baseColor;

        const pIdx = count * 6;
        positions[pIdx] = segStartX;
        positions[pIdx + 1] = segStartZ;
        positions[pIdx + 2] = -segStartY;
        positions[pIdx + 3] = wp.x;
        positions[pIdx + 4] = segZ;
        positions[pIdx + 5] = -wp.y;

        colorsType[pIdx] = color.r * shade;
        colorsType[pIdx + 1] = color.g * shade;
        colorsType[pIdx + 2] = color.b * shade;
        colorsType[pIdx + 3] = color.r * shade;
        colorsType[pIdx + 4] = color.g * shade;
        colorsType[pIdx + 5] = color.b * shade;

        speeds[count] = currentF;
        flows[count] = flow;
        widths[count] = lineWidth;
        heights[count] = lHeight;
        temps[count] = currentTemp;
        zCoords[count] = segZ;
        cumTimes[count] = cumTimeSec;

        if (justTransitioned) {
          junctions.push({
            z: segZ,
            x: wp.x,
            y: wp.y,
            segmentIndex: count,
            time: cumTimeSec,
          });
          justTransitioned = false;
        } else if (!hasTransitionMarkers && nextTransIdx < transitionsArr.length) {
          if (segZ >= transitionsArr[nextTransIdx] - 0.001) {
            junctions.push({
              z: segZ,
              x: wp.x,
              y: wp.y,
              segmentIndex: count,
              time: cumTimeSec,
            });
            nextTransIdx++;
          }
        }

        count++;
        segStartX = wp.x;
        segStartY = wp.y;
        segStartZ = segZ;
      }
    }

    lastX = currentX;
    lastY = currentY;
    lastZ = currentZ;
  }

  if (previewMins.temp === 999) previewMins.temp = 0;

  const declaredHeights = readLayerHeights(gcode);
  const layerHeights = declaredHeights.length ? declaredHeights : Array.from(zSet).sort((a, b) => a - b);
  const finalMaxZ = maxRenderZ;

  const metrics: ToolpathMetrics = {
    maxes: previewMaxes,
    mins: previewMins,
    maxZ: finalMaxZ,
    layerHeights,
    segmentCount: count,
    junctions,
  };

  return {
    positions: positions.subarray(0, count * 6),
    colorsType: colorsType.subarray(0, count * 6),
    speeds: speeds.subarray(0, count),
    flows: flows.subarray(0, count),
    widths: widths.subarray(0, count),
    heights: heights.subarray(0, count),
    temps: temps.subarray(0, count),
    zCoords: zCoords.subarray(0, count),
    cumTimes: cumTimes.subarray(0, count),
    metrics,
  };
}
