import * as THREE from 'three';
// @ts-ignore
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ToolpathGeometryData, TransitionJunction } from '../worker/protocol';

export type ColorMode = 'type' | 'speed' | 'flow' | 'width' | 'height' | 'temp';

export class ToolpathViewport {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private gridHelper: THREE.GridHelper | null = null;
  private bedX: number = 256;
  private bedY: number = 256;
  private currentMesh: THREE.LineSegments | null = null;
  private currentGeometry: THREE.BufferGeometry | null = null;
  private currentData: ToolpathGeometryData | null = null;
  private dynamicColors: Float32Array | null = null;
  private easterEggMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private easterEggLoading: boolean = false;

  private currentColorMode: ColorMode = 'type';
  private currentThresholdZ: number = Infinity;
  private currentPlaybackPct: number = 1.0;

  private animFrameId: number | null = null;
  private isPlaying: boolean = false;
  private playbackTime: number = 0;
  private playbackSpeed: number = 1.0;
  private onPlaybackUpdate?: (time: number, maxTime: number) => void;

  constructor(container: HTMLElement) {
    this.container = container;

    // 1. Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x111827); // gray-900

    // 2. Camera
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
    this.camera.position.set(150, 150, 200);

    // 3. Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    // 4. Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.target.set(0, 0, 0);

    // 5. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.position.set(100, 200, 100);
    this.scene.add(dirLight);

    // 6. Build Plate Grid
    this.setupGrid(256, 256);
    this.resetCamera();

    // 7. Resize Observer
    const resizeObserver = new ResizeObserver(() => this.onResize());
    resizeObserver.observe(container);

    this.animate = this.animate.bind(this);
    this.animate();
  }

  public setupGrid(sizeX: number, sizeY: number) {
    this.bedX = sizeX;
    this.bedY = sizeY;
    if (this.gridHelper) this.scene.remove(this.gridHelper);
    const maxDim = Math.max(sizeX, sizeY);
    this.gridHelper = new THREE.GridHelper(maxDim, Math.round(maxDim / 10), 0x4b5563, 0x374151);
    // Slicers place (0,0) at front-left. In Three.js (X -> X, Y -> Z, Z -> -Y),
    // the bed center is at X = sizeX / 2, Z = -sizeY / 2.
    this.gridHelper.position.set(sizeX / 2, 0, -sizeY / 2);
    this.scene.add(this.gridHelper);
  }

  public setBedSize(sizeX: number, sizeY: number, resetView: boolean = false) {
    this.setupGrid(sizeX, sizeY);
    if (resetView) this.resetCamera();
  }

  public toggleEasterEgg(imageUrl: string) {
    if (this.easterEggLoading) return;

    if (this.easterEggMesh) {
      this.scene.remove(this.easterEggMesh);
      this.easterEggMesh.geometry.dispose();
      this.easterEggMesh.material.map?.dispose();
      this.easterEggMesh.material.dispose();
      this.easterEggMesh = null;
      return;
    }

    this.easterEggLoading = true;
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1024;
      canvas.height = 1024;
      const context = canvas.getContext('2d');
      if (!context) {
        this.easterEggLoading = false;
        return;
      }

      context.drawImage(image, 0, 0, 1024, 1024);
      const texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.anisotropy = 16;

      const size = Math.min(this.bedX, this.bedY) * 0.8;
      const geometry = new THREE.PlaneGeometry(size, size);
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      this.easterEggMesh = new THREE.Mesh(geometry, material);
      this.easterEggMesh.rotation.x = -Math.PI / 2;
      this.easterEggMesh.position.set(this.bedX / 2, 0.5, -this.bedY / 2);
      this.scene.add(this.easterEggMesh);
      this.easterEggLoading = false;
    };
    image.onerror = () => {
      console.error('Failed to load Easter egg image');
      this.easterEggLoading = false;
    };
    image.src = imageUrl;
  }

  public setToolpath(data: ToolpathGeometryData, resetView: boolean = true) {
    this.currentData = data;
    this.currentThresholdZ = data.metrics.maxZ;
    this.currentPlaybackPct = 1.0;
    this.playbackTime = 0;
    this.stopPlayback();

    if (this.currentMesh) {
      this.scene.remove(this.currentMesh);
      this.currentGeometry?.dispose();
      (this.currentMesh.material as THREE.Material).dispose();
      this.currentMesh = null;
      this.currentGeometry = null;
    }

    if (data.metrics.segmentCount === 0) return;

    this.dynamicColors = new Float32Array(data.colorsType.length);
    this.dynamicColors.set(data.colorsType);

    this.currentGeometry = new THREE.BufferGeometry();
    this.currentGeometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    this.currentGeometry.setAttribute('color', new THREE.BufferAttribute(this.dynamicColors, 3));

    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      linewidth: 1,
    });

    this.currentMesh = new THREE.LineSegments(this.currentGeometry, material);
    this.scene.add(this.currentMesh);

    // Keep the geometry bounds current for Home/new-model framing without
    // disturbing a user's orbit, zoom, or pan during an ordinary re-splice.
    this.currentGeometry.computeBoundingBox();
    if (resetView) this.resetCamera();

    // Replacing the geometry initializes its colors from the type palette. Reapply
    // the selected metric so a splice does not visually reset speed/flow/etc.
    this.setColorMode(this.currentColorMode);
    this.updateFilter();
  }

  public getColorMode(): ColorMode {
    return this.currentColorMode;
  }

  public setColorMode(mode: ColorMode) {
    this.currentColorMode = mode;
    if (!this.currentData || !this.currentGeometry || !this.dynamicColors) return;

    const data = this.currentData;
    const count = data.metrics.segmentCount;
    const maxes = data.metrics.maxes;
    const minTemp = data.metrics.mins.temp;

    if (mode === 'type') {
      this.dynamicColors.set(data.colorsType);
    } else {
      const color = new THREE.Color();
      for (let i = 0; i < count; i++) {
        let ratio = 0;
        if (mode === 'speed') ratio = data.speeds[i] / (maxes.f || 1);
        else if (mode === 'flow') ratio = data.flows[i] / (maxes.flow || 1);
        else if (mode === 'width') ratio = data.widths[i] / (maxes.width || 1);
        else if (mode === 'height') ratio = data.heights[i] / (maxes.height || 1);
        else if (mode === 'temp') {
          const tRange = maxes.temp - minTemp || 1;
          ratio = (data.temps[i] - minTemp) / tRange;
        }

        ratio = Math.max(0, Math.min(1, ratio));
        // Blue (0.66) to Red (0.0)
        color.setHSL(0.66 - ratio * 0.66, 1.0, 0.5);

        const vIdx = i * 6;
        this.dynamicColors[vIdx] = color.r;
        this.dynamicColors[vIdx + 1] = color.g;
        this.dynamicColors[vIdx + 2] = color.b;
        this.dynamicColors[vIdx + 3] = color.r;
        this.dynamicColors[vIdx + 4] = color.g;
        this.dynamicColors[vIdx + 5] = color.b;
      }
    }

    const colorAttr = this.currentGeometry.getAttribute('color') as THREE.BufferAttribute;
    colorAttr.needsUpdate = true;
  }

  public setFilter(thresholdZ: number, playbackPct: number = 1.0) {
    this.stopPlayback();
    this.currentThresholdZ = thresholdZ;
    this.currentPlaybackPct = playbackPct;
    this.updateFilter();
  }

  public getLayerHeights(): number[] {
    return this.currentData?.metrics.layerHeights ?? [];
  }

  public getVisibleMetric(): string {
    if (!this.currentData || !this.currentGeometry || this.currentColorMode === 'type') return '--';
    const i = Math.min(this.currentData.metrics.segmentCount, this.currentGeometry.drawRange.count / 2) - 1;
    if (i < 0) return '--';
    const data = this.currentData;
    const value = this.currentColorMode === 'speed' ? `${Math.round(data.speeds[i] / 60)} mm/s`
      : this.currentColorMode === 'flow' ? `${data.flows[i].toFixed(3)} mm³/mm`
      : this.currentColorMode === 'width' ? `${data.widths[i].toFixed(2)} mm`
      : this.currentColorMode === 'height' ? `${data.heights[i].toFixed(2)} mm`
      : `${Math.round(data.temps[i])} °C`;
    return `Selected Layer: ${value}`;
  }

  private updateFilter() {
    if (!this.currentData || !this.currentGeometry) return;

    const data = this.currentData;
    const count = data.metrics.segmentCount;
    const thresholdZ = this.currentThresholdZ;
    const heights = data.metrics.layerHeights;

    let layerLowerZ = -Infinity;
    if (heights.length > 0) {
      let idx = heights.findIndex((h) => h >= thresholdZ - 0.001);
      if (idx === -1) idx = heights.length - 1;
      if (idx > 0) layerLowerZ = heights[idx - 1];
    }

    let drawCount = 0;
    for (let i = 0; i < count; i++) {
      const z = data.zCoords[i];
      if (z > thresholdZ + 0.001) break; // Segments are sorted by Z order
      drawCount = i + 1;
    }

    // Playback percentage in active band
    if (this.currentPlaybackPct < 1.0) {
      let bandStart = drawCount;
      for (let i = 0; i < drawCount; i++) {
        if (data.zCoords[i] > layerLowerZ + 0.001) {
          bandStart = i;
          break;
        }
      }
      const bandTotal = drawCount - bandStart;
      const keepInBand = Math.round(bandTotal * this.currentPlaybackPct);
      drawCount = bandStart + keepInBand;
    }

    // Zero-overhead GPU draw range
    this.currentGeometry.setDrawRange(0, drawCount * 2);
  }

  public startPlayback(speed: number = 1.0, onUpdate?: (time: number, maxTime: number) => void) {
    if (this.currentData) {
      const count = this.currentData.metrics.segmentCount;
      const totalTime = count > 0 ? this.currentData.cumTimes[count - 1] || 1 : 1;
      if (this.playbackTime >= totalTime - 0.01) {
        this.playbackTime = 0;
      }
    }
    this.isPlaying = true;
    this.playbackSpeed = speed;
    this.onPlaybackUpdate = onUpdate;
  }

  public stopPlayback() {
    this.isPlaying = false;
  }

  public setPlaybackSpeed(speed: number) {
    this.playbackSpeed = speed;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public getTotalPlaybackTime(): number {
    if (!this.currentData || this.currentData.metrics.segmentCount === 0) return 0;
    return this.currentData.cumTimes[this.currentData.metrics.segmentCount - 1] || 0;
  }

  public getPlaybackTime(): number {
    return this.playbackTime;
  }

  /** Returns the physical layer and progress within that layer at the playback head. */
  public getPlaybackLayerState(): { z: number; progress: number } | null {
    if (!this.currentData || this.currentData.metrics.segmentCount === 0) return null;
    const data = this.currentData;
    const count = data.metrics.segmentCount;
    const times = data.cumTimes;
    let low = 0;
    let high = count - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (times[mid] < this.playbackTime) low = mid + 1;
      else high = mid - 1;
    }
    const segment = Math.min(low, count - 1);
    const z = data.zCoords[segment];
    const declared = data.metrics.layerHeights;
    const foundLayer = declared.findIndex(height => height >= z - 0.001);
    const layerIndex = foundLayer === -1 ? Math.max(0, declared.length - 1) : foundLayer;
    const upper = declared[layerIndex] ?? z;
    const lower = layerIndex > 0 ? declared[layerIndex - 1] : -Infinity;
    let start = segment;
    let end = segment;
    while (start > 0 && data.zCoords[start - 1] > lower + 0.001 && data.zCoords[start - 1] <= upper + 0.001) start--;
    while (end + 1 < count && data.zCoords[end + 1] > lower + 0.001 && data.zCoords[end + 1] <= upper + 0.001) end++;
    const progress = end === start ? 1 : (segment - start) / (end - start);
    return { z, progress: Math.max(0, Math.min(1, progress)) };
  }

  public seekPlayback(pct: number) {
    if (!this.currentData || !this.currentGeometry) return;
    const count = this.currentData.metrics.segmentCount;
    if (count === 0) return;
    const totalTime = this.currentData.cumTimes[count - 1] || 1;
    this.playbackTime = Math.max(0, Math.min(totalTime, pct * totalTime));

    // Binary search for segment at playbackTime
    const times = this.currentData.cumTimes;
    let low = 0;
    let high = count - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (times[mid] < this.playbackTime) low = mid + 1;
      else high = mid - 1;
    }
    const segIdx = Math.min(low, count - 1);
    this.currentGeometry.setDrawRange(0, (segIdx + 1) * 2);
    this.onPlaybackUpdate?.(this.playbackTime, totalTime);
  }

  public focusAndPlayJunction(
    junctionIndex: number = 0,
    leadInSeconds: number = 2.5,
    playDurationSeconds: number = 6.0
  ): TransitionJunction | null {
    if (!this.currentData || !this.currentGeometry) return null;
    const junctions = this.currentData.metrics.junctions;
    if (!junctions || junctions.length === 0) return null;

    const j = junctions[Math.min(junctionIndex, junctions.length - 1)];

    // Target the exact 3D junction:
    // In Three.js: X -> X, Y -> Z, Z -> -Y
    const targetX = j.x;
    const targetY = j.z;
    const targetZ = -j.y;

    this.controls.target.set(targetX, targetY, targetZ);
    // Super close view ~15mm away so individual extrusion lines and takeoff are clear
    this.camera.position.set(targetX + 12, targetY + 6, targetZ + 15);
    this.controls.update();

    // Start localized junction playback
    const totalTime = this.getTotalPlaybackTime();
    if (totalTime > 0) {
      const startTime = Math.max(0, j.time - leadInSeconds);
      this.seekPlayback(startTime / totalTime);

      const targetEndTime = j.time + playDurationSeconds;
      const speed = Math.min(this.playbackSpeed || 5.0, 10.0);
      this.startPlayback(speed, (time) => {
        if (time >= targetEndTime) {
          this.stopPlayback();
        }
      });
    }

    return j;
  }

  public resetCamera() {
    const bx = this.bedX || 256;
    const by = this.bedY || 256;
    const maxDim = Math.max(bx, by);

    if (this.currentGeometry?.boundingBox) {
      const center = new THREE.Vector3();
      this.currentGeometry.boundingBox.getCenter(center);
      this.controls.target.copy(center);
      const size = this.currentGeometry.boundingBox.getSize(new THREE.Vector3());
      const dim = Math.max(size.x, size.y, size.z, 60);
      this.camera.position.set(center.x + dim * 1.4, center.y + dim * 1.2, center.z + dim * 1.6);
    } else {
      this.controls.target.set(bx / 2, 0, -by / 2);
      this.camera.position.set(bx / 2, maxDim * 0.8, -by / 2 + maxDim * 1.2);
    }
    this.controls.update();
  }

  private onResize() {
    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 600;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private lastTime = performance.now();
  private animate() {
    this.animFrameId = requestAnimationFrame(this.animate);

    const now = performance.now();
    const dt = (now - this.lastTime) / 1000;
    this.lastTime = now;

    if (this.isPlaying && this.currentData) {
      const count = this.currentData.metrics.segmentCount;
      const totalTime = count > 0 ? this.currentData.cumTimes[count - 1] || 1 : 1;
      this.playbackTime += dt * this.playbackSpeed;

      if (this.playbackTime >= totalTime) {
        this.playbackTime = totalTime;
        this.stopPlayback();
      }

      // Find index corresponding to playbackTime
      const times = this.currentData.cumTimes;
      let low = 0;
      let high = count - 1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (times[mid] < this.playbackTime) low = mid + 1;
        else high = mid - 1;
      }
      const segIdx = Math.min(low, count - 1);
      this.currentGeometry?.setDrawRange(0, (segIdx + 1) * 2);
      this.onPlaybackUpdate?.(this.playbackTime, totalTime);
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  public dispose() {
    if (this.animFrameId !== null) cancelAnimationFrame(this.animFrameId);
    this.renderer.dispose();
    this.currentGeometry?.dispose();
    if (this.currentMesh) {
      (this.currentMesh.material as THREE.Material).dispose();
    }
    if (this.easterEggMesh) {
      this.easterEggMesh.geometry.dispose();
      this.easterEggMesh.material.map?.dispose();
      this.easterEggMesh.material.dispose();
    }
  }
}
