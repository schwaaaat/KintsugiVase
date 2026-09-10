/** A local deposited connection, not a planner for arbitrary unsupported spans. */
export function continuousConnection(params: {
  matched: boolean; x: number; y: number; z: number;
  resumeX: number; resumeY: number; resumeZ: number;
  retractDebt: number; relativeXYZ: boolean;
  layerHeight: number; width: number; speed: number;
}): string[] {
  const p = params;
  const xy = Math.hypot(p.resumeX - p.x, p.resumeY - p.y);
  const dz = p.resumeZ - p.z;
  if (!p.matched || p.relativeXYZ || p.retractDebt > 0.0001 ||
      dz < -0.000001 || dz > p.layerHeight + 0.001 || xy > 1.0 ||
      (xy < 0.001 && dz > 0.001) ||
      ![p.layerHeight, p.width, p.speed].every(v => Number.isFinite(v) && v > 0)) {
    throw new Error(`Cannot generate a local continuous connection at ${p.resumeZ.toFixed(3)}mm from the emitted nozzle position. Adjust this junction or supply a custom junction body.`);
  }
  const lines = ['M83 ; Relative extrusion for continuous junction'];
  if (xy < 0.001 && Math.abs(dz) < 0.001) return lines;
  const length = Math.hypot(xy, dz);
  const filamentArea = Math.PI * (1.75 / 2) ** 2;
  const e = length * p.width * p.layerHeight / filamentArea;
  lines.push(`G1 X${p.resumeX.toFixed(3)} Y${p.resumeY.toFixed(3)} Z${p.resumeZ.toFixed(3)} E${e.toFixed(5)} F${(p.speed * 60).toFixed(0)} ; Kintsugi: deposited seam connection`);
  return lines;
}
