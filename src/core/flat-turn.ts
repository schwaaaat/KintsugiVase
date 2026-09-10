import { SpiralSample, SpiralSurface } from './spiral-surface';

export interface FlatTurnPlan {
  direction:'entry'|'exit'; planeZ:number; crossingQ:number;
  crossing:SpiralSample; points:{x:number;y:number;z:number;e:number;f:number}[];
  maxGap:number;
  handoff?:{x:number;y:number;z:number};
  connector?:{x:number;y:number;z:number;e:number;f:number};
  blendPoints?:{x:number;y:number;z:number;e:number;f:number}[];
  resumeQ?:number;
  preBlendPoints?:{x:number;y:number;z:number;e:number;f:number}[];
  cutQ?:number;
  cutZ?:number;
}

function resampleClosed(path:{x:number;y:number}[],samples:number,reverse=false):{x:number;y:number}[] {
  let ring=path.filter((point,index)=>index===0||Math.hypot(point.x-path[index-1].x,point.y-path[index-1].y)>1e-6);
  if(ring.length<3)throw new Error('Selected base outer wall does not contain a complete contour.');
  if(Math.hypot(ring[0].x-ring.at(-1)!.x,ring[0].y-ring.at(-1)!.y)>0.001)ring=[...ring,{...ring[0]}];
  if(reverse)ring=[ring[0],...ring.slice(1,-1).reverse(),ring[0]];
  const cumulative=[0];
  for(let i=1;i<ring.length;i++)cumulative.push(cumulative[i-1]+Math.hypot(ring[i].x-ring[i-1].x,ring[i].y-ring[i-1].y));
  const total=cumulative.at(-1)!;
  if(total<1)throw new Error('Selected base outer wall is too short for a transition contour.');
  const result=[] as {x:number;y:number}[];
  let segment=1;
  for(let i=0;i<=samples;i++){
    const distance=total*i/samples;
    while(segment<cumulative.length-1&&cumulative[segment]<distance)segment++;
    const a=ring[segment-1],b=ring[segment],span=cumulative[segment]-cumulative[segment-1];
    const t=span>0?(distance-cumulative[segment-1])/span:0;
    result.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
  }
  result[result.length-1]={...result[0]};
  return result;
}

/** Align the level turn to the selected base outer wall, then (on entry) blend
 * back to the untouched vase surface during the following rising revolution. */
export function alignFlatTurnToBaseContour(plan:FlatTurnPlan,surface:SpiralSurface,path:{x:number;y:number}[],opts:{
  layerHeight:number;width:number;speed:number;samples?:number
}):FlatTurnPlan {
  const samples=Math.max(32,Math.min(2048,opts.samples??256));
  const phase=plan.crossingQ-Math.floor(plan.crossingQ);
  const candidates=[resampleClosed(path,samples,false),resampleClosed(path,samples,true)];
  const score=(points:{x:number;y:number}[])=>[0.25,0.5,0.75].reduce((sum,t)=>{
    let p=phase+t;if(p>1)p-=1;
    const source=surface.atHeight(plan.planeZ,p),point=points[Math.round(t*samples)];
    return sum+Math.hypot(point.x-source.x,point.y-source.y);
  },0);
  const contour=score(candidates[0])<=score(candidates[1])?candidates[0]:candidates[1];
  const area=Math.PI*(1.75/2)**2,feed=opts.speed*60;
  const contourLength=contour.slice(1).reduce((sum,point,index)=>sum+Math.hypot(point.x-contour[index].x,point.y-contour[index].y),0);
  const exitGap=(t:number)=>{
    const supportGap=Math.max(0,Math.min(opts.layerHeight,plan.planeZ-surface.sampleQ(plan.crossingQ-1+t).z));
    // The preceding spiral ends at full height on the shared seam. Ramp away
    // from that already-filled point over one bead width, then follow the real
    // wedge depth and naturally taper back to zero at loop closure.
    return Math.min(supportGap,opts.layerHeight*Math.min(1,t*contourLength/(opts.width*2)));
  };
  const points=contour.map((point,i)=>{
    if(!i)return {...point,z:plan.planeZ,e:0,f:feed};
    const prior=contour[i-1],length=Math.hypot(point.x-prior.x,point.y-prior.y);
    const t=i/samples,priorT=(i-1)/samples;
    const gap=plan.direction==='entry'?opts.layerHeight:exitGap(t);
    const priorGap=plan.direction==='entry'?opts.layerHeight:exitGap(priorT);
    return {...point,z:plan.planeZ,e:length*opts.width*(gap+priorGap)/2/area,f:feed};
  });
  const handoff={x:contour[0].x,y:contour[0].y,z:plan.planeZ};
  if(plan.direction==='exit'){
    const cutQ=plan.crossingQ-1,cut=surface.sampleQ(cutQ);
    const preBlendPoints=[] as {x:number;y:number;z:number;e:number;f:number}[];
    for(let i=0;i<=samples;i++){
      const t=i/samples,source=surface.sampleQ(cutQ+t),base=contour[i];
      const point={x:source.x+(base.x-source.x)*t,y:source.y+(base.y-source.y)*t,z:source.z,e:0,f:feed};
      if(i){const prior=preBlendPoints[i-1];point.e=Math.hypot(point.x-prior.x,point.y-prior.y,point.z-prior.z)*opts.width*opts.layerHeight/area;}
      preBlendPoints.push(point);
    }
    preBlendPoints[0]={x:cut.x,y:cut.y,z:cut.z,e:0,f:cut.f};
    preBlendPoints[preBlendPoints.length-1]={...handoff,e:preBlendPoints.at(-1)!.e,f:feed};
    return {...plan,points,handoff,preBlendPoints,cutQ,cutZ:cut.z};
  }
  const blendPoints=[] as {x:number;y:number;z:number;e:number;f:number}[];
  for(let i=0;i<=samples;i++){
    const t=i/samples,source=surface.sampleQ(plan.crossingQ+t),base=contour[i];
    const point={x:base.x+(source.x-base.x)*t,y:base.y+(source.y-base.y)*t,z:source.z,e:0,f:feed};
    if(i){const prior=blendPoints[i-1];point.e=Math.hypot(point.x-prior.x,point.y-prior.y,point.z-prior.z)*opts.width*opts.layerHeight/area;}
    blendPoints.push(point);
  }
  blendPoints[0]={...handoff,e:0,f:feed};
  const end=surface.sampleQ(plan.crossingQ+1);
  blendPoints[blendPoints.length-1]={x:end.x,y:end.y,z:end.z,e:blendPoints.at(-1)!.e,f:end.f};
  return {...plan,points,handoff,blendPoints,resumeQ:plan.crossingQ+1};
}

/** Replace a rising revolution with a level bead derived from the source surface. */
export function planFlatTurn(surface:SpiralSurface, opts:{
  direction:'entry'|'exit'; baseLayerZ:number; layerHeight:number;
  sourceLayerHeight?:number; adjacentLayerHeight?:number;
  width:number; speed:number; samples?:number;
}):FlatTurnPlan {
  const sourceHeight=opts.sourceLayerHeight??opts.layerHeight;
  const adjacentHeight=opts.adjacentLayerHeight??opts.layerHeight;
  if (!(sourceHeight>0&&adjacentHeight>0&&opts.width>0&&opts.speed>0)) throw new Error('Invalid flat-turn settings.');
  const planeZ=opts.baseLayerZ+(opts.direction==='entry'?sourceHeight:-adjacentHeight);
  const {q,sample:crossing}=surface.crossing(planeZ);
  const phase=q-Math.floor(q), samples=Math.max(32,Math.min(2048,opts.samples??256));
  const raw=[] as {x:number;y:number;z:number;gap:number}[];
  let maxGap=0;
  for(let i=0;i<=samples;i++) {
    const t=i/samples;
    let p=phase+t; if(p>1)p-=1;
    const xyz=surface.atHeight(planeZ,p);
    const gap=opts.direction==='entry'?sourceHeight:planeZ-surface.sampleQ(q-1+t).z;
    if(gap<-1e-5||gap>sourceHeight+1e-4) throw new Error(`Flat rim support gap ${gap.toFixed(4)}mm is outside one source layer.`);
    raw.push({...xyz,gap:Math.max(0,gap)}); maxGap=Math.max(maxGap,gap);
  }
  // Force exact source continuity at the shared seam.
  raw[0]={x:crossing.x,y:crossing.y,z:planeZ,gap:raw[0].gap};
  // Close XY exactly at the source seam while preserving the support depth
  // calculated for t=1.  On an exit rim that depth is zero because the original
  // rising vase wall has reached this plane; copying raw[0] wholesale would make
  // flow rise back to a full layer at the closure and leave a seam blob.
  raw[raw.length-1]={x:raw[0].x,y:raw[0].y,z:planeZ,gap:raw[raw.length-1].gap};
  const area=Math.PI*(1.75/2)**2;
  const points=raw.map((p,i)=>{
    if(!i)return {...p,e:0,f:opts.speed*60};
    const a=raw[i-1];
    const length=Math.hypot(p.x-a.x,p.y-a.y);
    return {...p,e:length*opts.width*(a.gap+p.gap)/2/area,f:opts.speed*60};
  });
  const circumference=points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-points[i].x,p.y-points[i].y),0);
  if(circumference<1||Math.hypot(points[0].x-points.at(-1)!.x,points[0].y-points.at(-1)!.y)>0.001) throw new Error('Flat turn is not a closed perimeter.');
  return {direction:opts.direction,planeZ,crossingQ:q,crossing,points,maxGap};
}

export function emitFlatTurn(plan:FlatTurnPlan, flowMultiplier=1):string[] {
  const label=plan.direction==='entry'?'BONDING LOOP':'SUPPORTING RIM';
  const lines=[] as string[];
  if(plan.preBlendPoints)lines.push('; --- KINTSUGIVASE PRE-LOOP SPIRAL BLEND START ---','M83 ; Kintsugi planar turn uses relative extrusion',
    ...plan.preBlendPoints.slice(1).map((p,i)=>`G1 X${p.x.toFixed(3)} Y${p.y.toFixed(3)} Z${p.z.toFixed(4)} E${(p.e*flowMultiplier).toFixed(5)}${i===0?` F${p.f.toFixed(0)}`:''} ; Kintsugi: pre-loop spiral blend`),
    '; --- KINTSUGIVASE PRE-LOOP SPIRAL BLEND END ---');
  lines.push(`; --- KINTSUGIVASE ${label} START ---`,'M83 ; Kintsugi planar turn uses relative extrusion');
  if(plan.connector)lines.push(`G1 X${plan.connector.x.toFixed(3)} Y${plan.connector.y.toFixed(3)} Z${plan.connector.z.toFixed(4)} E${(plan.connector.e*flowMultiplier).toFixed(5)} F${plan.connector.f.toFixed(0)} ; Kintsugi: flat contour alignment bridge`);
  lines.push(
    ...plan.points.slice(1).map((p,i)=>`G1 X${p.x.toFixed(3)} Y${p.y.toFixed(3)} Z${p.z.toFixed(4)} E${(p.e*flowMultiplier).toFixed(5)}${i===0?` F${p.f.toFixed(0)}`:''} ; Kintsugi: ${label.toLowerCase()}`),
    `; --- KINTSUGIVASE ${label} END ---`);
  if(plan.blendPoints)lines.push('; --- KINTSUGIVASE POST-LOOP SPIRAL BLEND START ---',
    ...plan.blendPoints.slice(1).map((p,i)=>`G1 X${p.x.toFixed(3)} Y${p.y.toFixed(3)} Z${p.z.toFixed(4)} E${(p.e*flowMultiplier).toFixed(5)}${i===0?` F${p.f.toFixed(0)}`:''} ; Kintsugi: post-loop spiral blend`),
    '; --- KINTSUGIVASE POST-LOOP SPIRAL BLEND END ---');
  return lines;
}
