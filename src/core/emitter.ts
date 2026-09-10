export interface TransitionBlockParams {
  matched: boolean;
  distance?: number;
  resumeX: number;
  resumeY: number;
  resumeZ: number;
  hopZ: number;
  travelSpeed: number;
  primeSpeed: number;
  overrideTemp: number | null;
  overrideFan: number | null;
  tempHotend: string | null;
  tempWait: string | null;
  fan: string | null;
  leadInX?: number;
  leadInY?: number;
  bridgeE?: number;
  verticalOnly?: boolean;
}

export function emitTransitionBlock(params: TransitionBlockParams): string[] {
  const lines: string[] = [];

  if (params.matched && params.distance !== undefined) {
    lines.push('\n; --- KINTSUGIVASE TRANSITION START (matched seam) ---');
    lines.push(params.verticalOnly
      ? `; Kintsugi: planar contours aligned; source-to-base offset ${params.distance.toFixed(3)}mm resolved before this Z-only hand-off, no retract`
      : `; Kintsugi: matched within ${params.distance.toFixed(3)}mm of the base outer-wall seam point -- direct hand-off, no retract`
    );
    lines.push('M83 ; Ensure relative extrusion');
    lines.push(params.bridgeE && params.bridgeE > 0
      ? `G1 X${params.resumeX.toFixed(3)} Y${params.resumeY.toFixed(3)} Z${params.resumeZ.toFixed(3)} E${params.bridgeE.toFixed(5)} F${params.primeSpeed} ; Kintsugi: short bonding bridge to aligned planar seam`
      : params.verticalOnly
      ? `G1 Z${params.resumeZ.toFixed(3)} F${params.travelSpeed} ; Kintsugi: layer change at aligned seam (no XY travel, no retract)`
      : `G1 X${params.resumeX.toFixed(3)} Y${params.resumeY.toFixed(3)} Z${params.resumeZ.toFixed(3)} F${params.travelSpeed} ; Kintsugi: direct travel to resume point (non-extruding, no retract)`
    );

    if (params.overrideTemp !== null && !isNaN(params.overrideTemp)) {
      lines.push(`M104 S${params.overrideTemp} ; Kintsugi: Override Blend Temp`);
    } else if (params.tempHotend) {
      lines.push(params.tempHotend + ' ; Kintsugi Blend Temp');
    }

    if (params.overrideFan !== null && !isNaN(params.overrideFan)) {
      lines.push(`M106 S${params.overrideFan} ; Kintsugi: Override Blend Fan`);
    } else if (params.fan) {
      lines.push(params.fan + ' ; Kintsugi Blend Fan');
    }

    lines.push('; --- KINTSUGIVASE TRANSITION END (matched seam) ---\n');
  } else {
    lines.push('\n; --- KINTSUGIVASE TRANSITION START ---');
    lines.push(`G1 E-1.0 F${params.primeSpeed} ; Kintsugi: Retract to prevent oozing`);
    lines.push(`G1 Z${params.hopZ.toFixed(3)} F${params.travelSpeed} ; Kintsugi: Z-Hop to clear the previous section`);

    const hasLeadIn = params.leadInX !== undefined && params.leadInY !== undefined;
    const targetX = hasLeadIn ? params.leadInX! : params.resumeX;
    const targetY = hasLeadIn ? params.leadInY! : params.resumeY;

    lines.push(
      `G1 X${targetX.toFixed(3)} Y${targetY.toFixed(3)} F${params.travelSpeed} ; Kintsugi: Travel to ${
        hasLeadIn ? 'interior lead-in XY' : 'resume XY'
      } (non-extruding)`
    );
    lines.push('M83 ; Ensure relative extrusion');

    if (params.overrideTemp !== null && !isNaN(params.overrideTemp)) {
      lines.push(`M104 S${params.overrideTemp} ; Kintsugi: Override Blend Temp`);
      lines.push(`M109 S${params.overrideTemp} ; Kintsugi: Override Wait Temp`);
    } else {
      if (params.tempHotend) lines.push(params.tempHotend + ' ; Kintsugi Blend Temp');
      if (params.tempWait) lines.push(params.tempWait + ' ; Kintsugi Wait Temp');
    }

    if (params.overrideFan !== null && !isNaN(params.overrideFan)) {
      lines.push(`M106 S${params.overrideFan} ; Kintsugi: Override Blend Fan`);
    } else {
      if (params.fan) lines.push(params.fan + ' ; Kintsugi Blend Fan');
    }

    lines.push(
      `G1 Z${params.resumeZ.toFixed(3)} F${params.travelSpeed} ; Kintsugi: Descend to exact resume height (non-extruding)`
    );
    lines.push(`G1 E1.0 F${params.primeSpeed} ; Kintsugi: Un-retract prime`);
    if (hasLeadIn) {
      lines.push(
        `G1 X${params.resumeX.toFixed(3)} Y${params.resumeY.toFixed(3)} F${
          params.primeSpeed
        } ; Kintsugi: Tangential lead-in wipe onto perimeter`
      );
    }
    lines.push('; --- KINTSUGIVASE TRANSITION END ---\n');
  }

  return lines;
}
