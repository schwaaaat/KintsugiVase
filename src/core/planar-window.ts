import { SpiralSurface } from './spiral-surface';

export interface PlanarPoint { x:number; y:number; z:number; e:number; q:number; gap:number }
export interface PlanarWindow {
  points: PlanarPoint[];
  sourceStartQ: number;
  sourceEndQ: number;
  planeZ: number;
  maxGap: number;
}

/** Local replacement; source geometry outside sourceStartQ/sourceEndQ is retained. */
export function planPlanarWindow(surface: SpiralSurface, opts: {
  direction:'entry'|'exit'; anchorQ:number; baseZ:number; layerHeight:number;
  width:number; blendTurns?:number; maxLayerHeight:number; samplesPerTurn?:number;
}): PlanarWindow {
  const blend = opts.blendTurns ?? 3;
  if (blend < 1 || opts.layerHeight <= 0 || opts.width <= 0) throw new Error('Invalid planar-window dimensions.');
  const entry = opts.direction === 'entry';
  const start = entry ? opts.anchorQ : opts.anchorQ - blend;
  const sourceEnd = entry ? opts.anchorQ + 1 + blend : opts.anchorQ;
  const end = entry ? sourceEnd : sourceEnd + 1;
  if (start < 0 || sourceEnd >= surface.turns.length) throw new Error('Not enough source turns around the junction.');
  const planeZ = opts.baseZ + (entry ? opts.layerHeight : -opts.layerHeight);
  const sourceZ = (q:number) => surface.sampleQ(q).z;
  const epsilon = 0.0001;
  const derivativeQ = entry ? sourceEnd : start;
  const slope = (sourceZ(derivativeQ+epsilon)-sourceZ(derivativeQ-epsilon))/(2*epsilon);
  const fromZ=entry?planeZ:sourceZ(start), toZ=entry?sourceZ(sourceEnd):planeZ;
  const rise=toZ-fromZ;
  if (rise<=0) throw new Error('Insufficient rising height for the planar blend.');
  const tangentSlope=Math.max(0,Math.min(3*rise,slope*blend));
  function height(q:number): number {
    if (entry && q < start) return opts.baseZ;
    if (entry && q <= start+1) return planeZ;
    if (!entry && q < start) return sourceZ(q);
    if (!entry && q >= sourceEnd) return planeZ;
    const u = entry ? (q-start-1)/blend : (q-start)/blend;
    const cubic = -2*u*u*u+3*u*u;
    const tangent = entry ? u*u*u-u*u : u*u*u-2*u*u+u;
    return fromZ + rise*cubic + tangentSlope*tangent;
  }
  const steps = Math.ceil((end-start)*(opts.samplesPerTurn ?? 256));
  const points: PlanarPoint[] = [];
  let maxGap = 0;
  const filamentArea = Math.PI*(1.75/2)**2;
  for (let i=0;i<=steps;i++) {
    const q=start+(end-start)*i/steps;
    const z=height(q);
    const gap=z-height(q-1);
    if (gap < -1e-5 || gap > opts.maxLayerHeight+1e-5) throw new Error(`Planar junction needs ${gap.toFixed(4)} mm spacing, outside the allowed range.`);
    const phase=q-Math.floor(q);
    const xyz=surface.atHeight(z,phase);
    const previous=points[points.length-1];
    if (previous && z<previous.z-1e-6) throw new Error('Planar junction would descend while extruding.');
    const length=previous ? Math.hypot(xyz.x-previous.x,xyz.y-previous.y,z-previous.z) : 0;
    // Integrate inside the segment: support changes discontinuously at the seam.
    // Endpoint averaging there would smear the first loop's full bead into the
    // following turn's initially zero-height bead.
    const qa=previous ? previous.q+(q-previous.q)*0.2113248654 : q;
    const qb=previous ? previous.q+(q-previous.q)*0.7886751346 : q;
    const meanGap=((height(qa)-height(qa-1))+(height(qb)-height(qb-1)))/2;
    const e=previous ? length*opts.width*Math.max(0,meanGap)/filamentArea : 0;
    points.push({...xyz,e,q,gap});
    maxGap=Math.max(maxGap,gap);
  }
  return {points,sourceStartQ:start,sourceEndQ:sourceEnd,planeZ,maxGap};
}
