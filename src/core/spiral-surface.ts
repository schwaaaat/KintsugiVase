import { tokenizeLine } from './tokenizer';
import { getLayerZFromComment } from './seam-solver';
import { tessellateArc } from '../viewer/arc';

export interface SpiralSample {
  x: number; y: number; z: number;
  e: number; f: number; line: number; fraction: number; distance: number;
}
export interface SpiralTurn {
  topZ: number;
  points: SpiralSample[];
  continuous: boolean;
}

/** Source layer boundaries define turns; arc length defines phase within a turn. */
export class SpiralSurface {
  readonly turns: SpiralTurn[] = [];
  constructor(gcode: string) {
    let x = 0, y = 0, z = 0, f = 1800, lastE = 0;
    let relativeE = true, relativeXYZ = false;
    let turn: SpiralTurn | undefined;
    const lines = gcode.split('\n');
    for (let index = 0; index < lines.length; index++) {
      const raw = lines[index];
      const layerZ = getLayerZFromComment(raw);
      if (layerZ !== null && (!turn || Math.abs(turn.topZ - layerZ) > 1e-6)) {
        turn = { topZ: layerZ, points: [], continuous: true };
        this.turns.push(turn);
      }
      if (/^\s*G90\b/i.test(raw)) relativeXYZ = false;
      if (/^\s*G91\b/i.test(raw)) relativeXYZ = true;
      const cmd = tokenizeLine(raw);
      if (cmd.type === 'mode') {
        if (cmd.cmd === 'M83') relativeE = true;
        if (cmd.cmd === 'M82') relativeE = false;
        if (cmd.cmd === 'G92' && cmd.e !== undefined) lastE = cmd.e;
      }
      if (cmd.type !== 'motion') continue;
      const nx = cmd.x === undefined ? x : cmd.x + (relativeXYZ ? x : 0);
      const ny = cmd.y === undefined ? y : cmd.y + (relativeXYZ ? y : 0);
      const nz = cmd.z === undefined ? z : cmd.z + (relativeXYZ ? z : 0);
      if (cmd.f !== undefined) f = cmd.f;
      const de = cmd.e === undefined ? 0 : relativeE ? cmd.e : cmd.e - lastE;
      if (cmd.e !== undefined) lastE = relativeE ? lastE + cmd.e : cmd.e;
      const arc = cmd.g === 2 || cmd.g === 3;
      if (turn && de > 0 && (arc || Math.hypot(nx - x, ny - y) > 1e-8)) {
        if (arc && cmd.i === undefined && cmd.j === undefined) {
          turn.continuous = false;
        }
        if (!turn.points.length) turn.points.push({x, y, z, e:0, f, line:index, fraction:0, distance:0});
        const previous = turn.points[turn.points.length - 1];
        if (Math.hypot(previous.x - x, previous.y - y, previous.z - z) > 0.001 || nz < z - 1e-6) turn.continuous = false;
        const points = arc && (cmd.i !== undefined || cmd.j !== undefined)
          ? tessellateArc(x, y, nx, ny, cmd.i ?? 0, cmd.j ?? 0, cmd.g === 2, cmd.p ?? 0, 0.005, 20000)
          : [{ x:nx, y:ny, t:1 }];
        let oldT = 0;
        for (const point of points) {
          const prior = turn.points[turn.points.length - 1];
          turn.points.push({x:point.x, y:point.y, z:z + (nz-z)*point.t,
            e:de*(point.t-oldT), f, line:index, fraction:point.t,
            distance:prior.distance + Math.hypot(point.x-prior.x,point.y-prior.y)});
          oldT = point.t;
        }
      }
      x = nx; y = ny; z = nz;
    }
    // Empty comment-only layer records are not complete turns.
    for (let i = this.turns.length - 1; i >= 0; i--) if (this.turns[i].points.length < 2) this.turns.splice(i, 1);
  }

  sample(turnIndex: number, phase: number): SpiralSample {
    const turn = this.turns[turnIndex];
    if (!turn || !turn.continuous) throw new Error('Requested source turn is absent or contains discontinuous motion.');
    const points = turn.points;
    const end = points[points.length - 1];
    const distance = Math.max(0, Math.min(1, phase)) * end.distance;
    let lo = 1, hi = points.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (points[mid].distance < distance) lo = mid + 1; else hi = mid; }
    const a = points[lo - 1], b = points[lo];
    const t = b.distance === a.distance ? 0 : (distance - a.distance)/(b.distance - a.distance);
    return {x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t, z:a.z+(b.z-a.z)*t,
      e:b.e*t, f:b.f, line:b.line,
      fraction:(a.line === b.line ? a.fraction : 0) + (b.fraction - (a.line === b.line ? a.fraction : 0))*t,
      distance};
  }

  sampleQ(q: number): SpiralSample {
    const index = Math.min(this.turns.length - 1, Math.floor(q));
    return this.sample(index, q - index);
  }

  crossing(z: number): { q:number; sample:SpiralSample } {
    for (let turnIndex=0;turnIndex<this.turns.length;turnIndex++) {
      const turn=this.turns[turnIndex];
      if (!turn.continuous) continue;
      for (let i=1;i<turn.points.length;i++) {
        const a=turn.points[i-1], b=turn.points[i];
        if (a.z<=z+1e-8 && b.z>=z-1e-8 && b.z>a.z+1e-10) {
          const t=Math.max(0,Math.min(1,(z-a.z)/(b.z-a.z)));
          const distance=a.distance+(b.distance-a.distance)*t;
          const q=turnIndex+distance/turn.points[turn.points.length-1].distance;
          return {q,sample:this.sampleQ(q)};
        }
        if (Math.abs(a.z-z)<1e-8) {
          const q=turnIndex+a.distance/turn.points[turn.points.length-1].distance;
          return {q,sample:this.sampleQ(q)};
        }
      }
    }
    throw new Error(`Source spiral does not cross Z=${z}.`);
  }

  remainderAfter(q:number): {points:SpiralSample[]; nextLine:number} {
    const sample=this.sampleQ(q);
    if (sample.fraction>=1-1e-8) return {points:[sample],nextLine:sample.line+1};
    const turn=this.turns[Math.floor(q)];
    const rest=turn.points.filter(p=>p.line===sample.line && p.fraction>sample.fraction+1e-8);
    const points=[{...sample,e:0},...rest.map(point=>({...point}))];
    // Tessellated point E already represents its source fraction interval. Only
    // the first remainder interval needs shortening.
    if (points.length>1) {
      const first=rest[0];
      const prior=turn.points[turn.points.indexOf(first)-1];
      // Fractions restart at zero for each source command. A crossing commonly
      // lies between the endpoint of one G1 (fraction 1) and the endpoint of the
      // next G1 (also fraction 1), so subtracting those stored fractions would
      // divide by zero and emit EInfinity. Match sample() by treating a prior
      // point from another command as fraction zero in the current command.
      const priorFraction=prior.line===first.line?prior.fraction:0;
      const span=first.fraction-priorFraction;
      if (!(span>1e-12)) throw new Error('Cannot resume a zero-length source extrusion interval.');
      points[1].e=first.e*(first.fraction-sample.fraction)/span;
    }
    return {points,nextLine:sample.line+1};
  }

  nearestQ(z: number, phase: number): number {
    let best = -1, distance = Infinity;
    for (let i = 0; i < this.turns.length; i++) {
      if (!this.turns[i].continuous) continue;
      const d = Math.abs(this.sample(i, phase).z - z);
      if (d < distance) { distance = d; best = i + phase; }
    }
    if (best < 0) throw new Error('No continuous spiral turns are available.');
    return best;
  }

  /** Interpolate the source surface at a constant elevation, including tapered XY. */
  atHeight(z: number, phase: number): {x:number; y:number; z:number} {
    let previous: SpiralSample | undefined;
    for (let index = 0; index < this.turns.length; index++) {
      if (!this.turns[index].continuous) { previous = undefined; continue; }
      const point = this.sample(index, phase);
      if (Math.abs(point.z - z) < 1e-7) return {x:point.x, y:point.y, z};
      if (previous && previous.z < z && point.z > z) {
        const t = (z-previous.z)/(point.z-previous.z);
        return {x:previous.x+(point.x-previous.x)*t, y:previous.y+(point.y-previous.y)*t, z};
      }
      previous = point;
    }
    throw new Error(`Source spiral does not bracket the requested surface at Z=${z}, phase=${phase}.`);
  }
}
