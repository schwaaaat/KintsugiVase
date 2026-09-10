import { spliceGcode } from '../core/splicer';
import { buildToolpathGeometry } from './geometry-builder';
import { WorkerRequest, WorkerResponse } from './protocol';

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;

  try {
    if (req.type === 'SPLICE_REQUEST') {
      const { id, baseGcode, vaseGcode, options } = req;

      self.postMessage({ type: 'PROGRESS', id, message: 'Splicing G-code...' } as WorkerResponse);
      const result = spliceGcode(baseGcode, vaseGcode, options);

      self.postMessage({ type: 'PROGRESS', id, message: 'Building 3D Toolpath Geometry...' } as WorkerResponse);
      const geometry = buildToolpathGeometry(result.splicedGcode, result.previewTransitions, options.firstMode);

      const transferables = [
        geometry.positions.buffer,
        geometry.colorsType.buffer,
        geometry.speeds.buffer,
        geometry.flows.buffer,
        geometry.widths.buffer,
        geometry.heights.buffer,
        geometry.temps.buffer,
        geometry.zCoords.buffer,
        geometry.cumTimes.buffer,
      ];

      const resp: WorkerResponse = {
        type: 'SPLICE_SUCCESS',
        id,
        result,
        geometry,
      };

      self.postMessage(resp, { transfer: transferables });
    } else if (req.type === 'PARSE_PREVIEW_REQUEST') {
      const { id, gcode, transitions, firstMode } = req;

      self.postMessage({ type: 'PROGRESS', id, message: 'Parsing 3D Toolpath Geometry...' } as WorkerResponse);
      const geometry = buildToolpathGeometry(gcode, transitions, firstMode);

      const transferables = [
        geometry.positions.buffer,
        geometry.colorsType.buffer,
        geometry.speeds.buffer,
        geometry.flows.buffer,
        geometry.widths.buffer,
        geometry.heights.buffer,
        geometry.temps.buffer,
        geometry.zCoords.buffer,
        geometry.cumTimes.buffer,
      ];

      const resp: WorkerResponse = {
        type: 'PREVIEW_SUCCESS',
        id,
        geometry,
      };

      self.postMessage(resp, { transfer: transferables });
    } else if (req.type === 'FIND_VALID_TRANSITION_REQUEST') {
      const { id, baseGcode, vaseGcode, options, transitionIndex, candidates } = req;
      let lastError = 'No candidate layers were available.';
      const baseToVase = (options.firstMode ?? 'base') === 'base'
        ? transitionIndex % 2 === 0
        : transitionIndex % 2 !== 0;
      for (let i = 0; i < candidates.length; i++) {
        const z = candidates[i];
        if (i === 0 || i % 10 === 0) {
          self.postMessage({
            type: 'PROGRESS', id,
            message: `Finding nearest valid layer… (${i + 1}/${candidates.length})`,
            percent: (i / candidates.length) * 100
          } as WorkerResponse);
        }
        // Validate this junction independently so another invalid junction in a
        // multi-transition sequence cannot mask whether this candidate works.
        const sourceJunction = options.junctions?.[transitionIndex];
        const junctions = sourceJunction ? [{ ...sourceJunction, z }] : undefined;
        try {
          spliceGcode(baseGcode, vaseGcode, {
            ...options,
            transitions: [z],
            junctions,
            firstMode: baseToVase ? 'base' : 'vase'
          });
          self.postMessage({ type: 'VALID_TRANSITION_SUCCESS', id, z } as WorkerResponse);
          return;
        } catch (error: any) {
          lastError = error?.message || String(error);
        }
      }
      throw new Error(`No valid transition layer was found. Last check: ${lastError}`);
    }
  } catch (err: any) {
    const resp: WorkerResponse = {
      type: 'ERROR',
      id: req.id,
      error: err?.message || String(err),
    };
    self.postMessage(resp);
  }
};
