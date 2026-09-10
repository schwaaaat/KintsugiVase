import {describe,expect,it} from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {spliceGcode} from '../src/core/splicer';
import {buildToolpathGeometry} from '../src/worker/geometry-builder';

// Optional regression fixture: drop a real base/vase G-code pair at these
// paths to exercise these tests against actual sliced output. Skips cleanly
// when absent.
const basePath=path.join(os.tmpdir(),'kintsugivase-repro','A.gcode');
const vasePath=path.join(os.tmpdir(),'kintsugivase-repro','B.gcode');
const available=fs.existsSync(basePath)&&fs.existsSync(vasePath);

const xy=(line:string)=>{
  const x=line.match(/\bX([+-]?[\d.]+)/i),y=line.match(/\bY([+-]?[\d.]+)/i);
  return x&&y?{x:Number(x[1]),y:Number(y[1])}:null;
};
function distanceToPath(point:{x:number;y:number},path:{x:number;y:number}[]){
  let best=Infinity;
  for(let i=1;i<path.length;i++){
    const a=path[i-1],b=path[i],dx=b.x-a.x,dy=b.y-a.y,length2=dx*dx+dy*dy;
    const t=length2?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/length2)):0;
    best=Math.min(best,Math.hypot(point.x-(a.x+dx*t),point.y-(a.y+dy*t)));
  }
  return best;
}

describe('Integrated planar transitions',()=>{
  it.skipIf(!available)('emits a flat bonding loop for base to vase and retains higher source geometry',()=>{
    const base=fs.readFileSync(basePath,'utf8'),vase=fs.readFileSync(vasePath,'utf8');
    const result=spliceGcode(base,vase,{transitions:[16.04],planarTransitionEnabled:true,
      seamMatchEnabled:true,overlapEnabled:true,leadInEnabled:false,slicedWidth:0.42});
    expect(result.transitions[0].planarTransition).toBe('bondingLoop');
    expect(result.splicedGcode).toContain('KINTSUGIVASE BONDING LOOP START');
    const geometry=buildToolpathGeometry(result.splicedGcode,result.previewTransitions,'base');
    const marker=result.splicedGcode.split('\n');
    const start=marker.findIndex(l=>l.includes('BONDING LOOP START'));
    const end=marker.findIndex(l=>l.includes('BONDING LOOP END'));
    const transitionStart=marker.findIndex(l=>l.includes('TRANSITION START'));
    const z=marker.slice(start,end).flatMap(l=>[...l.matchAll(/\bZ([+-]?[\d.]+)/g)].map(m=>Number(m[1])));
    expect(z.length).toBeGreaterThan(100);
    expect(Math.max(...z)-Math.min(...z)).toBeLessThan(1e-6);
    expect(geometry.metrics.maxZ).toBeCloseTo(buildToolpathGeometry(vase,[],'vase').metrics.maxZ,2);
    expect(result.splicedGcode).not.toContain('Kintsugi lap extension');
    expect(result.transitions[0].matchedZ).not.toBeNull();
    expect(result.transitions[0].distance).toBeLessThanOrEqual(0.55);
    expect(result.splicedGcode).toContain('rotated outer wall');
    expect(result.splicedGcode).toContain('POST-LOOP SPIRAL BLEND START');
    expect(result.transitions[0].generatedGcode).toContain('layer change at aligned seam');
    expect(result.transitions[0].generatedGcode).not.toMatch(/^G[0-3]\b[^;]*[XY]/m);
    expect(result.transitions[0].generatedGcode).not.toMatch(/\bE-/);
    const baseContour=marker.slice(0,transitionStart).filter(l=>l.includes('rotated outer wall')).map(xy).filter((p):p is {x:number;y:number}=>!!p);
    const loopPath=marker.slice(start,end).filter(l=>l.includes('bonding loop')).map(xy).filter((p):p is {x:number;y:number}=>!!p);
    expect(baseContour.length).toBeGreaterThan(20);expect(loopPath.length).toBeGreaterThan(100);
    expect(Math.max(...loopPath.map(point=>distanceToPath(point,[...baseContour,baseContour[0]])))).toBeLessThan(0.01);
    expect(result.splicedGcode).toContain('removed orphaned post-wall seam-hide motion');
    const previousLayer=marker.slice(0,transitionStart).slice(-80);
    const closure=previousLayer.findLastIndex(l=>/^G[0-3]\b.*[XY].*\bE(?:0*[.]?0*[1-9]|[1-9])/i.test(l));
    const afterClosure=previousLayer.slice(closure+1).join('\n');
    expect(afterClosure).not.toMatch(/^G[0-3]\b.*(?:X|Y|E-)/im);
  });

  it.skipIf(!available)('emits a flat supporting rim before vase to base',()=>{
    const base=fs.readFileSync(basePath,'utf8'),vase=fs.readFileSync(vasePath,'utf8');
    const result=spliceGcode(base,vase,{transitions:[25.16],firstMode:'vase',planarTransitionEnabled:true,
      seamMatchEnabled:true,overlapEnabled:false,leadInEnabled:false,slicedWidth:0.42,
      advSpeedEnabled:true,transLayersBefore:2,transSpeed:20});
    expect(result.transitions[0].planarTransition).toBe('supportingRim');
    expect(result.transitions[0].matchedZ).not.toBeNull();
    expect(result.transitions[0].distance).toBeLessThanOrEqual(1);
    const lines=result.splicedGcode.split('\n');
    const rimStart=lines.findIndex(l=>l.includes('SUPPORTING RIM START'));
    const rimEnd=lines.findIndex(l=>l.includes('SUPPORTING RIM END'));
    const transition=lines.findIndex((l,i)=>i>rimEnd&&l.includes('TRANSITION START'));
    expect(rimStart).toBeGreaterThan(0); expect(rimEnd).toBeGreaterThan(rimStart); expect(transition).toBeGreaterThan(rimEnd);
    const z=lines.slice(rimStart,rimEnd).flatMap(l=>[...l.matchAll(/\bZ([+-]?[\d.]+)/g)].map(m=>Number(m[1])));
    expect(Math.max(...z)-Math.min(...z)).toBeLessThan(1e-6);
    const es=lines.slice(rimStart,rimEnd).flatMap(l=>[...l.matchAll(/\bE([+-]?[\d.]+)/g)].map(m=>Number(m[1])));
    expect(es.every(e=>e>=0)).toBe(true);
    expect(Math.max(...es)).toBeGreaterThan(Math.min(...es));
    expect(es[0]).toBeLessThan(es[Math.floor(es.length/2)]*0.5);
    expect(es.at(-1)!).toBeLessThan(es[0]*0.1);
    expect(result.transitions[0].matchedZ).not.toBeNull();
    expect(result.transitions[0].distance).toBeLessThanOrEqual(0.55);
    const joined=lines.slice(rimEnd,lines.findIndex((l,i)=>i>rimEnd&&l.includes('rotated outer wall'))+1).join('\n');
    expect(joined).toContain('layer change at aligned seam');
    expect(result.transitions[0].generatedGcode).not.toMatch(/^G[0-3]\b[^;]*[XY]/m);
    expect(joined).not.toMatch(/\bE-/);
    expect(lines).toContain('; --- KINTSUGIVASE PRE-LOOP SPIRAL BLEND END ---');
    expect(lines).toContain('; --- KINTSUGIVASE SUPPORTING RIM START ---');
    const baseEnd=lines.findIndex((l,i)=>i>rimEnd&&l.includes('; FEATURE: Inner wall'));
    const baseContour=lines.slice(rimEnd,baseEnd).filter(l=>l.includes('rotated outer wall')).map(xy).filter((p):p is {x:number;y:number}=>!!p);
    const rimPath=lines.slice(rimStart,rimEnd).filter(l=>l.includes('supporting rim')).map(xy).filter((p):p is {x:number;y:number}=>!!p);
    expect(baseContour.length).toBeGreaterThan(20);expect(rimPath.length).toBeGreaterThan(100);
    expect(Math.max(...rimPath.map(point=>distanceToPath(point,[...baseContour,baseContour[0]])))).toBeLessThan(0.01);
  });

  it.skipIf(!available)('handles a vase band with both a bonding loop and a supporting rim',()=>{
    const result=spliceGcode(fs.readFileSync(basePath,'utf8'),fs.readFileSync(vasePath,'utf8'),{
      transitions:[16.04,25.16],planarTransitionEnabled:true,seamMatchEnabled:true,
      overlapEnabled:false,leadInEnabled:false,slicedWidth:0.42});
    expect(result.transitions.map(t=>t.planarTransition)).toEqual(['bondingLoop','supportingRim']);
    expect(result.splicedGcode.match(/BONDING LOOP START/g)).toHaveLength(1);
    expect(result.splicedGcode.match(/SUPPORTING RIM START/g)).toHaveLength(1);
  });

  it.skipIf(!available)('rejects transitions too close for both complete turns',()=>{
    expect(()=>spliceGcode(fs.readFileSync(basePath,'utf8'),fs.readFileSync(vasePath,'utf8'),{
      transitions:[16.04,16.2],planarTransitionEnabled:true,seamMatchEnabled:true,
      overlapEnabled:false,leadInEnabled:false,slicedWidth:0.42})).toThrow('too close');
  });

  it.skipIf(!available)('rejects a planar junction when seam matching is explicitly disabled',()=>{
    expect(()=>spliceGcode(fs.readFileSync(basePath,'utf8'),fs.readFileSync(vasePath,'utf8'),{
      transitions:[16.04],planarTransitionEnabled:true,seamMatchEnabled:false,
      overlapEnabled:false,leadInEnabled:false,slicedWidth:0.42})).toThrow('requires seam matching');
  });

  for (const firstMode of ['base','vase'] as const) {
    it.skipIf(!available)(`keeps every junction planar across repeated ${firstMode}-first alternation`,()=>{
      const result=spliceGcode(fs.readFileSync(basePath,'utf8'),fs.readFileSync(vasePath,'utf8'),{
        transitions:[16.04,25.16,34.04],firstMode,planarTransitionEnabled:true,seamMatchEnabled:true,
        overlapEnabled:false,leadInEnabled:false,slicedWidth:0.42});
      expect(result.transitions).toHaveLength(3);
      expect(result.transitions.every(t=>t.matchedZ!==null&&t.distance!==null&&t.distance<=1)).toBe(true);
      const expected=firstMode==='base'
        ? ['bondingLoop','supportingRim','bondingLoop']
        : ['supportingRim','bondingLoop','supportingRim'];
      expect(result.transitions.map(t=>t.planarTransition)).toEqual(expected);
      expect(result.splicedGcode.match(/KINTSUGIVASE TRANSITION START/g)).toHaveLength(3);
      expect(result.transitions.every(t=>!t.generatedGcode.match(/\bE-/))).toBe(true);
      expect(result.splicedGcode.match(/KINTSUGIVASE BONDING LOOP START/g)?.length??0)
        .toBe(expected.filter(value=>value==='bondingLoop').length);
      expect(result.splicedGcode.match(/KINTSUGIVASE SUPPORTING RIM START/g)?.length??0)
        .toBe(expected.filter(value=>value==='supportingRim').length);
      expect(result.splicedGcode.match(/POST-LOOP SPIRAL BLEND START/g)?.length??0)
        .toBe(expected.filter(value=>value==='bondingLoop').length);
    });
  }
});
