/** Deposited paths expressed as relative-E segments. Points include the start. */
export interface LoopPoint { x: number; y: number; z: number; e: number }

function validateLoop(points: LoopPoint[]) {
  if (points.length < 4) throw new Error('A bonding loop needs a complete contour.');
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (![p.x, p.y, p.z, p.e].every(Number.isFinite) || p.e < 0) throw new Error('Invalid bonding-loop coordinates or extrusion.');
    if (i && p.z < points[i - 1].z - 1e-6) throw new Error('A bonding loop cannot contain descending source extrusion.');
  }
  const first = points[0], last = points[points.length - 1];
  if (Math.hypot(first.x - last.x, first.y - last.y) > 0.05) throw new Error('Contour endpoints do not close within 0.05 mm.');
}

function fractions(points: LoopPoint[]): number[] {
  const distances = [0];
  for (let i = 1; i < points.length; i++) {
    distances.push(distances[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  const length = distances[distances.length - 1];
  if (length < 1e-6) throw new Error('Bonding loop has no perimeter length.');
  return distances.map(d => d / length);
}

/**
 * Fill the wedge above the final spiral without moving its top plane upward.
 * At every phase the new bead height is planeZ minus the underlying spiral Z.
 * Integrating the gap over a segment avoids a zero-flow first/last-point artifact.
 */
export function supportingRim(lastTurn: LoopPoint[], planeZ: number, sourceLayerHeight: number): LoopPoint[] {
  validateLoop(lastTurn);
  if (!(sourceLayerHeight > 0) || !Number.isFinite(planeZ)) throw new Error('Invalid supporting-rim height.');
  if (Math.abs(lastTurn[lastTurn.length - 1].z - planeZ) > 1e-6) throw new Error('The spiral must end on the supporting plane before capping.');
  const gaps = lastTurn.map(p => planeZ - p.z);
  if (gaps.some(g => g < -1e-6 || g > sourceLayerHeight + 1e-6)) throw new Error('Supporting rim would exceed one layer of material.');
  return lastTurn.map((p, i) => ({
    ...p, z: planeZ,
    e: i === 0 ? 0 : p.e * (gaps[i - 1] + gaps[i]) / (2 * sourceLayerHeight),
  }));
}

/**
 * Replace the first rising turn with a flat bonding turn, then blend the next
 * turn back into its original height without shifting any later source path.
 * Each next-turn E is scaled to its clearance above the new flat support.
 */
export function bondingEntry(firstTurn: LoopPoint[], nextTurn: LoopPoint[], baseTopZ: number, sourceLayerHeight: number): {
  bonding: LoopPoint[]; blend: LoopPoint[];
} {
  validateLoop(firstTurn); validateLoop(nextTurn);
  if (!(sourceLayerHeight > 0) || !Number.isFinite(baseTopZ)) throw new Error('Invalid bonding-loop height.');
  const planeZ = baseTopZ + sourceLayerHeight;
  const startZ = nextTurn[0].z;
  const endZ = nextTurn[nextTurn.length - 1].z;
  if (planeZ < startZ - 1e-6 || planeZ >= endZ - 1e-6) throw new Error('Source turns do not bracket the bonding plane.');
  const end = firstTurn[firstTurn.length - 1];
  if (Math.hypot(end.x - nextTurn[0].x, end.y - nextTurn[0].y) > 0.05) throw new Error('Bonding and blend turns have different seam positions.');
  const u = fractions(nextTurn);
  const rise = endZ - startZ;
  const offset = planeZ - startZ;
  const z = nextTurn.map((p, i) => {
    const t = u[i];
    // Hermite correction: horizontal start, original endpoint and end slope.
    return p.z + offset * (2*t*t*t - 3*t*t + 1) - rise * (t*t*t - 2*t*t + t);
  });
  for (let i = 0; i < z.length; i++) {
    if (z[i] < planeZ - 1e-6 || z[i] - planeZ > sourceLayerHeight + 1e-6 || (i && z[i] < z[i - 1] - 1e-6)) {
      throw new Error('Blend would descend or exceed supported layer spacing.');
    }
  }
  return {
    bonding: firstTurn.map((p, i) => ({ ...p, z: planeZ, e: i === 0 ? 0 : p.e })),
    blend: nextTurn.map((p, i) => ({ ...p, z: z[i], e: i === 0 ? 0 : p.e * ((z[i - 1] + z[i]) / 2 - planeZ) / sourceLayerHeight })),
  };
}
