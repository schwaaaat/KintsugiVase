import { describe, it, expect } from 'vitest';
import { spliceGcode } from '../src/core/splicer';
import { continuousConnection } from '../src/core/junction-connection';
// @ts-ignore
import { generateBaseGcode, generateVaseGcode } from './gen_gcode';

const base = generateBaseGcode({ layers: 40 });
const vase = generateVaseGcode({ layers: 40 });
const defaults = { transitions: [2, 4, 6], seamMatchEnabled: false, overlapEnabled: false, leadInEnabled: false, transTemp: 210 };

describe('Independent junction settings', () => {
  it('uses a deposited connector in an actual matched splice', () => {
    const roundBase = ['M83', ...Array.from({length: 40}, (_, i) => `;Z:${((i + 1) * 0.2).toFixed(2)}\nG1 Z${((i + 1) * 0.2).toFixed(2)}\n;TYPE:External perimeter\nG1 X10.2 Y0 F6000\nG3 X0 Y10.2 I-10.2 J0 E1 F1800\nG3 X-10.2 Y0 I0 J-10.2 E1\nG3 X0 Y-10.2 I10.2 J0 E1\nG3 X10.2 Y0 I0 J10.2 E1`)].join('\n');
    const result = spliceGcode(roundBase, vase, { transitions: [2], overlapEnabled: false, leadInEnabled: false,
      junctions: [{ z: 2, overrides: { continuousConnection: true } }] });
    expect(result.transitions[0].generatedGcode).toContain('deposited seam connection');
    expect(result.transitions[0].generatedGcode).not.toContain('direct travel');
    expect(result.transitions[0].generatedGcode).not.toMatch(/G1 E-/);
  });
  it('deposits a short matched connection without a retract or travel move', () => {
    const lines = continuousConnection({ matched: true, x: 10, y: 10, z: 2, resumeX: 10.3, resumeY: 10, resumeZ: 2.05, retractDebt: 0, relativeXYZ: false, layerHeight: 0.2, width: 0.42, speed: 20 });
    expect(lines.join('\n')).toMatch(/G1 X10.300 Y10.000 Z2.050 E0\.\d+ F1200/);
    expect(lines.join('\n')).not.toMatch(/E-|Z-Hop|travel/);
  });

  it('rejects unsupported continuous moves rather than silently falling back', () => {
    const params = { matched: true, x: 10, y: 10, z: 2, resumeX: 10.3, resumeY: 10, resumeZ: 2.05, retractDebt: 0, relativeXYZ: false, layerHeight: 0.2, width: 0.42, speed: 20 };
    for (const override of [{matched:false}, {resumeZ:1.9}, {resumeX:12}, {retractDebt:0.8}, {relativeXYZ:true}]) {
      expect(() => continuousConnection({...params, ...override})).toThrow('Cannot generate');
    }
    expect(() => spliceGcode(base, vase, {...defaults, junctions:[{z:2, overrides:{continuousConnection:true}}]})).toThrow('Cannot generate');
  });
  it('attaches overrides to heights after sorting and inherits other junction defaults', () => {
    const result = spliceGcode(base, vase, { ...defaults, transitions: [6, 2, 4], junctions: [{ z: 4, overrides: { transTemp: 225, hopHeight: 0 } }] });
    expect(result.transitions.map(t => t.nominalZ)).toEqual([2, 4, 6]);
    expect(result.transitions[0].generatedGcode).toContain('M104 S210');
    expect(result.transitions[1].generatedGcode).toContain('M104 S225');
    expect(result.transitions[2].generatedGcode).toContain('M104 S210');
    expect(result.transitions[0].customGcode).toBe(false);
  });

  it('inserts custom before/body/after exactly once while retaining preview markers', () => {
    const result = spliceGcode(base, vase, { ...defaults, junctions: [{ z: 4, gcode: { before: '; BEFORE-ONLY', replacement: 'M104 S228 ; BODY-ONLY', after: '; AFTER-ONLY' } }] });
    const code = result.splicedGcode;
    expect(code.split('; BEFORE-ONLY')).toHaveLength(2);
    expect(code.indexOf('; BEFORE-ONLY')).toBeLessThan(code.indexOf('; BODY-ONLY'));
    expect(code.indexOf('; BODY-ONLY')).toBeLessThan(code.indexOf('; AFTER-ONLY'));
    expect(code.match(/KINTSUGIVASE TRANSITION START/g)).toHaveLength(3);
    expect(code.match(/KINTSUGIVASE TRANSITION END/g)).toHaveLength(3);
    expect(result.transitions[1].generatedGcode).toContain('M104 S210');
    expect(result.transitions[1].customGcode).toBe(true);
  });

  it('rejects user-supplied classification markers', () => {
    expect(() => spliceGcode(base, vase, { ...defaults, junctions: [{ z: 2, gcode: { after: '; KINTSUGIVASE TRANSITION END' } }] })).toThrow('reserved transition markers');
  });

  it('changes one incoming vase band without modifying other junction bodies', () => {
    const original = spliceGcode(base, vase, defaults);
    const changed = spliceGcode(base, vase, { ...defaults, junctions: [{ z: 2, overrides: { flowMultiplier: 1.5 } }] });
    expect(changed.totalExtrudedE).toBeGreaterThan(original.totalExtrudedE);
    expect(changed.transitions.map(t => t.generatedGcode)).toEqual(original.transitions.map(t => t.generatedGcode));
    const tail = (code: string) => code.slice(code.lastIndexOf('KINTSUGIVASE TRANSITION END'));
    expect(tail(changed.splicedGcode)).toBe(tail(original.splicedGcode));
  });

  it('keeps base-to-vase matching forward-only even with a large local before window', () => {
    const result = spliceGcode(base, vase, { ...defaults, junctions: [{ z: 2, overrides: { seamMatchEnabled: true, seamMatchLayersBefore: 50, seamMatchLayersAfter: 4 } }] });
    const first = result.transitions[0];
    if (first.matchedZ !== null) expect(first.matchedZ).toBeGreaterThanOrEqual(2 - 1e-6);
  });
});
