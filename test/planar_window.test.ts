import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as pathModule from 'node:path';
import { SpiralSurface } from '../src/core/spiral-surface';
import { planPlanarWindow } from '../src/core/planar-window';

// Optional regression fixture: drop a real vase-mode G-code file at this path
// to exercise these tests against actual sliced output. Skips cleanly when absent.
describe('Planar windows on real source geometry', () => {
  const path=pathModule.join(os.tmpdir(),'kintsugivase-repro','B.gcode');
  it.skipIf(!fs.existsSync(path))('forms a flat entry and flat exit without shifting their outside source endpoints', () => {
    const surface=new SpiralSurface(fs.readFileSync(path,'utf8'));
    for (const direction of ['entry','exit'] as const) {
      const baseZ=direction==='entry'?16.04:25.16;
      const anchorQ=surface.nearestQ(direction==='entry'?baseZ:baseZ-0.24,0.35);
      const plan=planPlanarWindow(surface,{direction,anchorQ,baseZ,layerHeight:0.24,width:0.42,maxLayerHeight:0.32});
      const flat=direction==='entry'?plan.points.slice(0,257):plan.points.slice(-257);
      expect(flat.every(p=>Math.abs(p.z-plan.planeZ)<1e-6)).toBe(true);
      expect(Math.hypot(flat[0].x-flat.at(-1)!.x,flat[0].y-flat.at(-1)!.y)).toBeLessThan(0.05);
      for (let i=1;i<plan.points.length;i++) {
        expect(plan.points[i].z).toBeGreaterThanOrEqual(plan.points[i-1].z-1e-6);
        expect(plan.points[i].e).toBeGreaterThanOrEqual(0);
      }
      const outside=direction==='entry'?plan.points.at(-1)!:plan.points[0];
      const source=surface.sampleQ(direction==='entry'?plan.sourceEndQ:plan.sourceStartQ);
      expect(outside.z).toBeCloseTo(source.z,6);
      expect(Math.hypot(outside.x-source.x,outside.y-source.y)).toBeLessThan(0.01);
    }
  });
});
