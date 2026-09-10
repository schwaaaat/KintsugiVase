export type FeatureType =
  | 'OUTER_WALL'
  | 'INNER_WALL'
  | 'SPARSE_INFILL'
  | 'SOLID_INFILL'
  | 'TOP_SURFACE'
  | 'BOTTOM_SURFACE'
  | 'SUPPORT'
  | 'CUSTOM'
  | 'UNKNOWN';

export type GCodeCommand =
  | {
      type: 'motion';
      g: 0 | 1 | 2 | 3;
      x?: number;
      y?: number;
      z?: number;
      e?: number;
      f?: number;
      i?: number;
      j?: number;
      p?: number;
      raw: string;
    }
  | {
      type: 'temp';
      m: 104 | 109 | 106 | 107;
      s?: number;
      raw: string;
    }
  | {
      type: 'mode';
      cmd: 'M82' | 'M83' | 'G90' | 'G91' | 'G92';
      e?: number;
      raw: string;
    }
  | {
      type: 'comment';
      text: string;
      feature?: FeatureType;
      layerZ?: number;
      layerHeight?: number;
      isTransitionMarker?: 'START' | 'END';
      raw: string;
    }
  | {
      type: 'other';
      raw: string;
    };

export interface MachineState {
  x: number;
  y: number;
  z: number;
  f: number;
  isRelativeE: boolean;
  lastE: number;
  totalExtrudedE: number;
  hotendTemp: number | null;
  waitTemp: number | null;
  fanSpeed: number | null;
  activeFeature: FeatureType;
}

export interface SlicerMeta {
  time: number;
  maxZ: number;
  filamentUsedMM: number;
  filamentType: string;
  hasZHop: boolean;
}

export interface TransitionApproach {
  lineIndex: number;
  x: number;
  y: number;
  z: number;
  distance: number;
  tempHotend: string | null;
  tempWait: string | null;
  fan: string | null;
  foundAnyLayer: boolean;
}

export interface SeamMatchResult {
  direction: 'vaseToBase' | 'baseToVase';
  nominalZ: number;
  matchedZ: number | null;
  distance: number | null;
  approach: TransitionApproach | null;
  entry?: any;
  exit?: any;
}

export interface JunctionTuning {
  planarTransitionEnabled?: boolean;
  planarSamples?: number;
  continuousConnection?: boolean;
  flowMultiplier?: number;
  useWallThickness?: boolean;
  slicedWidth?: number;
  targetWidth?: number;
  hopHeight?: number;
  travelSpeed?: number;
  primeSpeed?: number;
  taperEnabled?: boolean;
  taperDistanceMM?: number;
  taperStartRatio?: number;
  overlapEnabled?: boolean;
  overlapDistanceMM?: number;
  leadInEnabled?: boolean;
  leadInDistanceMM?: number;
  seamMatchEnabled?: boolean;
  seamMatchLayersBefore?: number;
  seamMatchLayersAfter?: number;
  advSpeedEnabled?: boolean;
  transSpeed?: number; // mm/s
  transLayersBefore?: number;
  transLayersAfter?: number;
  rampMode?: 'ramp' | 'flat';
  transTemp?: number | null;
  transFan?: number | null;
}

export interface JunctionConfig {
  z: number;
  overrides?: JunctionTuning;
  gcode?: { before?: string; replacement?: string; after?: string };
}

export interface SplicerOptions extends JunctionTuning {
  transitions: number[];
  firstMode?: 'base' | 'vase';
  junctions?: JunctionConfig[];
}

export interface SplicerResult {
  splicedGcode: string;
  estimatedSeconds: number;
  totalExtrudedE: number;
  finalLayerCount: number;
  transitions: {
    nominalZ: number;
    matchedZ: number | null;
    distance: number | null;
    direction: 'vaseToBase' | 'baseToVase';
    generatedGcode: string;
    customGcode: boolean;
    planarTransition: 'bondingLoop' | 'supportingRim' | null;
  }[];
  previewTransitions: number[];
}

export interface ToolpathSegment {
  x1: number;
  y1: number;
  z1: number;
  x2: number;
  y2: number;
  z2: number;
  f: number;
  flow: number;
  width: number;
  height: number;
  temp: number;
  type: 'base' | 'vase';
  cumTime: number;
}
