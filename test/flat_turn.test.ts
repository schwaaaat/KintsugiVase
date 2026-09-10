import {describe,expect,it} from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as pathModule from 'node:path';
import {SpiralSurface} from '../src/core/spiral-surface';
import {alignFlatTurnToBaseContour,emitFlatTurn,planFlatTurn} from '../src/core/flat-turn';

// Optional regression fixture: drop a real vase-mode G-code file at this path
// to exercise these tests against actual sliced output. Skips cleanly when absent.
describe('Flat transition turns',()=>{
  const path=pathModule.join(os.tmpdir(),'kintsugivase-repro','B.gcode');
  it.skipIf(!fs.existsSync(path))('builds entry and exit turns on the real surface',()=>{
    const surface=new SpiralSurface(fs.readFileSync(path,'utf8'));
    for(const direction of ['entry','exit'] as const){
      const plan=planFlatTurn(surface,{direction,baseLayerZ:direction==='entry'?16.04:25.16,layerHeight:0.24,width:0.42,speed:20});
      expect(plan.points.every(p=>p.z===plan.planeZ)).toBe(true);
      expect(plan.maxGap).toBeLessThanOrEqual(0.2401);
      expect(Math.hypot(plan.points[0].x-plan.points.at(-1)!.x,plan.points[0].y-plan.points.at(-1)!.y)).toBeLessThan(0.001);
      expect(emitFlatTurn(plan).join('\n')).not.toMatch(/E-/);
      expect(plan.points.slice(1).reduce((sum,p)=>sum+p.e,0)).toBeGreaterThan(0);
      if(direction==='exit') {
        expect(plan.points.at(-1)!.e).toBeLessThan(plan.points[1].e * 0.1);
        expect(plan.points.at(-1)!.e).toBeLessThan(plan.points[Math.floor(plan.points.length/2)].e);
      }
    }
  });

  it.skipIf(!fs.existsSync(path))('prints the base contour flat before blending one full rising turn back to the vase source',()=>{
    const surface=new SpiralSurface(fs.readFileSync(path,'utf8'));
    const plan=planFlatTurn(surface,{direction:'entry',baseLayerZ:16.04,layerHeight:0.2,width:0.42,speed:20});
    const cx=plan.points.slice(0,-1).reduce((sum,p)=>sum+p.x,0)/(plan.points.length-1);
    const cy=plan.points.slice(0,-1).reduce((sum,p)=>sum+p.y,0)/(plan.points.length-1);
    const basePath=plan.points.map(p=>({x:cx+(p.x-cx)*1.03,y:cy+(p.y-cy)*1.03}));
    const aligned=alignFlatTurnToBaseContour(plan,surface,basePath,{layerHeight:0.2,width:0.42,speed:20});
    expect(aligned.points.every(point=>point.z===aligned.planeZ)).toBe(true);
    expect(aligned.blendPoints).toHaveLength(257);
    expect(aligned.blendPoints![0]).toMatchObject(aligned.handoff!);
    expect(aligned.blendPoints!.at(-1)!.z-aligned.blendPoints![0].z).toBeCloseTo(0.2,2);
    const sourceEnd=surface.sampleQ(plan.crossingQ+1),blendEnd=aligned.blendPoints!.at(-1)!;
    expect(Math.hypot(blendEnd.x-sourceEnd.x,blendEnd.y-sourceEnd.y,blendEnd.z-sourceEnd.z)).toBeLessThan(1e-6);
    expect(emitFlatTurn(aligned).indexOf('; --- KINTSUGIVASE BONDING LOOP END ---'))
      .toBeLessThan(emitFlatTurn(aligned).indexOf('; --- KINTSUGIVASE POST-LOOP SPIRAL BLEND START ---'));
  });

  it.skipIf(!fs.existsSync(path))('blends the prior rising turn onto the base contour before printing the flat exit rim',()=>{
    const surface=new SpiralSurface(fs.readFileSync(path,'utf8'));
    const plan=planFlatTurn(surface,{direction:'exit',baseLayerZ:25.16,layerHeight:0.24,
      sourceLayerHeight:0.2,adjacentLayerHeight:0.24,width:0.42,speed:20});
    const cx=plan.points.slice(0,-1).reduce((sum,p)=>sum+p.x,0)/(plan.points.length-1);
    const cy=plan.points.slice(0,-1).reduce((sum,p)=>sum+p.y,0)/(plan.points.length-1);
    const basePath=plan.points.map(p=>({x:cx+(p.x-cx)*1.02,y:cy+(p.y-cy)*1.02}));
    const aligned=alignFlatTurnToBaseContour(plan,surface,basePath,{layerHeight:0.24,width:0.42,speed:20});
    expect(aligned.preBlendPoints).toHaveLength(257);
    expect(aligned.preBlendPoints!.at(-1)).toMatchObject(aligned.handoff!);
    expect(aligned.preBlendPoints!.at(-1)!.z-aligned.preBlendPoints![0].z).toBeCloseTo(0.2,2);
    expect(aligned.cutZ).toBe(aligned.preBlendPoints![0].z);
    expect(aligned.points.every(point=>point.z===aligned.planeZ)).toBe(true);
    expect(aligned.points[1].e).toBeLessThan(aligned.points[Math.floor(aligned.points.length/2)].e*0.5);
    expect(aligned.points.at(-1)!.e).toBeLessThan(aligned.points[1].e*0.1);
    const emitted=emitFlatTurn(aligned).join('\n');
    expect(emitted).toContain('PRE-LOOP SPIRAL BLEND START');
    expect(emitted.indexOf('PRE-LOOP SPIRAL BLEND END')).toBeLessThan(emitted.indexOf('SUPPORTING RIM START'));
  });
});
