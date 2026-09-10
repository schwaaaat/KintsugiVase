/** Absolute layer elevations, not thickness comments such as HEIGHT. */
export function readLayerHeights(gcode: string): number[] {
  const heights = new Set<number>();
  for (const line of gcode.split('\n')) {
    const match = line.match(/^\s*;\s*(?:Z|layer_z|Z_HEIGHT)\s*[:=]\s*([+-]?[\d.]+)/i);
    if (match && Number.isFinite(Number(match[1]))) heights.add(Number(match[1]));
  }
  return [...heights].sort((a, b) => a - b);
}

export function snapLayer(value: number, heights: number[]): number {
  return heights.reduce((best, height) => Math.abs(height - value) < Math.abs(best - value) ? height : best, heights[0] ?? value);
}
