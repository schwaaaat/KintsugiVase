import { describe, it, expect } from 'vitest';
import { readLayerHeights, snapLayer } from '../src/ui/layers';
import { buildToolpathGeometry } from '../src/worker/geometry-builder';
import { ToolpathViewport } from '../src/viewer/viewport';
import * as THREE from 'three';

describe('Layer controls', () => {
  it('reads the entire Orca file and excludes thickness metadata', () => {
    const gcode = ';Z:0.2\n;HEIGHT:0.12\n' + '; padding\n'.repeat(4100) + '; Z_HEIGHT: 25.16\n;layer_z=0.44';
    expect(readLayerHeights(gcode)).toEqual([0.2, 0.44, 25.16]);
    expect(snapLayer(25, readLayerHeights(gcode))).toBe(25.16);
  });

  it('scrubs only the selected layer without replacing geometry or camera', () => {
    const gcode = ['M83', ';Z:0.2', 'G1 X0 Y0 Z0.2', 'G1 X1 E1', 'G1 X2 E1',
      ';Z:0.44', 'G1 Z0.44', 'G1 X3 E1', 'G1 X4 E1'].join('\n');
    const viewport = Object.create(ToolpathViewport.prototype) as any;
    const geometry = new THREE.BufferGeometry();
    const camera = new THREE.PerspectiveCamera();
    viewport.currentData = buildToolpathGeometry(gcode, [], 'base');
    viewport.currentGeometry = geometry;
    viewport.camera = camera;
    viewport.isPlaying = true;
    viewport.setFilter(0.44, 0);
    expect(geometry.drawRange.count).toBe(4);
    viewport.setFilter(0.44, 0.5);
    expect(geometry.drawRange.count).toBe(6);
    viewport.setFilter(0.44, 1);
    expect(geometry.drawRange.count).toBe(8);
    viewport.setFilter(0.2, 0);
    expect(geometry.drawRange.count).toBe(0);
    expect(viewport.currentGeometry).toBe(geometry);
    expect(viewport.camera).toBe(camera);
    expect(viewport.isPlaying).toBe(false);
  });

  it('uses declared layers for a spiral rather than each tiny Z increment', () => {
    const data = buildToolpathGeometry('M83\n;Z:0.2\nG1 X1 Z0.1 E1\nG1 X2 Z0.2 E1\n;Z:0.4\nG1 X3 Z0.3 E1\nG1 X4 Z0.4 E1', [], 'vase');
    expect(data.metrics.layerHeights).toEqual([0.2, 0.4]);
    expect(data.metrics.maxZ).toBe(0.4);
  });
});
