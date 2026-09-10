import { SplicerOptions, SplicerResult } from '../core/types';
import { ToolpathGeometryData, WorkerRequest, WorkerResponse } from './protocol';
import SlicerWorker from './slicer.worker?worker&inline';

export class SlicerWorkerClient {
  private worker: Worker | null = null;
  private reqId = 0;
  private pending = new Map<
    string,
    {
      resolve: (data: any) => void;
      reject: (err: any) => void;
      onProgress?: (msg: string, pct?: number) => void;
    }
  >();

  constructor() {
    this.init();
  }

  private init() {
    this.worker = new SlicerWorker();
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const resp = e.data;
      const handler = this.pending.get(resp.id);
      if (!handler) return;

      if (resp.type === 'PROGRESS') {
        handler.onProgress?.(resp.message, resp.percent);
      } else if (resp.type === 'SPLICE_SUCCESS') {
        this.pending.delete(resp.id);
        handler.resolve({ result: resp.result, geometry: resp.geometry });
      } else if (resp.type === 'PREVIEW_SUCCESS') {
        this.pending.delete(resp.id);
        handler.resolve(resp.geometry);
      } else if (resp.type === 'VALID_TRANSITION_SUCCESS') {
        this.pending.delete(resp.id);
        handler.resolve(resp.z);
      } else if (resp.type === 'ERROR') {
        this.pending.delete(resp.id);
        handler.reject(new Error(resp.error));
      }
    };

    this.worker.onerror = (err) => {
      console.error('Worker error:', err);
    };
  }

  splice(
    baseGcode: string,
    vaseGcode: string,
    options: SplicerOptions,
    onProgress?: (msg: string, pct?: number) => void
  ): Promise<{ result: SplicerResult; geometry: ToolpathGeometryData }> {
    if (!this.worker) this.init();
    const id = 'req_' + ++this.reqId;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      const req: WorkerRequest = {
        type: 'SPLICE_REQUEST',
        id,
        baseGcode,
        vaseGcode,
        options,
      };
      this.worker!.postMessage(req);
    });
  }

  parsePreview(
    gcode: string,
    transitions: number[],
    firstMode?: 'base' | 'vase',
    onProgress?: (msg: string, pct?: number) => void
  ): Promise<ToolpathGeometryData> {
    if (!this.worker) this.init();
    const id = 'req_' + ++this.reqId;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      const req: WorkerRequest = {
        type: 'PARSE_PREVIEW_REQUEST',
        id,
        gcode,
        transitions,
        firstMode,
      };
      this.worker!.postMessage(req);
    });
  }

  findNearestValidTransition(
    baseGcode: string,
    vaseGcode: string,
    options: SplicerOptions,
    transitionIndex: number,
    candidates: number[],
    onProgress?: (msg: string, pct?: number) => void
  ): Promise<number> {
    if (!this.worker) this.init();
    const id = 'req_' + ++this.reqId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.worker!.postMessage({
        type: 'FIND_VALID_TRANSITION_REQUEST', id, baseGcode, vaseGcode,
        options, transitionIndex, candidates
      } satisfies WorkerRequest);
    });
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}
