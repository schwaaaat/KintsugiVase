export interface ArcWaypoint {
  x: number;
  y: number;
  t: number;
}

export function tessellateArc(
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  iOff: number,
  jOff: number,
  clockwise: boolean,
  extraTurns: number,
  sagittaTolerance: number = 0.03,
  maxSegments: number = 48
): ArcWaypoint[] {
  const cx = sx + iOff;
  const cy = sy + jOff;
  const radius = Math.hypot(iOff, jOff);
  if (!(radius > 1e-6)) return [{ x: ex, y: ey, t: 1 }];

  const startAngle = Math.atan2(sy - cy, sx - cx);
  const isFullCircle = Math.abs(ex - sx) < 1e-3 && Math.abs(ey - sy) < 1e-3;
  let sweep: number;
  if (isFullCircle) {
    sweep = 2 * Math.PI;
  } else {
    const endAngle = Math.atan2(ey - cy, ex - cx);
    sweep = clockwise ? startAngle - endAngle : endAngle - startAngle;
    if (sweep <= 1e-9) sweep += 2 * Math.PI;
  }
  sweep += 2 * Math.PI * Math.max(0, extraTurns || 0);

  const maxThetaPerSeg = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - sagittaTolerance / radius)));
  let segCount = Math.max(1, Math.ceil(sweep / (maxThetaPerSeg || sweep)));
  segCount = Math.min(segCount, maxSegments);

  const dir = clockwise ? -1 : 1;
  const pts: ArcWaypoint[] = [];
  for (let k = 1; k <= segCount; k++) {
    const t = k / segCount;
    if (k === segCount && !isFullCircle) {
      pts.push({ x: ex, y: ey, t: 1 });
    } else {
      const angle = startAngle + dir * sweep * t;
      pts.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle), t });
    }
  }
  return pts;
}
