import { FeatureType, GCodeCommand } from './types';

export function cleanLine(raw: string): string {
  return raw.replace(/^N\d+\s*/i, '').trim();
}

export function stripComment(raw: string): string {
  const line = cleanLine(raw);
  const semicolonIdx = line.indexOf(';');
  return semicolonIdx !== -1 ? line.substring(0, semicolonIdx).trim() : line;
}

export function parseComment(raw: string): {
  text: string;
  feature?: FeatureType;
  layerZ?: number;
  layerHeight?: number;
  isTransitionMarker?: 'START' | 'END';
} {
  const text = raw.trim();
  let feature: FeatureType | undefined;
  let layerZ: number | undefined;
  let layerHeight: number | undefined;
  let isTransitionMarker: 'START' | 'END' | undefined;

  if (text.includes('KINTSUGIVASE TRANSITION START')) {
    isTransitionMarker = 'START';
  } else if (text.includes('KINTSUGIVASE TRANSITION END')) {
    isTransitionMarker = 'END';
  }

  // Feature detection
  const lower = text.toLowerCase();
  if (lower.includes('outer wall') || lower.includes('outer perimeter')) {
    feature = 'OUTER_WALL';
  } else if (lower.includes('inner wall') || lower.includes('perimeter')) {
    feature = 'INNER_WALL';
  } else if (lower.includes('sparse infill') || lower.includes('internal infill')) {
    feature = 'SPARSE_INFILL';
  } else if (lower.includes('top solid infill') || lower.includes('top surface')) {
    feature = 'TOP_SURFACE';
  } else if (lower.includes('solid infill')) {
    feature = 'SOLID_INFILL';
  } else if (lower.includes('bottom surface')) {
    feature = 'BOTTOM_SURFACE';
  } else if (lower.includes('support')) {
    feature = 'SUPPORT';
  }

  // Layer Z detection
  const zMatch = text.match(/;\s*(?:Z|layer_z)[:=]\s*([+-]?[0-9.]+)/i);
  if (zMatch) {
    layerZ = parseFloat(zMatch[1]);
  }

  // Layer height detection
  const hMatch = text.match(/\b(?:HEIGHT|layer_height)[:=]\s*([+-]?[0-9.]+)/i);
  if (hMatch) {
    layerHeight = parseFloat(hMatch[1]);
  }

  return { text, feature, layerZ, layerHeight, isTransitionMarker };
}

export function tokenizeLine(raw: string): GCodeCommand {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { type: 'other', raw };
  }

  if (trimmed.startsWith(';')) {
    const commentData = parseComment(trimmed);
    return {
      type: 'comment',
      raw,
      ...commentData,
    };
  }

  const cleaned = stripComment(raw);
  if (!cleaned) {
    return {
      type: 'comment',
      raw,
      ...parseComment(raw),
    };
  }

  const firstChar = cleaned[0].toUpperCase();

  // Motion commands: G0, G1, G2, G3
  if (firstChar === 'G') {
    const spaceIdx = cleaned.indexOf(' ');
    const codeStr = spaceIdx === -1 ? cleaned.substring(1) : cleaned.substring(1, spaceIdx);
    const codeNum = parseInt(codeStr, 10);

    if (codeNum >= 0 && codeNum <= 3) {
      const g = codeNum as 0 | 1 | 2 | 3;
      let x: number | undefined;
      let y: number | undefined;
      let z: number | undefined;
      let e: number | undefined;
      let f: number | undefined;
      let i: number | undefined;
      let j: number | undefined;
      let p: number | undefined;

      // Extract parameters
      const words = cleaned.match(/[A-Za-z][+-]?[0-9.]+/g);
      if (words) {
        for (let k = 1; k < words.length; k++) {
          const w = words[k];
          const letter = w[0].toUpperCase();
          const val = parseFloat(w.substring(1));
          if (isNaN(val)) continue;
          if (letter === 'X') x = val;
          else if (letter === 'Y') y = val;
          else if (letter === 'Z') z = val;
          else if (letter === 'E') e = val;
          else if (letter === 'F') f = val;
          else if (letter === 'I') i = val;
          else if (letter === 'J') j = val;
          else if (letter === 'P') p = val;
        }
      }

      return {
        type: 'motion',
        g,
        x,
        y,
        z,
        e,
        f,
        i,
        j,
        p,
        raw,
      };
    }

    if (codeNum === 90 || codeNum === 91 || codeNum === 92) {
      let e: number | undefined;
      const eMatch = cleaned.match(/[Ee]([+-]?[0-9.]+)/);
      if (eMatch) e = parseFloat(eMatch[1]);
      return {
        type: 'mode',
        cmd: ('G' + codeNum) as 'G90' | 'G91' | 'G92',
        e,
        raw,
      };
    }
  }

  // M commands
  if (firstChar === 'M') {
    const mMatch = cleaned.match(/^[Mm](104|109|106|107|82|83)\b/);
    if (mMatch) {
      const num = parseInt(mMatch[1], 10);
      if (num === 82 || num === 83) {
        return {
          type: 'mode',
          cmd: ('M' + num) as 'M82' | 'M83',
          raw,
        };
      }
      let s: number | undefined;
      const sMatch = cleaned.match(/[Ss]([+-]?[0-9.]+)/);
      if (sMatch) s = parseFloat(sMatch[1]);
      return {
        type: 'temp',
        m: num as 104 | 109 | 106 | 107,
        s,
        raw,
      };
    }
  }

  return { type: 'other', raw };
}
