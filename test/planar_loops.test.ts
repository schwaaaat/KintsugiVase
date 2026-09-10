import { describe, expect, it } from 'vitest';
import { bondingEntry, supportingRim, LoopPoint } from '../src/core/planar-loops';

function circle(z: number, height = 0.2, samples = 100): LoopPoint[] {
  return Array.from({ length: samples + 1 }, (_, i) => ({
    x: 10 * Math.cos(i / samples * Math.PI * 2),
    y: 10 * Math.sin(i / samples * Math.PI * 2),
    z: z + i / samples * height, e: i ? 0.02 : 0,
  }));
}

describe('Planar bonding geometry', () => {
  it('creates a full flat bonding loop then rejoins the unshifted spiral', () => {
    const result = bondingEntry(circle(10), circle(10.2), 10, 0.2);
    expect(result.bonding.every(p => p.z === 10.2)).toBe(true);
    expect(result.blend[0].z).toBeCloseTo(10.2);
    expect(result.blend.at(-1)!.z).toBeCloseTo(10.4);
    for (let i = 1; i < result.blend.length; i++) {
      expect(result.blend[i].z).toBeGreaterThanOrEqual(result.blend[i - 1].z);
      expect(result.blend[i].e).toBeGreaterThan(0);
      expect(result.blend[i].e).toBeLessThanOrEqual(0.020001);
    }
  });

  it('fills the final spiral wedge at a fixed height with the required material volume', () => {
    const spiral = circle(10);
    const rim = supportingRim(spiral, 10.2, 0.2);
    expect(rim.every(p => p.z === 10.2)).toBe(true);
    // Linear 0.2 mm wedge has half the volume of a complete 0.2 mm wall.
    expect(rim.reduce((sum, p) => sum + p.e, 0)).toBeCloseTo(spiral.reduce((sum, p) => sum + p.e, 0) / 2, 8);
    expect(rim[1].e).toBeGreaterThan(rim.at(-1)!.e);
    expect(rim.at(-1)!.x).toBeCloseTo(spiral.at(-1)!.x);
  });

  it('refuses non-closing contours and layers that do not support the proposed plane', () => {
    const open = circle(10); open.at(-1)!.x += 1;
    expect(() => supportingRim(open, 10.2, 0.2)).toThrow('close');
    expect(() => supportingRim(circle(10), 10.4, 0.2)).toThrow('end on');
    expect(() => bondingEntry(circle(10), circle(10.2), 11, 0.2)).toThrow('bracket');
  });
});
