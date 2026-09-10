import { describe, it, expect } from 'vitest';
import {
  tokenizeLine,
  cleanLine,
  KinematicStateMachine,
  findClosestApproach,
  locateOuterWallFirstEntry,
  locateOuterWallLastExit,
  reorderLayerOuterWallFirst,
  reorderLayerOuterWallLast,
  trimAfterLastDepositingMove,
  spliceGcode,
  tessellateArc,
  classifyType,
  generateOuterWallLapExtension,
  computeTangentialLeadIn,
} from '../src/core';
// @ts-ignore
import { generateBaseGcode, generateVaseGcode } from './gen_gcode';

describe('GCode Tokenizer & State Machine', () => {
  it('tokenizes motion and extracts XYZ coordinates accurately', () => {
    const cmd = tokenizeLine('G1 X12.345 Y-67.890 Z1.200 E0.0456 F3000 ; test move');
    expect(cmd.type).toBe('motion');
    if (cmd.type === 'motion') {
      expect(cmd.g).toBe(1);
      expect(cmd.x).toBe(12.345);
      expect(cmd.y).toBe(-67.890);
      expect(cmd.z).toBe(1.2);
      expect(cmd.e).toBe(0.0456);
      expect(cmd.f).toBe(3000);
    }
  });

  it('tracks kinematic state across absolute/relative modes', () => {
    const sm = new KinematicStateMachine();
    sm.process(tokenizeLine('M83'));
    const res1 = sm.process(tokenizeLine('G1 X10 Y20 Z0.2 E1.5 F1800'));
    expect(res1.isExtrusion).toBe(true);
    expect(res1.deltaE).toBe(1.5);
    expect(sm.state.totalExtrudedE).toBe(1.5);
    expect(sm.state.x).toBe(10);
    expect(sm.state.y).toBe(20);
    expect(sm.state.z).toBe(0.2);

    // Absolute E mode
    sm.process(tokenizeLine('M82'));
    sm.process(tokenizeLine('G92 E1.5'));
    const res2 = sm.process(tokenizeLine('G1 X15 Y25 E2.0'));
    expect(res2.isExtrusion).toBe(true);
    expect(res2.deltaE).toBeCloseTo(0.5);
    expect(sm.state.totalExtrudedE).toBeCloseTo(2.0);
  });
});

describe('Arc Tessellation & Continuity', () => {
  it('tessellates circular arc within sagitta tolerance', () => {
    // Quarter circle radius 10 from (10, 0) to (0, 10) with center (0, 0) -> iOff = -10, jOff = 0
    const waypoints = tessellateArc(10, 0, 0, 10, -10, 0, false, 0, 0.03, 48);
    expect(waypoints.length).toBeGreaterThan(1);
    const lastWp = waypoints[waypoints.length - 1];
    expect(lastWp.x).toBeCloseTo(0);
    expect(lastWp.y).toBeCloseTo(10);
    expect(lastWp.t).toBe(1);

    // Check radius of intermediate waypoints
    for (const wp of waypoints) {
      const r = Math.hypot(wp.x, wp.y);
      expect(r).toBeCloseTo(10, 2);
    }
  });

  it('preserves true entry position for arc-opening outer wall blocks (outer-wall-first)', () => {
    const layer = [
      ';TYPE:Inner wall',
      'G1 X5 Y5 F3000',
      'G1 X10 Y5 E1.0',
      ';TYPE:Outer wall',
      'G3 X15 Y10 I0 J5 E1.0 F1800 ; arc starting from (10, 5)',
      'G1 X5 Y10 E1.0',
    ];

    const res = reorderLayerOuterWallFirst(layer, 0, 0);
    expect(res.wasReordered).toBe(true);
    // Outer wall starts with an arc, so its entry target must be (10, 5)
    expect(res.outerStartX).toBe(10);
    expect(res.outerStartY).toBe(5);
  });

  it('preserves true entry position and places outer wall first for linear perimeters', () => {
    const layer = [
      ';LAYER_CHANGE',
      ';Z:25.0',
      'G1 E-0.8 F1800 ; retract',
      'G1 X10 Y10 F30000 ; move to inner wall',
      'G1 E0.8 F1800 ; unretract',
      '; FEATURE: Inner wall',
      'G1 X15 Y10 E0.5 F2400',
      'M204 S5000',
      'G1 X20 Y10 F30000 ; move to outer wall',
      '; FEATURE: Outer wall',
      'G1 X25 Y10 E0.6 F2400',
      '; FEATURE: Sparse infill',
      'G1 X12 Y12 E0.4 F3600',
    ];

    const res = reorderLayerOuterWallFirst(layer, 0, 0);
    expect(res.wasReordered).toBe(true);
    expect(res.outerStartX).toBe(20);
    expect(res.outerStartY).toBe(10);

    // Verify outer wall appears before inner wall
    const outerIdx = res.lines.findIndex((l) => l.includes('; FEATURE: Outer wall'));
    const innerIdx = res.lines.findIndex((l) => l.includes('; FEATURE: Inner wall'));
    const infillIdx = res.lines.findIndex((l) => l.includes('; FEATURE: Sparse infill'));
    expect(outerIdx).toBeGreaterThan(-1);
    expect(innerIdx).toBeGreaterThan(outerIdx);
    expect(infillIdx).toBeGreaterThan(innerIdx);

    // Verify inner wall still has its proper approach travel moves
    const linesBeforeInner = res.lines.slice(outerIdx, innerIdx);
    expect(linesBeforeInner.some((l) => l.includes('X10 Y10'))).toBe(true);
  });
});

describe('Base -> Vase Seam Matching & Wall Reordering', () => {
  it('reorders outer wall last and preserves trailing seam-hide unretract', () => {
    const layer = [
      ';TYPE:Outer wall',
      'G1 X0 Y0 F3000',
      'G1 X10 Y0 E1.0',
      'G1 X10 Y10 E1.0',
      'G1 E-1.0 F1800 ; seam-hide retract',
      'G1 X5 Y5 F6000 ; travel',
      'G1 E1.0 F1800 ; seam-hide unretract',
      ';TYPE:Sparse infill',
      'G1 X2 Y2 F3000',
      'G1 X8 Y8 E0.5',
    ];

    const res = reorderLayerOuterWallLast(layer, 0, 0);
    expect(res.wasReordered).toBe(true);
    // Outer wall closure must be the last extruded point with XY motion: (10, 10)
    expect(res.outerEndX).toBe(10);
    expect(res.outerEndY).toBe(10);

    // Verify outer wall block is now at the END
    const lastLines = res.lines.slice(-7);
    expect(lastLines[0]).toContain(';TYPE:Outer wall');
    expect(lastLines.some((l) => l.includes('E1.0 F1800 ; seam-hide unretract'))).toBe(true);
  });

  it('can remove an orphaned seam-hide tail for a planar handoff', () => {
    const layer = [
      '; FEATURE: Outer wall',
      'G1 X0 Y0 F6000',
      'G1 X10 Y0 E0.5 F1800',
      'G1 X0 Y0 E0.5 F1800 ; wall closure',
      'G1 E-1 F1800 ; seam-hide retract',
      'G1 X3 Y3 Z0.6 F30000 ; orphaned travel',
      'G1 Z0.2',
      'G1 E1 F1800 ; seam-hide unretract',
    ];
    const trimmed = trimAfterLastDepositingMove(layer);
    expect(trimmed).toContain('G1 X0 Y0 E0.5 F1800 ; wall closure');
    expect(trimmed.join('\n')).toContain('removed orphaned post-wall seam-hide motion');
    expect(trimmed.join('\n')).not.toContain('seam-hide retract');
    expect(trimmed.join('\n')).not.toContain('orphaned travel');
    expect(trimmed.join('\n')).not.toContain('seam-hide unretract');
  });

  it('strictly searches forward (beforeMM = 0) to avoid Z overlap', () => {
    const vaseLines = [
      ';Z:1.0',
      'G1 X10 Y10 Z0.98 E0.1', // Closer in XY but below Z=1.0
      ';Z:1.2',
      'G1 X10.1 Y10.1 Z1.05 E0.1', // Slightly further in XY but at or above Z=1.0
    ];

    // Searching from z=1.0 with beforeMM=0
    const approach = findClosestApproach(vaseLines, 10, 10, 1.0, 0, 0.4);
    expect(approach).not.toBeNull();
    expect(approach!.z).toBeGreaterThanOrEqual(1.0);
    expect(approach!.z).toBe(1.05);
  });
});

describe('End-to-End Splice Pipeline', () => {
  it('splices Base and Vase files cleanly with single and multi-transitions', () => {
    const baseGcode = generateBaseGcode({ layers: 10, layerHeight: 0.2, size: 20 });
    const vaseGcode = generateVaseGcode({ layers: 30, layerHeight: 0.2, size: 20 });

    const result = spliceGcode(baseGcode, vaseGcode, {
      transitions: [1.2],
      flowMultiplier: 1.0,
      taperEnabled: true,
      taperDistanceMM: 15,
      taperStartRatio: 0.25,
      seamMatchEnabled: true,
    });

    expect(result.splicedGcode).toContain('; --- KINTSUGIVASE TRANSITION');
    expect(result.finalLayerCount).toBeGreaterThan(0);
    expect(result.totalExtrudedE).toBeGreaterThan(0);
    expect(result.transitions.length).toBe(1);
    expect(result.transitions[0].direction).toBe('baseToVase');
  });

  it('handles multi-transition alternating bands (base -> vase -> base)', () => {
    const baseGcode = generateBaseGcode({ layers: 25, layerHeight: 0.2, size: 20 });
    const vaseGcode = generateVaseGcode({ layers: 25, layerHeight: 0.2, size: 20 });

    const result = spliceGcode(baseGcode, vaseGcode, {
      transitions: [1.0, 2.4],
      flowMultiplier: 1.0,
      seamMatchEnabled: true,
    });

    expect(result.transitions.length).toBe(2);
    expect(result.transitions[0].direction).toBe('baseToVase');
    expect(result.transitions[1].direction).toBe('vaseToBase');
  });

  it('splices with Vase-first initial mode (vase -> base)', () => {
    const baseGcode = generateBaseGcode({ layers: 25, layerHeight: 0.2, size: 20 });
    const vaseGcode = generateVaseGcode({ layers: 25, layerHeight: 0.2, size: 20 });

    const result = spliceGcode(baseGcode, vaseGcode, {
      transitions: [1.2],
      firstMode: 'vase',
      flowMultiplier: 1.0,
      seamMatchEnabled: true,
    });

    expect(result.splicedGcode).toContain('; Initial Mode: vase');
    expect(result.splicedGcode).toContain('; --- KINTSUGIVASE TRANSITION');
    expect(result.transitions.length).toBe(1);
    expect(result.transitions[0].direction).toBe('vaseToBase');
  });

  it('handles multi-transition Vase-first bands (vase -> base -> vase)', () => {
    const baseGcode = generateBaseGcode({ layers: 25, layerHeight: 0.2, size: 20 });
    const vaseGcode = generateVaseGcode({ layers: 25, layerHeight: 0.2, size: 20 });

    const result = spliceGcode(baseGcode, vaseGcode, {
      transitions: [1.0, 2.4],
      firstMode: 'vase',
      flowMultiplier: 1.0,
      seamMatchEnabled: true,
    });

    expect(result.transitions.length).toBe(2);
    expect(result.transitions[0].direction).toBe('vaseToBase');
    expect(result.transitions[1].direction).toBe('baseToVase');
  });

  it('classifies toolpath type according to firstMode', () => {
    // Single transition at 1.0mm
    expect(classifyType(0.5, [1.0], 'base')).toBe('base');
    expect(classifyType(1.5, [1.0], 'base')).toBe('vase');

    expect(classifyType(0.5, [1.0], 'vase')).toBe('vase');
    expect(classifyType(1.5, [1.0], 'vase')).toBe('base');
  });

  describe('Scarf Lap Joint & Tangential Lead-In Mechanics', () => {
    it('generates decaying overlap extension along outer wall perimeter', () => {
      const outerLines = [
        'G1 X10.000 Y10.000 F6000',
        'G1 X20.000 Y10.000 E0.50000 F1800',
        'G1 X20.000 Y20.000 E0.50000 F1800',
        'G1 X10.000 Y20.000 E0.50000 F1800',
        'G1 X10.000 Y10.000 E0.50000 F1800',
      ];

      // Request 15mm overlap (10mm on first edge + 5mm on second edge)
      const lap = generateOuterWallLapExtension(outerLines, 15);
      expect(lap.lines.length).toBeGreaterThan(0);
      expect(lap.lapDistance).toBeCloseTo(15, 1);
      expect(lap.lines.some((l) => l.includes('Kintsugi: lap joint overlap'))).toBe(true);

      // Flow ratio on moves should decay
      expect(lap.totalLapE).toBeGreaterThan(0);
      expect(lap.endX).toBeCloseTo(20, 1);
      expect(lap.endY).toBeCloseTo(15, 1);
    });

    it('computes interior-offset tangential lead-in coordinates', () => {
      // Heading in +X along bottom edge (Y=10), center is at (50, 50)
      const lead = computeTangentialLeadIn(10, 10, 20, 10, 50, 50, 2.0);
      // Inward normal is +Y (pointing towards 50).
      // Lead-in coordinate should be shifted into the interior (+Y) and slightly backward (-X)
      expect(lead.leadInX).toBeLessThan(10);
      expect(lead.leadInY).toBeGreaterThan(10);
    });

    it('splices with Scarf Lap Joint and Tangential Lead-In enabled', () => {
      const baseLines = [
        '; generated by OrcaSlicer',
        '; max_z_height: 5.00',
        'M83',
        'G92 E0',
        ';LAYER_CHANGE\n;Z:1.00\n;HEIGHT:0.20',
        '; FEATURE: Inner wall',
        'G1 X10 Y10 F6000',
        'G1 X20 Y10 E0.5 F1800',
        '; FEATURE: Outer wall',
        'G1 X9 Y9 F6000',
        'G1 X21 Y9 E0.6 F1800',
        'G1 X21 Y21 E0.6 F1800',
        'G1 X9 Y21 E0.6 F1800',
        'G1 X9 Y9 E0.6 F1800',
        '; FEATURE: Sparse infill',
        'G1 X15 Y15 F6000',
        'G1 X18 Y18 E0.2 F3600',
        ';LAYER_CHANGE\n;Z:1.20\n;HEIGHT:0.20',
        '; FEATURE: Outer wall',
        'G1 X9 Y9 F6000',
        'G1 X21 Y9 E0.6 F1800',
        'G1 X21 Y21 E0.6 F1800',
        'G1 X9 Y21 E0.6 F1800',
        'G1 X9 Y9 E0.6 F1800',
        '; end of base',
      ].join('\n');

      const vaseGcode = generateVaseGcode({ layers: 20, layerHeight: 0.2, size: 20 });

      const result = spliceGcode(baseLines, vaseGcode, {
        transitions: [1.2],
        overlapEnabled: true,
        overlapDistanceMM: 8.0,
        leadInEnabled: true,
        leadInDistanceMM: 1.5,
        seamMatchEnabled: false, // forces transition block with lead-in wipe
      });

      expect(result.splicedGcode).toContain('; Kintsugi: lap joint overlap');
      expect(result.splicedGcode).toContain('; Kintsugi: Tangential lead-in wipe onto perimeter');
    });
  });
});
