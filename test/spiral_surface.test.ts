import { describe, expect, it } from 'vitest';
import { SpiralSurface } from '../src/core/spiral-surface';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

describe('Source spiral surface', () => {
  it('uses physical source positions and distributes helical arc extrusion by arc length', () => {
    const surface = new SpiralSurface('M83\nG1 X10 Y0 Z1\n;Z:1.2\n;HEIGHT:0.2\nG3 X10 Y0 I-10 J0 Z1.2 E2 F1200');
    expect(surface.turns).toHaveLength(1);
    expect(surface.turns[0].continuous).toBe(true);
    expect(surface.sample(0,0.5).z).toBeCloseTo(1.1);
    expect(surface.sample(0,0.5).x).toBeCloseTo(-10,1);
    expect(surface.turns[0].points.reduce((sum,p)=>sum+p.e,0)).toBeCloseTo(2);
    const crossing=surface.crossing(1.1);
    expect(crossing.sample.x).toBeCloseTo(-10,1);
    const remainder=surface.remainderAfter(crossing.q);
    expect(remainder.points.reduce((sum,p)=>sum+p.e,0)).toBeCloseTo(1,2);
  });

  it('reconstructs a closed planar contour from a tapered spiral', () => {
    const lines = ['M83','G1 X10 Y0 Z1'];
    for (let turn=0;turn<4;turn++) {
      lines.push(`;Z:${1+(turn+1)*0.2}`);
      for (let i=1;i<=400;i++) {
        const z=1+(turn+i/400)*0.2, radius=10+(z-1)*2;
        lines.push(`G1 X${(radius*Math.cos(i/400*Math.PI*2)).toFixed(6)} Y${(radius*Math.sin(i/400*Math.PI*2)).toFixed(6)} Z${z.toFixed(6)} E0.005`);
      }
    }
    const surface = new SpiralSurface(lines.join('\n'));
    const a=surface.atHeight(1.4,0), b=surface.atHeight(1.4,1);
    expect(Math.hypot(a.x-b.x,a.y-b.y)).toBeLessThan(1e-7);
    for (const phase of [0,0.25,0.5,0.75,1]) {
      const p=surface.atHeight(1.4,phase);
      expect(Math.hypot(p.x,p.y)).toBeCloseTo(10.8,2);
      expect(p.z).toBe(1.4);
    }
  });

  it('resumes partway through a new G1 without infinite extrusion', () => {
    const surface = new SpiralSurface([
      'M83', 'G1 X0 Y0 Z0', ';Z:0.2',
      'G1 X10 Y0 Z0.1 E1',
      'G1 X10 Y10 Z0.2 E1'
    ].join('\n'));
    const crossing = surface.crossing(0.15);
    const remainder = surface.remainderAfter(crossing.q);
    expect(remainder.points.every(point => Number.isFinite(point.e))).toBe(true);
    expect(remainder.points.reduce((sum, point) => sum + point.e, 0)).toBeCloseTo(0.5);
  });

  it('extracts the available real vase file and measures the candidate planar contour', () => {
    // Optional regression fixture: drop a real vase-mode G-code file at this
    // path to exercise this test against actual sliced output. Skips cleanly
    // when absent.
    const file=path.join(os.tmpdir(),'kintsugivase-repro','B.gcode');
    if (!fs.existsSync(file)) return;
    const surface=new SpiralSurface(fs.readFileSync(file,'utf8'));
    const points=Array.from({length:101},(_,i)=>surface.atHeight(16.32,i/100));
    expect(surface.turns.length).toBeGreaterThan(50);
    expect(points.every(p=>p.z===16.32)).toBe(true);
    expect(Math.hypot(points[0].x-points[100].x,points[0].y-points[100].y)).toBeLessThan(0.05);
  });
});
