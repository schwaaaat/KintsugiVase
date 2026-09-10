import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spliceGcode } from '../src/core/splicer';

// Optional regression fixture: drop a real base/vase G-code pair at the paths
// below to exercise the splicer against a physical print's actual output.
// Both tests skip cleanly when the files aren't present (e.g. in CI or on a
// fresh checkout).
describe('Real File Splicing (local fixture, optional)', () => {
  const pathA = path.join(os.tmpdir(), 'kintsugivase-repro', 'A.gcode');
  const pathB = path.join(os.tmpdir(), 'kintsugivase-repro', 'B.gcode');

  it('splices real A.gcode and B.gcode at Z=16.04mm with forward-only search', () => {
    if (!fs.existsSync(pathA) || !fs.existsSync(pathB)) {
      console.warn('Real files not present on machine, skipping');
      return;
    }

    const baseText = fs.readFileSync(pathA, 'utf8');
    const vaseText = fs.readFileSync(pathB, 'utf8');

    const res = spliceGcode(baseText, vaseText, {
      transitions: [16.04],
      flowMultiplier: 1.0,
      seamMatchEnabled: true,
      seamMatchLayersAfter: 1,
    });

    expect(res.transitions.length).toBe(1);
    const trans = res.transitions[0];
    expect(trans.direction).toBe('baseToVase');
    expect(trans.nominalZ).toBe(16.04);
    expect(trans.matchedZ).not.toBeNull();
    // Invariant: matchedZ must be >= 16.04 (no overlap!)
    expect(trans.matchedZ!).toBeGreaterThanOrEqual(16.04);
    expect(trans.distance!).toBeLessThan(1.0);

    // Verify transition markers
    expect(res.splicedGcode).toContain('; --- KINTSUGIVASE TRANSITION START (matched seam) ---');
    expect(res.splicedGcode).toContain('; --- KINTSUGIVASE TRANSITION END (matched seam) ---');
  });

  it('splices real A.gcode and B.gcode with firstMode: vase and draws outer wall first on incoming base layer', () => {
    if (!fs.existsSync(pathA) || !fs.existsSync(pathB)) {
      console.warn('Real files not present on machine, skipping');
      return;
    }

    const baseText = fs.readFileSync(pathA, 'utf8');
    const vaseText = fs.readFileSync(pathB, 'utf8');

    const res = spliceGcode(baseText, vaseText, {
      transitions: [25.0],
      firstMode: 'vase',
      seamMatchEnabled: true,
    });

    expect(res.transitions.length).toBe(1);
    expect(res.transitions[0].direction).toBe('vaseToBase');

    const transEndMarker = '; --- KINTSUGIVASE TRANSITION END';
    const transEndIdx = res.splicedGcode.indexOf(transEndMarker);
    expect(transEndIdx).toBeGreaterThan(-1);

    // Look at the G-code following the transition
    const postTrans = res.splicedGcode.slice(transEndIdx);
    const outerWallIdx = postTrans.indexOf('; FEATURE: Outer wall');
    const innerWallIdx = postTrans.indexOf('; FEATURE: Inner wall');
    const infillIdx = postTrans.indexOf('; FEATURE: Sparse infill');

    expect(outerWallIdx).toBeGreaterThan(-1);
    expect(innerWallIdx).toBeGreaterThan(-1);

    // Outer wall MUST appear before inner wall and infill
    expect(outerWallIdx).toBeLessThan(innerWallIdx);
    if (infillIdx !== -1) {
      expect(outerWallIdx).toBeLessThan(infillIdx);
    }

    // Verify nozzle lands accurately at outer wall start before extruding
    const outerSnippet = postTrans.slice(0, outerWallIdx + 100);
    expect(outerSnippet).toContain('X135.967 Y131.799');
  });
});
