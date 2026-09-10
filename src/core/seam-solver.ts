import { cleanLine, tokenizeLine } from './tokenizer';
import { TransitionApproach } from './types';
import { tessellateArc } from '../viewer/arc';

export const MATCH_THRESHOLD_MM = 1.0;

export function getLayerZFromComment(line: string): number | null {
  const m = cleanLine(line).match(/^;[ \t]*\b(?:Z|layer_z|Z_HEIGHT)\b[ \t]*[:=][ \t]*([-0-9.]+)/i);
  return m ? parseFloat(m[1]) : null;
}

export function extractPhysicalZ(line: string): number | null {
  const match = cleanLine(line).match(/^[Gg][0123]\b.*[Zz]([+-]?[0-9.]+)/);
  return match ? parseFloat(match[1]) : null;
}

export function extractXY(line: string): { x: number | null; y: number | null } {
  const cleaned = cleanLine(line);
  if (!cleaned.match(/^[Gg][0123]\b/)) return { x: null, y: null };
  const xMatch = cleaned.match(/[Xx]([+-]?[0-9.]+)/);
  const yMatch = cleaned.match(/[Yy]([+-]?[0-9.]+)/);
  return {
    x: xMatch ? parseFloat(xMatch[1]) : null,
    y: yMatch ? parseFloat(yMatch[1]) : null,
  };
}

export function isOuterWallComment(line: string): boolean {
  const cleaned = cleanLine(line);
  return /;\s*(?:TYPE\s*:\s*|FEATURE\s*:\s*|feature\s+)?(?:Outer[\s_-]*wall|External[\s_-]*perimeter|WALL[-_]OUTER|Outer\s*Perimeter|outer\s*perimeter|wall[\s_-]*0\b)/i.test(cleaned);
}

export interface ReorderedLayerResult {
  lines: string[];
  outerStartX: number | null;
  outerStartY: number | null;
  outerEndX: number | null;
  outerEndY: number | null;
  wasReordered: boolean;
  /** Closed, seam-first centerline of the selected regenerated outer wall. */
  outerPath?: { x: number; y: number }[];
}

interface FeatureBlock {
  header: string;
  isOuter: boolean;
  lines: string[];
  firstMotionX: number | null;
  firstMotionY: number | null;
  firstMotionIsArc?: boolean;
  firstMotionIsExtruding?: boolean;
  entryX: number | null;
  entryY: number | null;
}

export interface ScanResult {
  lineIndex: number;
  x: number;
  y: number;
  z: number;
  tempHotend: string | null;
  tempWait: string | null;
  fan: string | null;
  foundAnyLayer: boolean;
}

export function isFeatureComment(line: string): boolean {
    const cleaned = cleanLine(line);
    return /;\s*(?:TYPE\s*:|FEATURE\s*:|feature\s+|travel to wall\s*\d+\s*start)/i.test(cleaned);
}

// Reorders a layer's feature blocks so that the Outer Wall / External Perimeter is
// printed either FIRST (placeLast=false, used when switching FROM vase mode INTO
// standard mode) or LAST (placeLast=true, used when switching FROM standard mode INTO
// vase mode). Both directions share the exact same block-splitting and position-
// tracking machinery — see reorderLayerOuterWallFirst/reorderLayerOuterWallLast below
// for the direction-specific wrappers and their own seam-target semantics.
//
// Correctness note (found via a real user file, not the synthetic tests): real
// slicer output routinely starts a feature block's first REAL move with a G2/G3 arc
// (I/J relative to whatever position precedes it) or a line that omits X/Y entirely
// (continuing from wherever the previous line left off). Both are only correct
// relative to the position the ORIGINAL (un-reordered) file's own previous line
// actually left the nozzle at — which is generally NOT the block reordering places
// immediately before it. An earlier version of this function read a block's own
// literal first X/Y token as its "start" (wrong for an arc — that's the arc's END,
// not its start) and otherwise trusted natural line adjacency for position
// continuity (broken by definition, since reordering is exactly what changes which
// block precedes which). Both produced a real, out-of-place stray loop in the 3D
// preview and a wrong seam target — reproduced against a real Bambu/OrcaSlicer file
// with an Inner-wall-first layer whose Outer wall block opens on an arc.
//
// Fix: track each block's true ENTRY position (its predecessor's real ending
// position, walked forward through the file in ORIGINAL order — the only order in
// which "predecessor's ending position" is a meaningful, correct value) once, up
// front. Then, when assembling the reordered output, insert one explicit absolute
// travel line ahead of any block whose new predecessor differs from its original one
// — cheap (one non-extruding G1), unconditionally correct regardless of what that
// block's own first real line happens to need (arc-relative or continuation-based),
// and a no-op for any block that keeps its original predecessor.
function reorderLayerOuterWallCore(layerLines: string[], incomingX: number | null, incomingY: number | null, placeLast: boolean): ReorderedLayerResult {
    const empty = { lines: layerLines, outerStartX: null, outerStartY: null, outerEndX: null, outerEndY: null, wasReordered: false };
    if (!layerLines || layerLines.length === 0) return empty;

    let firstFeatureIdx = -1;
    for (let i = 0; i < layerLines.length; i++) {
        if (isFeatureComment(layerLines[i])) {
            firstFeatureIdx = i;
            break;
        }
    }

    if (firstFeatureIdx === -1) {
        return empty;
    }

    const headerLines = layerLines.slice(0, firstFeatureIdx);
    const featureLines = layerLines.slice(firstFeatureIdx);

    // Walk headerLines first, so the first feature block's own entryX/Y is correct.
    // Seeded from the caller's already-known incoming position (wherever the seam/
    // scan left off just before this layer) rather than null, so a layer whose own
    // header happens to carry no X/Y of its own (e.g. just a bare Z-set line) still
    // gets a correct entry position for its first feature block instead of silently
    // skipping the safety travel it needs.
    let trackX = incomingX ?? null, trackY = incomingY ?? null;
    for (const line of headerLines) {
        const { x, y } = extractXY(line);
        if (x !== null) trackX = x;
        if (y !== null) trackY = y;
    }

    const blocks: FeatureBlock[] = [];
    let currentBlock: FeatureBlock | null = null;

    for (let i = 0; i < featureLines.length; i++) {
        const line = featureLines[i];
        if (isFeatureComment(line)) {
            if (currentBlock) blocks.push(currentBlock);
            currentBlock = {
                header: line,
                isOuter: isOuterWallComment(line),
                lines: [line],
                firstMotionX: null,
                firstMotionY: null,
                entryX: trackX, // position this block's own content actually requires
                entryY: trackY, // as its start, per the file's real original order
            };
        } else {
            if (!currentBlock) {
                currentBlock = {
                    header: '',
                    isOuter: isOuterWallComment(line),
                    lines: [line],
                    firstMotionX: null,
                    firstMotionY: null,
                    entryX: trackX,
                    entryY: trackY,
                };
            } else {
                currentBlock.lines.push(line);
                if (isOuterWallComment(line)) currentBlock.isOuter = true;
            }
        }

        const { x, y } = extractXY(line);
        if (currentBlock && currentBlock.firstMotionX === null && x !== null && y !== null) {
            currentBlock.firstMotionX = x;
            currentBlock.firstMotionY = y;
            // A G2/G3's own X/Y is its ARC ENDPOINT, not a safe travel target — using
            // it as "where this block starts" is exactly the bug that caused a real
            // stray loop in the 3D preview (see function comment). A plain G0/G1's
            // X/Y, in contrast, IS a safe, self-contained target regardless of what
            // precedes it. Track which kind this block's first motion line was so the
            // seam target below can prefer the (more direct) explicit value when it's
            // trustworthy, and fall back to entryX/Y only when it isn't.
            currentBlock.firstMotionIsArc = /^[Gg][23]\b/.test(cleanLine(line));
            const firstE = cleanLine(line).match(/^[Gg][0-3]\b.*[Ee]([+-]?[0-9.]+)/);
            currentBlock.firstMotionIsExtruding = !!firstE && Number(firstE[1]) > 0;
        }
        if (x !== null) trackX = x;
        if (y !== null) trackY = y;
    }
    if (currentBlock) blocks.push(currentBlock);

    const hasOuter = blocks.some(b => b.isOuter);
    if (!hasOuter) {
        return empty;
    }

    const outerBlocks = blocks.filter(b => b.isOuter);
    const otherBlocks = blocks.filter(b => !b.isOuter);
    const reorderedBlocks = placeLast ? [...otherBlocks, ...outerBlocks] : [...outerBlocks, ...otherBlocks];

    const resultLines = [...headerLines];
    let prevOriginalIdx = -1; // index (in original block order) of whatever was JUST emitted
    for (const b of reorderedBlocks) {
        const originalIdx = blocks.indexOf(b);
        const naturallyContinuous = originalIdx === prevOriginalIdx + 1;
        // Only a block whose own first motion line can't stand on its own (an arc, or
        // one missing X/Y entirely) actually needs the inherited entry position to be
        // correct — a plain G0/G1 with explicit X/Y is self-contained and safe to run
        // regardless of what precedes it, so skip the (harmless but wasteful) extra
        // hop for that common case.
        const needsEntry = b.firstMotionIsArc || b.firstMotionIsExtruding || b.firstMotionX === null;
        if (!naturallyContinuous && needsEntry && b.entryX !== null && b.entryY !== null) {
            resultLines.push(`G1 X${b.entryX.toFixed(3)} Y${b.entryY.toFixed(3)} F3000 ; Kintsugi: outer-wall-${placeLast ? 'last' : 'first'} reorder safety travel`);
        }
        resultLines.push(...b.lines);
        prevOriginalIdx = originalIdx;
    }

    const firstOuter = outerBlocks[0];
    // Seam START target (for outer-wall-FIRST): prefer the outer block's own explicit
    // first X/Y (more direct — travels straight to the real print start with no wasted
    // intermediate hop) when it's trustworthy (a plain G0/G1). Only fall back to
    // entryX/Y — the position its ORIGINAL predecessor actually left it at — when the
    // first motion line is a G2/G3, whose own X/Y is its arc ENDPOINT, not a usable
    // travel target.
    const useEntryForSeam = !firstOuter || firstOuter.firstMotionIsArc || firstOuter.firstMotionIsExtruding || firstOuter.firstMotionX === null;

    // Seam END / closure-point target (for outer-wall-LAST): the position after the
    // LAST actually-extruding (E>0) line within the LAST outer-wall block (in
    // ORIGINAL file order — there can be more than one outer-wall island in a layer,
    // e.g. a separate small detail loop alongside the main body wall; reordering moves
    // ALL of them to the end, preserving their relative order, so outerBlocks' own
    // LAST entry is whichever one ends up printed last for real — using outerBlocks[0]
    // here instead would target an EARLIER island's closure while a DIFFERENT island's
    // content actually runs after it, silently mismatching which loop the seam is
    // supposed to hand off from). Deliberately NOT "wherever this block's lines end" —
    // real slicer output routinely appends a non-extruding "seam-hide" retract/travel/
    // unretract dance AFTER the wall closes, prepping for whatever used to follow it
    // (see reorderLayerOuterWallLast's own comment for why those trailing lines are
    // kept rather than truncated away).
    const lastOuter = outerBlocks[outerBlocks.length - 1];
    let outerEndX: number | null = null, outerEndY: number | null = null;
    if (lastOuter) {
        let px = lastOuter.entryX, py = lastOuter.entryY;
        for (const line of lastOuter.lines) {
            const cleaned = cleanLine(line);
            const { x, y } = extractXY(line);
            const nx = x !== null ? x : px, ny = y !== null ? y : py;
            const eMatch = cleaned.match(/^[Gg][0-3]\b.*[Ee]([+-]?[0-9.]+)/);
            // Require actual XY motion on this SAME line, not just E>0 — an unretract
            // prime (E>0, no X/Y) is real filament flow but deposits no material at any
            // new position, so it must NOT be read as "the wall extended to here". Real
            // Orca output's own trailing seam-hide dance is exactly retract -> travel
            // (E-less) -> ... -> unretract (X/Y-less) -> next feature; without this
            // check, the unretract line's E>0 wins the scan and silently inherits
            // whatever position the E-less travel lines before it wandered off to.
            if (eMatch && parseFloat(eMatch[1]) > 0 && (x !== null || y !== null)) { outerEndX = nx; outerEndY = ny; }
            px = nx; py = ny;
        }
    }

    const wasReordered = placeLast
        ? blocks[blocks.length - 1] !== outerBlocks[outerBlocks.length - 1]
        : blocks[0] !== outerBlocks[0];

    return {
        lines: resultLines,
        outerStartX: firstOuter ? (useEntryForSeam ? firstOuter.entryX : firstOuter.firstMotionX) : null,
        outerStartY: firstOuter ? (useEntryForSeam ? firstOuter.entryY : firstOuter.firstMotionY) : null,
        outerEndX, outerEndY,
        wasReordered
    };
}

// Outer-wall-FIRST: used when switching FROM vase mode INTO standard mode, so the
// resumed layer starts right where the vase wall left off instead of traveling into
// the interior for infill or inner walls first. outerStartX/Y is the seam target.
export function reorderLayerOuterWallFirst(layerLines: string[], incomingX: number | null, incomingY: number | null): ReorderedLayerResult {
    const original = reorderLayerOuterWallCore(layerLines, incomingX, incomingY, false);
    const features = layerLines.flatMap((line, index) => isFeatureComment(line) ? [index] : []);
    if (!features.some(index => isOuterWallComment(layerLines[index]))) return original;

    // Approach moves precede their feature comment. Move those with the feature,
    // while keeping layer metadata and previously deposited material in place.
    const starts = features.map((index, featureIndex) => {
        const lowerBound = featureIndex === 0 ? 0 : features[featureIndex - 1] + 1;
        let start = index;
        while (start > lowerBound) {
            const line = cleanLine(layerLines[start - 1]);
            const e = line.match(/^[Gg][0-3]\b.*[Ee]([+-]?[0-9.]+)/);
            const xy = extractXY(line);
            if ((e && Number(e[1]) > 0 && (xy.x !== null || xy.y !== null)) ||
                getLayerZFromComment(line) !== null || /^;\s*(?:LAYER_CHANGE|CHANGE_LAYER|BEFORE_LAYER_CHANGE)/i.test(line)) break;
            start--;
        }
        return start;
    });
    let x = incomingX, y = incomingY;
    const positions = layerLines.map(line => {
        const before = { x, y };
        const xy = extractXY(line);
        if (xy.x !== null) x = xy.x;
        if (xy.y !== null) y = xy.y;
        return before;
    });
    const blocks = features.map((index, i) => ({
        index,
        start: starts[i],
        end: starts[i + 1] ?? layerLines.length,
        outer: isOuterWallComment(layerLines[index]),
    }));
    const ordered = [...blocks.filter(b => b.outer), ...blocks.filter(b => !b.outer)];
    const first = ordered[0];
    const entry = positions[first.index];
    const lines = layerLines.slice(0, starts[0]);
    let previous = -1;
    for (const block of ordered) {
        const ordinal = blocks.indexOf(block);
        const approach = positions[block.start];
        if (ordinal !== previous + 1 && approach.x !== null && approach.y !== null) {
            lines.push(`G1 X${approach.x.toFixed(3)} Y${approach.y.toFixed(3)} F3000 ; Kintsugi: reorder safety travel`);
        }
        lines.push(...layerLines.slice(block.start, block.end));
        previous = ordinal;
    }
    // A travel inside the feature supplies its own start; an extrusion's endpoint
    // (linear or arc) never substitutes for the position preceding that move.
    let outerStartX = entry.x, outerStartY = entry.y;
    for (const line of layerLines.slice(first.index + 1, first.end)) {
        const xy = extractXY(line);
        if (xy.x === null && xy.y === null) continue;
        const e = cleanLine(line).match(/[Ee]([+-]?[0-9.]+)/);
        if (!/^[Gg][23]\b/.test(cleanLine(line)) && (!e || Number(e[1]) <= 0)) {
            outerStartX = xy.x ?? outerStartX;
            outerStartY = xy.y ?? outerStartY;
        }
        break;
    }
    return { ...original, lines, outerStartX, outerStartY };
}

/** Planar vase->base counterpart to rotateLastOuterWallSeam. It selects the
 * outer-wall island whose contour actually meets the outgoing vase surface,
 * rotates that closed contour to the shared seam, and emits it first without
 * carrying the base file's obsolete approach/retract sequence across the join. */
export function reorderLayerOuterWallFirstAt(
    layerLines: string[], incomingX: number | null, incomingY: number | null,
    targetX: number, targetY: number
): ReorderedLayerResult {
    const features = layerLines.flatMap((line, index) => isFeatureComment(line) ? [index] : []);
    if (!features.length) return reorderLayerOuterWallFirst(layerLines, incomingX, incomingY);
    const starts = features.map((index, featureIndex) => {
        const lowerBound = featureIndex === 0 ? 0 : features[featureIndex - 1] + 1;
        let start = index;
        while (start > lowerBound) {
            const line = cleanLine(layerLines[start - 1]);
            const e = line.match(/^[Gg][0-3]\b.*[Ee]([+-]?[0-9.]+)/);
            const xy = extractXY(line);
            if ((e && Number(e[1]) > 0 && (xy.x !== null || xy.y !== null)) ||
                getLayerZFromComment(line) !== null || /^;\s*(?:LAYER_CHANGE|CHANGE_LAYER|BEFORE_LAYER_CHANGE)/i.test(line)) break;
            start--;
        }
        return start;
    });
    let x = incomingX ?? 0, y = incomingY ?? 0;
    const positions = layerLines.map(line => {
        const before = {x,y};
        const xy = extractXY(line);
        if (xy.x !== null) x = xy.x;
        if (xy.y !== null) y = xy.y;
        return before;
    });
    const blocks = features.map((index, i) => ({index,start:starts[i],end:starts[i+1] ?? layerLines.length,
        outer:isOuterWallComment(layerLines[index])}));

    interface Candidate { block:typeof blocks[number]; lines:string[]; seam:{x:number;y:number}; distance:number; path:{x:number;y:number}[] }
    const candidates:Candidate[]=[];
    for (const block of blocks.filter(value => value.outer)) {
        let first=-1,last=-1;
        for(let i=block.index+1;i<block.end;i++) {
            const cmd=tokenizeLine(layerLines[i]);
            if(cmd.type==='motion'&&cmd.e!==undefined&&cmd.e>0&&(cmd.x!==undefined||cmd.y!==undefined)) {
                if(first<0)first=i; last=i;
            }
        }
        if(first<0)continue;
        let valid=true;
        for(let i=first;i<=last;i++) {
            const cmd=tokenizeLine(layerLines[i]);
            if(cmd.type==='motion'&&!(cmd.e!==undefined&&cmd.e>0&&(cmd.x!==undefined||cmd.y!==undefined)))valid=false;
        }
        if(!valid)continue;
        const origin=positions[first]; let px=origin.x,py=origin.y,feed=1800;
        const segments:{x:number;y:number;e:number;f:number}[]=[];
        for(let i=first;i<=last;i++) {
            const cmd=tokenizeLine(layerLines[i]);
            if(cmd.type!=='motion'||cmd.e===undefined){valid=false;break;}
            const nx=cmd.x??px,ny=cmd.y??py;if(cmd.f!==undefined)feed=cmd.f;
            const arc=cmd.g===2||cmd.g===3;
            if(arc&&cmd.i===undefined&&cmd.j===undefined){valid=false;break;}
            const pts=arc?tessellateArc(px,py,nx,ny,cmd.i??0,cmd.j??0,cmd.g===2,cmd.p??0,0.01,2048):[{x:nx,y:ny,t:1}];
            let prior=0;for(const point of pts){segments.push({x:point.x,y:point.y,e:cmd.e*(point.t-prior),f:feed});prior=point.t;}
            px=nx;py=ny;
        }
        if(!valid||segments.length<3||Math.hypot(px-origin.x,py-origin.y)>0.25)continue;
        const vertices=[origin,...segments.map(segment=>({x:segment.x,y:segment.y}))];
        let split=0,best=Infinity;
        for(let i=0;i<segments.length;i++){const d=Math.hypot(vertices[i].x-targetX,vertices[i].y-targetY);if(d<best){best=d;split=i;}}
        const seam=vertices[split],ordered=[...segments.slice(split),...segments.slice(0,split)];
        const path=[{x:seam.x,y:seam.y},...ordered.map(segment=>({x:segment.x,y:segment.y}))];
        path[path.length-1]={x:seam.x,y:seam.y};
        candidates.push({block,seam,distance:best,path,lines:[layerLines[block.index],
            ...layerLines.slice(block.index+1,first).filter(line=>tokenizeLine(line).type!=='motion'),
            'M83 ; Kintsugi: relative extrusion for rotated outer-wall seam',
            ...ordered.map((segment,index)=>`G1 X${segment.x.toFixed(3)} Y${segment.y.toFixed(3)} E${segment.e.toFixed(5)}${index===0||ordered[index-1].f!==segment.f?` F${segment.f.toFixed(0)}`:''} ; Kintsugi: rotated outer wall`)]});
    }
    candidates.sort((a,b)=>a.distance-b.distance);
    const chosen=candidates[0];
    if(!chosen||chosen.distance>MATCH_THRESHOLD_MM)return reorderLayerOuterWallFirst(layerLines,incomingX,incomingY);
    const orderedBlocks=[chosen.block,...blocks.filter(block=>block!==chosen.block&&block.outer),...blocks.filter(block=>!block.outer)];
    const lines=layerLines.slice(0,starts[0]);
    let previous=-1;
    for(const block of orderedBlocks){
        if(block===chosen.block){lines.push(...chosen.lines);previous=blocks.indexOf(block);continue;}
        const ordinal=blocks.indexOf(block),approach=positions[block.start];
        if(ordinal!==previous+1)lines.push(`G1 X${approach.x.toFixed(3)} Y${approach.y.toFixed(3)} F3000 ; Kintsugi: reorder safety travel`);
        lines.push(...layerLines.slice(block.start,block.end));previous=ordinal;
    }
    return {lines,outerStartX:chosen.seam.x,outerStartY:chosen.seam.y,
        outerEndX:chosen.seam.x,outerEndY:chosen.seam.y,wasReordered:true,outerPath:chosen.path};
}

// Outer-wall-LAST: used when switching FROM standard mode INTO vase mode, so the
// layer's FINAL extrusion is the outer wall's own closure point instead of wherever
// infill or an inner wall happens to naturally end. outerEndX/Y (not outerStartX/Y) is
// the seam target here — see reorderLayerOuterWallCore's own comment on why.
//
// Deliberately does NOT truncate the outer-wall block's own trailing lines even though
// they're no longer followed by whatever feature they were originally prepping for
// (e.g. Orca's own retract -> travel-to-first-infill-point -> unretract "seam hide"
// dance, now printing pointless — but harmless, since it's entirely non-extruding —
// motion at the very end of this layer instead of leading into infill). Truncating mid-
// dance would drop the trailing unretract and leave the machine retracted heading into
// the seam below, which would then either ooze (if the seam skips its own retract,
// trusting this block to have left things primed) or double-retract (if it doesn't) —
// both are real defects, and neither is worth it just to shave a few mm of otherwise
// harmless non-extruding travel off the end of the file.
export function reorderLayerOuterWallLast(layerLines: string[], incomingX: number | null, incomingY: number | null): ReorderedLayerResult {
    return reorderLayerOuterWallCore(layerLines, incomingX, incomingY, true);
}

/**
 * A reordered outer wall can carry Orca's old "seam hide" preparation for the
 * feature that used to follow it: retract, Z-hop/travel, then unretract.  At a
 * planar base->vase handoff that motion would move away from the wall closure
 * immediately before the bonding loop.  Keep the deposited layer through its
 * final XY extrusion and discard only the now-orphaned tail.
 *
 * This is intentionally separate from reorderLayerOuterWallLast: legacy/fallback
 * transitions still need the complete retract state that the source file supplied.
 */
export function trimAfterLastDepositingMove(lines: string[]): string[] {
    let lastDeposit = -1;
    for (let i = 0; i < lines.length; i++) {
        const cleaned = cleanLine(lines[i]);
        const xy = extractXY(cleaned);
        const e = cleaned.match(/^[Gg][0-3]\b.*[Ee]([+-]?[0-9.]+)/);
        if (e && Number(e[1]) > 0 && (xy.x !== null || xy.y !== null)) lastDeposit = i;
    }
    if (lastDeposit < 0 || lastDeposit === lines.length - 1) return lines;
    return [
        ...lines.slice(0, lastDeposit + 1),
        '; Kintsugi: removed orphaned post-wall seam-hide motion before planar handoff',
    ];
}

/**
 * Move the closure of the final reordered outer wall to the point on that wall
 * nearest the requested seam. Curved Orca walls are tessellated into equivalent
 * relative-E G1 segments so an arc can be split at the actual nearest point rather
 * than being limited to one of its distant endpoints.
 */
export function rotateLastOuterWallSeam(
    reordered: ReorderedLayerResult,
    targetX: number,
    targetY: number
): ReorderedLayerResult {
    const source = reordered.lines;
    let header = -1;
    for (let i = 0; i < source.length; i++) if (isFeatureComment(source[i]) && isOuterWallComment(source[i])) header = i;
    if (header < 0) return reordered;

    let x = 0, y = 0;
    const before: {x:number;y:number}[] = [];
    for (const line of source) {
        before.push({x,y});
        const xy = extractXY(line);
        if (xy.x !== null) x = xy.x;
        if (xy.y !== null) y = xy.y;
    }

    let firstDeposit = -1, lastDeposit = -1;
    for (let i = header + 1; i < source.length; i++) {
        const cmd = tokenizeLine(source[i]);
        if (cmd.type === 'motion' && cmd.e !== undefined && cmd.e > 0 && (cmd.x !== undefined || cmd.y !== undefined)) {
            if (firstDeposit < 0) firstDeposit = i;
            lastDeposit = i;
        }
    }
    if (firstDeposit < 0) return reordered;
    for (let i = firstDeposit; i <= lastDeposit; i++) {
        const cmd = tokenizeLine(source[i]);
        if (cmd.type === 'motion' && !(cmd.e !== undefined && cmd.e > 0 && (cmd.x !== undefined || cmd.y !== undefined))) return reordered;
    }

    interface Segment { x:number; y:number; e:number; f:number }
    const start = before[firstDeposit];
    let px = start.x, py = start.y, feed = 1800;
    const segments: Segment[] = [];
    for (let i = firstDeposit; i <= lastDeposit; i++) {
        const cmd = tokenizeLine(source[i]);
        if (cmd.type !== 'motion' || cmd.e === undefined) return reordered;
        const nx = cmd.x ?? px, ny = cmd.y ?? py;
        if (cmd.f !== undefined) feed = cmd.f;
        const arc = cmd.g === 2 || cmd.g === 3;
        if (arc && cmd.i === undefined && cmd.j === undefined) return reordered;
        const pts = arc
            ? tessellateArc(px, py, nx, ny, cmd.i ?? 0, cmd.j ?? 0, cmd.g === 2, cmd.p ?? 0, 0.01, 2048)
            : [{x:nx,y:ny,t:1}];
        let priorT = 0;
        for (const point of pts) {
            segments.push({x:point.x,y:point.y,e:cmd.e * (point.t-priorT),f:feed});
            priorT = point.t;
        }
        px = nx; py = ny;
    }
    if (segments.length < 3 || Math.hypot(px-start.x, py-start.y) > 0.25) return reordered;

    const vertices = [start, ...segments.map(segment => ({x:segment.x,y:segment.y}))];
    let split = 0, best = Infinity;
    for (let i = 0; i < segments.length; i++) {
        const distance = Math.hypot(vertices[i].x-targetX, vertices[i].y-targetY);
        if (distance < best) { best = distance; split = i; }
    }
    if (best > MATCH_THRESHOLD_MM) return reordered;
    const seam = vertices[split];
    const ordered = [...segments.slice(split), ...segments.slice(0, split)];
    const prefixEnd = header > 0 && source[header-1].includes('outer-wall-last reorder safety travel') ? header-1 : header;
    const prefix = source.slice(0, prefixEnd);
    const preamble = source.slice(header, firstDeposit).filter(line => tokenizeLine(line).type !== 'motion');
    const lines = [
        ...prefix,
        ...preamble,
        'M83 ; Kintsugi: relative extrusion for rotated outer-wall seam',
        `G1 X${seam.x.toFixed(3)} Y${seam.y.toFixed(3)} F3000 ; Kintsugi: approach relocated outer-wall seam`,
        ...ordered.map((segment, index) =>
            `G1 X${segment.x.toFixed(3)} Y${segment.y.toFixed(3)} E${segment.e.toFixed(5)}${index === 0 || ordered[index-1].f !== segment.f ? ` F${segment.f.toFixed(0)}` : ''} ; Kintsugi: rotated outer wall`
        ),
        '; Kintsugi: removed orphaned post-wall seam-hide motion before planar handoff',
    ];
    const outerPath=[{x:seam.x,y:seam.y},...ordered.map(segment=>({x:segment.x,y:segment.y}))];
    outerPath[outerPath.length-1]={x:seam.x,y:seam.y};
    return {...reordered, lines, outerEndX:seam.x, outerEndY:seam.y, wasReordered:true, outerPath};
}

// Scans a source file from its true start, tracking real physical (X,Y,Z) position
// continuously (G-code axes are absolute except E under M83 — an omitted axis means
// "unchanged", so this must be a running interpreter state, not a fresh scan from
// the cut point), to find exactly where Z first reaches targetZ. Also captures the
// last-seen M104/M109/M106 up to that point, for the seam that hands off into this
// file. Returns null if the file never reaches targetZ.
//
// useFineDetection=true checks physical Z on every extruding move (required for
// spiral/vase content, which ramps Z continuously within a layer — waiting for the
// next full-layer comment would overshoot). false only checks at layer-comment
// boundaries (correct and sufficient for standard/base content, whose Z is flat
// within a layer).
export function scanForZCrossing(lines: string[], targetZ: number, useFineDetection: boolean): ScanResult | null {
    let trackX = 0, trackY = 0, trackZ = 0;
    let lastTempHotend: string | null = null, lastTempWait: string | null = null, lastFan: string | null = null;
    let started = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const cleaned = cleanLine(line);
        if (cleaned.match(/^M104/i)) lastTempHotend = cleaned;
        if (cleaned.match(/^M109/i)) lastTempWait = cleaned;
        if (cleaned.match(/^M106/i)) lastFan = cleaned;

        const cz = getLayerZFromComment(line);
        let crossesHere = false;
        if (cz !== null) {
            started = true;
            // Coarse per-layer comment is a safe atomic crossing check only for
            // coarse (base) entries — a standard layer is flat, so it's wholly on
            // one side of the target or the other. For fine (vase) entries, physical
            // Z ramps continuously ACROSS a layer's own span, so a layer whose
            // declared comment Z already reaches targetZ can still start well BELOW
            // it. Stopping here unconditionally used to return whatever the PREVIOUS
            // layer happened to end at — a value tied to the incoming file's own
            // independent layer boundaries, unrelated to targetZ — instead of
            // continuing to scan into the layer for the true per-move crossing point.
            // This is the exact same bug as collectBandContent's exit-side "Defect A"
            // (see its comment above); it just went unnoticed there because a
            // same-layer-height synthetic test made both sides land on the same Z by
            // coincidence. With mismatched base/vase layer heights (an entirely
            // ordinary real case) it produces a real air gap or a below-surface
            // nozzle plunge at the seam, depending on which direction it happens to
            // miss by.
            if (!useFineDetection && cz >= targetZ - 1e-6) crossesHere = true;
        } else if (useFineDetection && started) {
            const pz = extractPhysicalZ(line);
            const eMatch = cleaned.match(/^[Gg][0-3]\b.*[Ee]([+-]?[0-9.]+)/);
            if (pz !== null && eMatch && parseFloat(eMatch[1]) > 0 && pz >= targetZ - 1e-6) {
                crossesHere = true;
            }
        }

        if (crossesHere) {
            // Coarse (base/stepped) entry descends straight to THIS layer's own
            // declared Z (cz) rather than the previous layer's tracked physical Z.
            // Real per-object Bambu/Orca output resumes each layer with its own
            // non-extruding pause/travel/hop dance (M625 -> M624 -> travel -> Z-hop ->
            // descend -> prime) BEFORE any extrusion happens — there is no gradual
            // "ramp up while printing" the way spiral vase mode has. Descending only to
            // the previous layer's Z and trusting the resumed content to "lift itself"
            // the rest of the way assumed a ramping first move that this real-world
            // G-code never has, leaving a real, unfilled physical gap (a full layer
            // height or more) between the last extrusion of the outgoing band and the
            // first extrusion of the incoming one. Targeting the crossing layer's
            // actual Z directly closes that gap.
            // Fine (vase/continuous) entry keeps using trackZ — the last tracked
            // physical Z immediately before the crossing point — since that's already
            // within a fraction of a millimeter of where the ramping content actually
            // resumes (verified separately); this branch is unconditional on cz vs. the
            // fine per-move check specifically so a vase file's own coarse per-layer
            // ";Z:" comment (present even though the content ramps continuously) can't
            // accidentally trigger the coarse behavior above and skip ahead of the
            // layer's real ramp-up.
            const crossZ = useFineDetection ? trackZ : cz!;
            return {
                lineIndex: i, x: trackX, y: trackY, z: crossZ,
                tempHotend: lastTempHotend, tempWait: lastTempWait, fan: lastFan,
                foundAnyLayer: started,
            };
        }

        const { x, y } = extractXY(line);
        const pzTrack = extractPhysicalZ(line);
        if (x !== null) trackX = x;
        if (y !== null) trackY = y;
        if (pzTrack !== null) trackZ = pzTrack;
    }
    return null;
}

export function locateOuterWallFirstEntry(
  baseLines: string[],
  targetZ: number
): {
  startInfo: ScanResult;
  nextLayerIdx: number;
  layerLines: string[];
  reordered: ReorderedLayerResult;
} | null {
  const startInfo = scanForZCrossing(baseLines, targetZ, false);
  if (!startInfo) return null;

  let nextLayerIdx = baseLines.length;
  let seenExtrusionOrFeature = false;
  for (let j = startInfo.lineIndex + 1; j < baseLines.length; j++) {
    const line = baseLines[j];
    const cleaned = cleanLine(line);
    if (/^;[ \t]*(?:LAYER_CHANGE|CHANGE_LAYER|BEFORE_LAYER_CHANGE)/i.test(cleaned)) {
      nextLayerIdx = j;
      break;
    }
    if (isFeatureComment(line) || cleaned.match(/^[Gg][0-3]\b.*[Ee]([+-]?[0-9.]+)/)) {
      seenExtrusionOrFeature = true;
    } else if (seenExtrusionOrFeature && getLayerZFromComment(line) !== null) {
      nextLayerIdx = j;
      break;
    }
  }
  const layerLines = baseLines.slice(startInfo.lineIndex, nextLayerIdx);
  const reordered = reorderLayerOuterWallFirst(layerLines, startInfo.x, startInfo.y);
  return { startInfo, nextLayerIdx, layerLines, reordered };
}

export function locateOuterWallLastExit(
  baseLines: string[],
  targetZ: number
): {
  layerStartIdx: number;
  nextLayerIdx: number;
  layerLines: string[];
  reordered: ReorderedLayerResult;
} | null {
  let candidateStartIdx = -1;
  let candidateEntryX = 0;
  let candidateEntryY = 0;
  let trackX = 0;
  let trackY = 0;
  let pendingLayerStartIdx = -1;
  let sawAnyLayer = false;

  for (let i = 0; i < baseLines.length; i++) {
    const line = baseLines[i];
    const cleaned = cleanLine(line);
    if (/^;[ \t]*(?:LAYER_CHANGE|CHANGE_LAYER|BEFORE_LAYER_CHANGE)/i.test(cleaned)) {
      pendingLayerStartIdx = i;
    }
    const cz = getLayerZFromComment(line);
    if (cz !== null) {
      sawAnyLayer = true;
      if (cz <= targetZ + 1e-6) {
        candidateStartIdx = pendingLayerStartIdx !== -1 ? pendingLayerStartIdx : i;
        candidateEntryX = trackX;
        candidateEntryY = trackY;
      } else {
        break;
      }
      pendingLayerStartIdx = -1;
    }
    const { x, y } = extractXY(line);
    if (x !== null) trackX = x;
    if (y !== null) trackY = y;
  }

  if (!sawAnyLayer || candidateStartIdx === -1) return null;

  let nextLayerIdx = baseLines.length;
  let seenExtrusionOrFeature = false;
  for (let j = candidateStartIdx + 1; j < baseLines.length; j++) {
    const line = baseLines[j];
    const cleaned = cleanLine(line);
    if (/^;[ \t]*(?:LAYER_CHANGE|CHANGE_LAYER|BEFORE_LAYER_CHANGE)/i.test(cleaned)) {
      nextLayerIdx = j;
      break;
    }
    if (isFeatureComment(line) || cleaned.match(/^[Gg][0-3]\b.*[Ee]([+-]?[0-9.]+)/)) {
      seenExtrusionOrFeature = true;
    } else if (seenExtrusionOrFeature && getLayerZFromComment(line) !== null) {
      nextLayerIdx = j;
      break;
    }
  }

  const layerLines = baseLines.slice(candidateStartIdx, nextLayerIdx);
  const reordered = reorderLayerOuterWallLast(layerLines, candidateEntryX, candidateEntryY);
  return { layerStartIdx: candidateStartIdx, nextLayerIdx, layerLines, reordered };
}

export function findClosestApproach(
  lines: string[],
  targetX: number,
  targetY: number,
  centerZ: number,
  beforeMM: number,
  afterMM: number
): TransitionApproach | null {
  const zLo = centerZ - beforeMM;
  const zHi = centerZ + afterMM;
  let trackX = 0;
  let trackY = 0;
  let trackZ = 0;
  let started = false;
  let lastTempHotend: string | null = null;
  let lastTempWait: string | null = null;
  let lastFan: string | null = null;
  let best: TransitionApproach | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cleaned = cleanLine(line);
    if (cleaned.match(/^M104/i)) lastTempHotend = cleaned;
    if (cleaned.match(/^M109/i)) lastTempWait = cleaned;
    if (cleaned.match(/^M106/i)) lastFan = cleaned;
    if (getLayerZFromComment(line) !== null) started = true;

    const { x, y } = extractXY(line);
    const pz = extractPhysicalZ(line);
    if (x !== null) trackX = x;
    if (y !== null) trackY = y;
    if (pz !== null) trackZ = pz;

    if (started && (x !== null || y !== null) && trackZ >= zLo - 1e-6 && trackZ <= zHi + 1e-6) {
      const d = Math.hypot(trackX - targetX, trackY - targetY);
      if (!best || d < best.distance) {
        best = {
          distance: d,
          x: trackX,
          y: trackY,
          z: trackZ,
          lineIndex: i,
          tempHotend: lastTempHotend,
          tempWait: lastTempWait,
          fan: lastFan,
          foundAnyLayer: started,
        };
      }
    }
    if (started && trackZ > zHi + 1e-6) break;
  }
  return best;
}

export interface TruncatedMove {
  tx: number;
  ty: number;
  f: number;
  feed: string | null;
}

export function truncateMoveAtZ(
  line: string,
  zStart: number,
  zEndOriginal: number,
  zTarget: number,
  startX: number,
  startY: number
): TruncatedMove | null {
  const cleaned = cleanLine(line);
  const gMatch = cleaned.match(/^[Gg]([0-3])\b/);
  if (!gMatch) return null;
  if (Math.abs(zEndOriginal - zStart) < 1e-9) return null;
  const f = Math.max(0, Math.min(1, (zTarget - zStart) / (zEndOriginal - zStart)));
  if (f <= 1e-6) return null;

  const isArc = gMatch[1] === '2' || gMatch[1] === '3';
  const isClockwise = gMatch[1] === '2';
  const xMatch = cleaned.match(/[Xx]([+-]?[0-9.]+)/);
  const yMatch = cleaned.match(/[Yy]([+-]?[0-9.]+)/);
  const iMatch = cleaned.match(/[Ii]([+-]?[0-9.]+)/);
  const jMatch = cleaned.match(/[Jj]([+-]?[0-9.]+)/);
  const pMatch = cleaned.match(/[Pp]([0-9]+)/);
  const fMatch = cleaned.match(/[Ff]([+-]?[0-9.]+)/);

  const endX = xMatch ? parseFloat(xMatch[1]) : startX;
  const endY = yMatch ? parseFloat(yMatch[1]) : startY;

  let tx: number;
  let ty: number;
  if (isArc && iMatch && jMatch) {
    const iOff = parseFloat(iMatch[1]);
    const jOff = parseFloat(jMatch[1]);
    const cx = startX + iOff;
    const cy = startY + jOff;
    const radius = Math.hypot(iOff, jOff);
    if (!(radius > 1e-6)) {
      tx = startX + (endX - startX) * f;
      ty = startY + (endY - startY) * f;
    } else {
      const startAngle = Math.atan2(startY - cy, startX - cx);
      const isFullCircle = Math.abs(endX - startX) < 1e-3 && Math.abs(endY - startY) < 1e-3;
      let sweep: number;
      if (isFullCircle) {
        sweep = 2 * Math.PI;
      } else {
        const endAngle = Math.atan2(endY - cy, endX - cx);
        sweep = isClockwise ? startAngle - endAngle : endAngle - startAngle;
        if (sweep <= 1e-9) sweep += 2 * Math.PI;
      }
      const extraTurns = pMatch ? parseFloat(pMatch[1]) : 0;
      sweep += 2 * Math.PI * Math.max(0, extraTurns);
      const dir = isClockwise ? -1 : 1;
      const angle = startAngle + dir * sweep * f;
      tx = cx + radius * Math.cos(angle);
      ty = cy + radius * Math.sin(angle);
    }
  } else {
    tx = startX + (endX - startX) * f;
    ty = startY + (endY - startY) * f;
  }

  return { tx, ty, f, feed: fMatch ? fMatch[1] : null };
}

export interface LapExtensionResult {
  lines: string[];
  endX: number;
  endY: number;
  lapDistance: number;
  totalLapE: number;
}

export function generateOuterWallLapExtension(
  outerWallLines: string[],
  overlapDistanceMM: number
): LapExtensionResult {
  if (overlapDistanceMM <= 0 || outerWallLines.length === 0) {
    return { lines: [], endX: 0, endY: 0, lapDistance: 0, totalLapE: 0 };
  }

  interface ExtrudedSeg {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    dist: number;
    e: number;
    feed: number | null;
  }
  const segs: ExtrudedSeg[] = [];

  let curX = 0;
  let curY = 0;
  let curF: number | null = null;

  for (const line of outerWallLines) {
    const cleaned = cleanLine(line);
    const fMatch = cleaned.match(/[Ff]([+-]?[0-9.]+)/);
    if (fMatch) curF = parseFloat(fMatch[1]);

    const { x, y } = extractXY(line);
    const nx = x !== null ? x : curX;
    const ny = y !== null ? y : curY;

    const eMatch = cleaned.match(/^[Gg][0-3]\b.*[Ee]([+-]?[0-9.]+)/);
    if (eMatch && parseFloat(eMatch[1]) > 0 && (x !== null || y !== null)) {
      const segDist = Math.hypot(nx - curX, ny - curY);
      if (segDist > 1e-4) {
        segs.push({
          startX: curX,
          startY: curY,
          endX: nx,
          endY: ny,
          dist: segDist,
          e: parseFloat(eMatch[1]),
          feed: curF,
        });
      }
    }
    curX = nx;
    curY = ny;
  }

  if (segs.length === 0) {
    return { lines: [], endX: curX, endY: curY, lapDistance: 0, totalLapE: 0 };
  }

  const lapLines: string[] = [];
  let cumDist = 0;
  let lastX = segs[0].startX;
  let lastY = segs[0].startY;
  let totalLapE = 0;

  for (const seg of segs) {
    if (cumDist >= overlapDistanceMM) break;

    const remaining = overlapDistanceMM - cumDist;
    const segTakes = Math.min(seg.dist, remaining);
    const frac = segTakes / seg.dist;

    const segEndX = seg.startX + (seg.endX - seg.startX) * frac;
    const segEndY = seg.startY + (seg.endY - seg.startY) * frac;

    const midDist = cumDist + segTakes / 2;
    const flowRatio = Math.max(0.05, 1.0 - midDist / overlapDistanceMM);
    const segE = seg.e * frac * flowRatio;

    const fStr = seg.feed ? ` F${seg.feed}` : '';
    lapLines.push(
      `G1 X${segEndX.toFixed(3)} Y${segEndY.toFixed(3)} E${segE.toFixed(5)}${fStr} ; Kintsugi: lap joint overlap (flow ${(flowRatio * 100).toFixed(0)}%)`
    );

    totalLapE += segE;
    cumDist += segTakes;
    lastX = segEndX;
    lastY = segEndY;
  }

  return {
    lines: lapLines,
    endX: lastX,
    endY: lastY,
    lapDistance: cumDist,
    totalLapE,
  };
}

export function computeTangentialLeadIn(
  resumeX: number,
  resumeY: number,
  nextX: number,
  nextY: number,
  centerX: number,
  centerY: number,
  leadInDistanceMM: number
): { leadInX: number; leadInY: number } {
  const dx = nextX - resumeX;
  const dy = nextY - resumeY;
  const len = Math.hypot(dx, dy);

  if (len < 1e-4 || leadInDistanceMM <= 0) {
    return { leadInX: resumeX, leadInY: resumeY };
  }

  const tx = dx / len;
  const ty = dy / len;

  const norm1X = -ty;
  const norm1Y = tx;

  const toCenterX = centerX - resumeX;
  const toCenterY = centerY - resumeY;

  const dot = toCenterX * norm1X + toCenterY * norm1Y;
  const inNormX = dot >= 0 ? norm1X : -norm1X;
  const inNormY = dot >= 0 ? norm1Y : -norm1Y;

  const leadInX = resumeX - tx * (leadInDistanceMM * 0.8) + inNormX * (leadInDistanceMM * 0.6);
  const leadInY = resumeY - ty * (leadInDistanceMM * 0.8) + inNormY * (leadInDistanceMM * 0.6);

  return { leadInX, leadInY };
}
