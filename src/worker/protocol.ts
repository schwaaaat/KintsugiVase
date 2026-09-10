import { SplicerOptions, SplicerResult } from '../core/types';

export interface TransitionJunction {
  z: number;
  x: number;
  y: number;
  segmentIndex: number;
  time: number;
}

export interface ToolpathMetrics {
  maxes: { f: number; flow: number; width: number; height: number; temp: number };
  mins: { temp: number };
  maxZ: number;
  layerHeights: number[];
  segmentCount: number;
  junctions: TransitionJunction[];
}

export interface ToolpathGeometryData {
  positions: Float32Array; // 6 floats per segment (x1, z1, -y1, x2, z2, -y2)
  colorsType: Float32Array; // 6 floats per segment (r1, g1, b1, r2, g2, b2)
  speeds: Float32Array; // 1 float per segment
  flows: Float32Array; // 1 float per segment
  widths: Float32Array; // 1 float per segment
  heights: Float32Array; // 1 float per segment
  temps: Float32Array; // 1 float per segment
  zCoords: Float32Array; // 1 float per segment
  cumTimes: Float32Array; // 1 float per segment
  metrics: ToolpathMetrics;
}

export type WorkerRequest =
  | {
      type: 'SPLICE_REQUEST';
      id: string;
      baseGcode: string;
      vaseGcode: string;
      options: SplicerOptions;
    }
  | {
      type: 'PARSE_PREVIEW_REQUEST';
      id: string;
      gcode: string;
      transitions: number[];
      firstMode?: 'base' | 'vase';
    }
  | {
      type: 'FIND_VALID_TRANSITION_REQUEST';
      id: string;
      baseGcode: string;
      vaseGcode: string;
      options: SplicerOptions;
      transitionIndex: number;
      candidates: number[];
    };

export type WorkerResponse =
  | {
      type: 'PROGRESS';
      id: string;
      message: string;
      percent?: number;
    }
  | {
      type: 'SPLICE_SUCCESS';
      id: string;
      result: SplicerResult;
      geometry: ToolpathGeometryData;
    }
  | {
      type: 'PREVIEW_SUCCESS';
      id: string;
      geometry: ToolpathGeometryData;
    }
  | {
      type: 'VALID_TRANSITION_SUCCESS';
      id: string;
      z: number;
    }
  | {
      type: 'ERROR';
      id: string;
      error: string;
    };
