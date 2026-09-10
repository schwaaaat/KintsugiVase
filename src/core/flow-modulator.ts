export interface SpeedRampOptions {
  isFirstBand: boolean;
  isLastBand: boolean;
  beforeZoneMM: number;
  afterZoneMM: number;
  targetFMMmin: number;
  rampMode: boolean;
  minExtrudedZ: number | null;
  maxExtrudedZ: number | null;
}

export interface OutputGCodeObject {
  text: string;
  isExtrusion: boolean;
  origF: number;
  z: number;
}

export function writeFeedrate(text: string, newF: number, onlyIfMissing?: boolean): string {
  const hasF = /[Ff][+-]?[0-9.]+/.test(text);
  if (onlyIfMissing && hasF) return text;
  if (hasF) return text.replace(/([Ff])([+-]?[0-9.]+)/, `F${newF.toFixed(0)}`);
  const commentIdx = text.indexOf(';');
  if (commentIdx !== -1) return text.slice(0, commentIdx) + ` F${newF.toFixed(0)} ` + text.slice(commentIdx);
  return text + ` F${newF.toFixed(0)}`;
}

export function applySpeedRamp(outputObjs: OutputGCodeObject[], opts: SpeedRampOptions): void {
  if (!opts.isLastBand && opts.beforeZoneMM > 0 && opts.maxExtrudedZ != null) {
    for (const obj of outputObjs) {
      if (!obj.isExtrusion) continue;
      const zDist = opts.maxExtrudedZ - obj.z;
      if (zDist <= opts.beforeZoneMM && zDist >= 0) {
        const ratio = opts.rampMode ? Math.max(0, Math.min(1, 1.0 - zDist / opts.beforeZoneMM)) : 1.0;
        const newF = obj.origF - (obj.origF - opts.targetFMMmin) * ratio;
        obj.text = writeFeedrate(obj.text, newF);
      }
    }
  }

  if (!opts.isFirstBand && opts.afterZoneMM > 0 && opts.minExtrudedZ != null) {
    let forceRestoreF: number | null = null;
    for (const obj of outputObjs) {
      if (!obj.isExtrusion) continue;
      const zDist = obj.z - opts.minExtrudedZ;
      if (zDist <= opts.afterZoneMM + 0.001 && zDist >= 0) {
        const ratio = opts.rampMode ? Math.max(0, Math.min(1, zDist / opts.afterZoneMM)) : 0.0;
        const newF = opts.targetFMMmin + (obj.origF - opts.targetFMMmin) * ratio;
        obj.text = writeFeedrate(obj.text, newF);
        forceRestoreF = obj.origF;
      } else if (forceRestoreF !== null) {
        obj.text = writeFeedrate(obj.text, forceRestoreF, /*onlyIfMissing=*/ true);
        if (zDist > opts.afterZoneMM + 0.001) forceRestoreF = null;
      }
    }
  }
}

export function classifyType(
  z: number,
  sortedTransitions: number[],
  firstMode: 'base' | 'vase' = 'base'
): 'base' | 'vase' {
  let crossed = 0;
  for (const t of sortedTransitions) {
    if (z > t + 1e-6) crossed++;
  }
  const isBase = firstMode === 'base' ? crossed % 2 === 0 : crossed % 2 !== 0;
  return isBase ? 'base' : 'vase';
}
