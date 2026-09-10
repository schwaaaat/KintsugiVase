import { describe, it, expect } from 'vitest';
import { spliceGcode } from '../src/core/splicer';

function generateSeamHideBaseGcode({ layers, layerHeight }: { layers: number; layerHeight: number }) {
  const lines = [
    '; synthetic base (with seam-hide trailing dance)',
    `; max_z_height: ${(layers * layerHeight).toFixed(2)}`,
    'M104 S220',
    'M109 S220',
    'M106 S255',
    'M83',
    'G92 E0',
  ];
  for (let l = 1; l <= layers; l++) {
    const z = +(l * layerHeight).toFixed(3);
    lines.push(';LAYER_CHANGE');
    lines.push(`;Z:${z.toFixed(2)}`);
    lines.push(`;HEIGHT:${layerHeight.toFixed(2)}`);
    lines.push(`G1 Z${z.toFixed(3)} F1800`);
    lines.push('; FEATURE: Inner wall');
    lines.push('G1 X10.000 Y10.000 F6000');
    lines.push('G1 X20.000 Y10.000 E0.50000 F1800');
    lines.push('G1 X20.000 Y20.000 E0.50000 F1800');
    lines.push('G1 X10.000 Y20.000 E0.50000 F1800');
    lines.push('G1 X10.000 Y10.000 E0.50000 F1800');
    lines.push('; FEATURE: Outer wall');
    lines.push('G1 X9.500 Y9.500 F6000');
    lines.push('G1 X20.500 Y9.500 E0.55000 F1800');
    lines.push('G1 X20.500 Y20.500 E0.55000 F1800');
    lines.push('G1 X9.500 Y20.500 E0.55000 F1800');
    lines.push('G1 X9.500 Y9.500 E0.55000 F1800 ; closes the loop back at (9.5, 9.5)');
    lines.push('G1 E-0.80000 F1800 ; retract');
    lines.push(`G1 X12.000 Y12.000 Z${(z + 0.4).toFixed(3)} F30000 ; move to first infill point`);
    lines.push('G1 X13.000 Y13.000 ; move to first infill point');
    lines.push(`G1 Z${z.toFixed(3)} ; reset Z after contouring`);
    lines.push('G1 E0.80000 F1800 ; unretract');
    lines.push('; FEATURE: Sparse infill');
    lines.push('G1 X12.000 Y12.000 F6000');
    lines.push('G1 X18.000 Y18.000 E0.30000 F3600');
  }
  lines.push('; end of base print');
  return lines.join('\n');
}

function generateTwoIslandBaseGcode({ layers, layerHeight }: { layers: number; layerHeight: number }) {
  const lines = [
    '; synthetic two-island base',
    `; max_z_height: ${(layers * layerHeight).toFixed(2)}`,
    'M104 S220',
    'M109 S220',
    'M106 S255',
    'M83',
    'G92 E0',
  ];
  for (let l = 1; l <= layers; l++) {
    const z = +(l * layerHeight).toFixed(3);
    lines.push(';LAYER_CHANGE');
    lines.push(`;Z:${z.toFixed(2)}`);
    lines.push(`;HEIGHT:${layerHeight.toFixed(2)}`);
    lines.push(`G1 Z${z.toFixed(3)} F1800`);
    // Decoy island printed first
    lines.push('; FEATURE: Inner wall');
    lines.push('G1 X110.000 Y110.000 F6000');
    lines.push('G1 X115.000 Y110.000 E0.20000 F1800');
    lines.push('G1 X115.000 Y115.000 E0.20000 F1800');
    lines.push('G1 X110.000 Y115.000 E0.20000 F1800');
    lines.push('G1 X110.000 Y110.000 E0.20000 F1800');
    lines.push('; FEATURE: Outer wall');
    lines.push('G1 X109.500 Y109.500 F6000');
    lines.push('G1 X115.500 Y109.500 E0.22000 F1800');
    lines.push('G1 X115.500 Y115.500 E0.22000 F1800');
    lines.push('G1 X109.500 Y115.500 E0.22000 F1800');
    lines.push('G1 X109.500 Y109.500 E0.22000 F1800 ; decoy island closes at (109.5, 109.5)');
    // Real body island printed second
    lines.push('; FEATURE: Inner wall');
    lines.push('G1 X10.000 Y10.000 F6000');
    lines.push('G1 X20.000 Y10.000 E0.50000 F1800');
    lines.push('G1 X20.000 Y20.000 E0.50000 F1800');
    lines.push('G1 X10.000 Y20.000 E0.50000 F1800');
    lines.push('G1 X10.000 Y10.000 E0.50000 F1800');
    lines.push('; FEATURE: Outer wall');
    lines.push('G1 X9.500 Y9.500 F6000');
    lines.push('G1 X20.500 Y9.500 E0.55000 F1800');
    lines.push('G1 X20.500 Y20.500 E0.55000 F1800');
    lines.push('G1 X9.500 Y20.500 E0.55000 F1800');
    lines.push('G1 X9.500 Y9.500 E0.55000 F1800 ; body island closes at (9.5, 9.5)');
    lines.push('; FEATURE: Sparse infill');
    lines.push('G1 X12.000 Y12.000 F6000');
    lines.push('G1 X18.000 Y18.000 E0.30000 F3600');
  }
  lines.push('; end of base print');
  return lines.join('\n');
}

function generateCircleVaseGcode({
  layers,
  layerHeight,
  radius,
  segsPerLayer = 64,
}: {
  layers: number;
  layerHeight: number;
  radius: number;
  segsPerLayer?: number;
}) {
  const lines = [
    '; synthetic vase',
    `; max_z_height: ${(layers * layerHeight).toFixed(2)}`,
    'M104 S215',
    'M109 S215',
    'M106 S200',
    'M83',
    'G92 E0',
  ];
  let prevZ = 0;
  for (let l = 1; l <= layers; l++) {
    const zTarget = +(l * layerHeight).toFixed(4);
    lines.push(';LAYER_CHANGE');
    lines.push(`;Z:${zTarget.toFixed(2)}`);
    lines.push(`;HEIGHT:${layerHeight.toFixed(2)}`);
    for (let s = 1; s <= segsPerLayer; s++) {
      const theta = (s / segsPerLayer) * 2 * Math.PI;
      const x = radius * Math.cos(theta);
      const y = radius * Math.sin(theta);
      const zFrac = prevZ + (zTarget - prevZ) * (s / segsPerLayer);
      lines.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} Z${zFrac.toFixed(4)} E0.02000 F1800`);
    }
    prevZ = zTarget;
  }
  lines.push('; end of vase print');
  return lines.join('\n');
}

describe('Seam Matching Directional Invariants (5 Scenarios)', () => {
  const layerHeight = 0.2;
  const transitionZ = 1.0;
  const baseGcode = generateSeamHideBaseGcode({ layers: 10, layerHeight });
  const closeRadius = Math.hypot(9.5, 9.5); // ~13.435mm
  const closeVaseGcode = generateCircleVaseGcode({ layers: 20, layerHeight, radius: closeRadius });
  const farVaseGcode = generateCircleVaseGcode({ layers: 20, layerHeight, radius: 3.0 });

  it('Scenario 1: close geometry, seam matching ON produces matched seam, outer-wall-last reordering, and intact unretract', () => {
    const res = spliceGcode(baseGcode, closeVaseGcode, {
      transitions: [transitionZ],
      seamMatchEnabled: true,
    });

    expect(res.transitions[0].matchedZ).not.toBeNull();
    expect(res.transitions[0].distance).toBeLessThan(1.0);
    expect(res.splicedGcode).toContain('; --- KINTSUGIVASE TRANSITION START (matched seam) ---');

    // Confirm outer wall block is reordered to print LAST in base layer
    const transitionIdx = res.splicedGcode.indexOf('; --- KINTSUGIVASE TRANSITION START');
    const preSeam = res.splicedGcode.substring(0, transitionIdx);
    const infillIdx = preSeam.lastIndexOf('; FEATURE: Sparse infill');
    const outerIdx = preSeam.lastIndexOf('; FEATURE: Outer wall');
    expect(outerIdx).toBeGreaterThan(infillIdx);

    // Trailing unretract preserved
    const outerBlock = preSeam.substring(outerIdx);
    expect(outerBlock).toContain('unretract');
  });

  it('Scenario 2: close geometry, seam matching OFF falls back to full legacy seam with retract', () => {
    const res = spliceGcode(baseGcode, closeVaseGcode, {
      transitions: [transitionZ],
      seamMatchEnabled: false,
    });

    expect(res.transitions[0].matchedZ).toBeNull();
    expect(res.splicedGcode).not.toContain('; --- KINTSUGIVASE TRANSITION START (matched seam) ---');
    expect(res.splicedGcode).toContain('Retract to prevent oozing');
    expect(res.splicedGcode).toContain('Z-Hop to clear');
  });

  it('Scenario 3: far geometry, seam matching ON falls back to full legacy seam', () => {
    const res = spliceGcode(baseGcode, farVaseGcode, {
      transitions: [transitionZ],
      seamMatchEnabled: true,
    });

    expect(res.transitions[0].matchedZ).toBeNull();
    expect(res.splicedGcode).not.toContain('; --- KINTSUGIVASE TRANSITION START (matched seam) ---');
    expect(res.splicedGcode).toContain('Retract to prevent oozing');
  });

  it('Scenario 4: two-island base layer matches against LAST-placed (body) island, not decoy', () => {
    const twoIslandBase = generateTwoIslandBaseGcode({ layers: 10, layerHeight });
    const res = spliceGcode(twoIslandBase, closeVaseGcode, {
      transitions: [transitionZ],
      seamMatchEnabled: true,
    });

    expect(res.transitions[0].matchedZ).not.toBeNull();
    expect(res.splicedGcode).toContain('; --- KINTSUGIVASE TRANSITION START (matched seam) ---');

    // Matched travel should target body island near (9.5, 9.5), NOT decoy at (109.5, 109.5)
    const matchTravel = res.splicedGcode.match(/G1 X([0-9.]+) Y([0-9.]+).*direct travel/);
    expect(matchTravel).not.toBeNull();
    const tx = parseFloat(matchTravel![1]);
    const ty = parseFloat(matchTravel![2]);
    expect(tx).toBeLessThan(50);
    expect(ty).toBeLessThan(50);
  });

  it('Scenario 5: closer match below transition Z is strictly ignored (beforeMM = 0, no Z overlap)', () => {
    const decoyBelowVase = [
      '; synthetic vase with point below and above transitionZ',
      'M83',
      'G92 E0',
      ';LAYER_CHANGE\n;Z:0.80\n;HEIGHT:0.20',
      'G1 X0 Y0 Z0.8000 E0.02',
      'G1 X9.510 Y9.500 Z0.9000 E0.02', // 0.01mm away, but Z=0.90 < 1.0
      ';LAYER_CHANGE\n;Z:1.00\n;HEIGHT:0.20',
      'G1 X0 Y0 Z1.0000 E0.02',
      'G1 X9.650 Y9.500 Z1.0500 E0.02', // 0.15mm away, at Z=1.050 >= 1.0
      ';LAYER_CHANGE\n;Z:1.20\n;HEIGHT:0.20',
      'G1 X20 Y20 Z1.2000 E0.02',
    ].join('\n');

    const res = spliceGcode(baseGcode, decoyBelowVase, {
      transitions: [transitionZ],
      seamMatchEnabled: true,
    });

    expect(res.transitions[0].matchedZ).not.toBeNull();
    // Must be at or above 1.0
    expect(res.transitions[0].matchedZ!).toBeGreaterThanOrEqual(1.0);
    expect(res.transitions[0].matchedZ!).toBe(1.05);
  });
});
