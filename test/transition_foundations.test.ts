import { describe, expect, it } from 'vitest';
import { getLayerZFromComment, locateOuterWallLastExit } from '../src/core/seam-solver';
import { collectBandContent } from '../src/core/splicer';

describe('Physical transition boundaries', () => {
  it('distinguishes elevation from thickness in Orca/Prusa comments', () => {
    expect(getLayerZFromComment(';Z:16.04')).toBe(16.04);
    expect(getLayerZFromComment('; Z_HEIGHT: 16.04')).toBe(16.04);
    expect(getLayerZFromComment('; layer_z = 16.04')).toBe(16.04);
    expect(getLayerZFromComment(';HEIGHT:0.2')).toBeNull();
    expect(getLayerZFromComment(';LAYER_HEIGHT:0.24')).toBeNull();
  });

  it('retains a physical Z inside the layer when clipping a spiral segment', () => {
    const result = collectBandContent([';Z:1.4', ';HEIGHT:0.2', 'G1 X10 Y0 Z1.4 E1 F1800'], 0, 1.3, true, {
      flowMultiplier: 1, isFirstBand: false, isLastBand: false,
      taperEnabled: false, taperDistanceMM: 0, taperStartRatio: 1,
      resumeX: 0, resumeY: 0, startZ: 1.2,
    });
    expect(result.outputObjs.at(-1)?.text).toContain('X5.000 Y0.000 Z1.3000');
    expect(result.outputObjs.at(-1)?.text).toContain('E0.50000');
  });

  it('keeps the final base layer intact when thickness follows its Z comment', () => {
    const lines = [';LAYER_CHANGE', ';Z:1', ';HEIGHT:0.2', 'G1 Z1', ';TYPE:Outer wall', 'G1 X0 Y0', 'G1 X10 Y0 E1', ';LAYER_CHANGE', ';Z:1.2', ';HEIGHT:0.2', 'G1 Z1.2'];
    const exit = locateOuterWallLastExit(lines, 1);
    expect(exit?.layerStartIdx).toBe(0);
    expect(exit?.layerLines).toContain(';Z:1');
    expect(exit?.reordered.outerEndX).toBe(10);
  });
});
