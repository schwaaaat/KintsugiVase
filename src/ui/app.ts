import JSZip from 'jszip';
import { SlicerWorkerClient } from '../worker/client';
import { ColorMode, ToolpathViewport } from '../viewer/viewport';
import { JunctionConfig, SplicerOptions } from '../core/types';
import { readLayerHeights, snapLayer } from './layers';
import { JunctionPanel } from './junction-panel';
import { md5Hex } from './md5';

// Viewport height fix
function setAppVH() {
  const h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
  document.documentElement.style.setProperty('--app-vh', `${h * 0.01}px`);
}
setAppVH();
window.addEventListener('resize', setAppVH);
window.addEventListener('orientationchange', setAppVH);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', setAppVH);
}

// DOM Query Helpers
const fileBaseInput = document.getElementById('fileBase') as HTMLInputElement;
const fileVaseInput = document.getElementById('fileVase') as HTMLInputElement;
const mainLogo = document.getElementById('mainLogo') as HTMLElement;
const dropBase = document.getElementById('dropBase') as HTMLElement;
const dropVase = document.getElementById('dropVase') as HTMLElement;
const labelBase = document.getElementById('labelBase') as HTMLElement;
const labelVase = document.getElementById('labelVase') as HTMLElement;
const loadDemoBtn = document.getElementById('loadDemoBtn') as HTMLButtonElement;
const demoSetSelect = document.getElementById('demoSetSelect') as HTMLSelectElement;

const flowInput = document.getElementById('flowMultiplier') as HTMLInputElement;
const useWallThickness = document.getElementById('useWallThickness') as HTMLInputElement;
const slicedWidthInput = document.getElementById('slicedWidth') as HTMLInputElement;
const targetWidthInput = document.getElementById('targetWidth') as HTMLInputElement;
const wallThicknessControls = document.getElementById('wallThicknessControls') as HTMLElement;

const transitionsList = document.getElementById('transitionsList') as HTMLElement;
const addTransitionBtn = document.getElementById('addTransitionBtn') as HTMLElement;
const startModeBaseBtn = document.getElementById('startModeBaseBtn') as HTMLButtonElement;
const startModeVaseBtn = document.getElementById('startModeVaseBtn') as HTMLButtonElement;
const transitionModeDesc = document.getElementById('transitionModeDesc') as HTMLElement;
const zHintText = document.getElementById('zHintText') as HTMLElement;
const zHintAction = document.getElementById('zHintAction') as HTMLElement;

const useSpeedTuning = document.getElementById('useSpeedTuning') as HTMLInputElement;
const transSpeedInput = document.getElementById('transSpeed') as HTMLInputElement;
const rampModeInput = document.getElementById('rampMode') as HTMLSelectElement;
const transLayersBefore = document.getElementById('transLayersBefore') as HTMLInputElement;
const transLayersAfter = document.getElementById('transLayersAfter') as HTMLInputElement;
const transTempInput = document.getElementById('transTemp') as HTMLInputElement;
const transFanInput = document.getElementById('transFan') as HTMLInputElement;
const speedTuningControls = document.getElementById('speedTuningControls') as HTMLElement;

const hopHeightInput = document.getElementById('hopHeight') as HTMLInputElement;
const travelSpeedInput = document.getElementById('travelSpeedInput') as HTMLInputElement;
const primeSpeedInput = document.getElementById('primeSpeedInput') as HTMLInputElement;
const useFlowTaper = document.getElementById('useFlowTaper') as HTMLInputElement;
const usePlanarTransition = document.getElementById('usePlanarTransition') as HTMLInputElement;
const taperDistanceInput = document.getElementById('taperDistance') as HTMLInputElement;
const taperStartPctInput = document.getElementById('taperStartPct') as HTMLInputElement;
const useSeamMatch = document.getElementById('useSeamMatch') as HTMLInputElement;
const seamMatchLayersBeforeInput = document.getElementById('seamMatchLayersBefore') as HTMLInputElement;
const seamMatchLayersAfterInput = document.getElementById('seamMatchLayersAfter') as HTMLInputElement;

const useLapJoint = document.getElementById('useLapJoint') as HTMLInputElement;
const lapJointDistanceInput = document.getElementById('lapJointDistance') as HTMLInputElement;
const lapJointControls = document.getElementById('lapJointControls') as HTMLElement;
const useLeadIn = document.getElementById('useLeadIn') as HTMLInputElement;
const leadInDistanceInput = document.getElementById('leadInDistance') as HTMLInputElement;
const leadInControls = document.getElementById('leadInControls') as HTMLElement;

const processBtn = document.getElementById('processBtn') as HTMLButtonElement;
const downloadContainer = document.getElementById('downloadContainer') as HTMLElement;
const downloadBtn = document.getElementById('downloadBtn') as HTMLButtonElement;
const download3mfBtn = document.getElementById('download3mfBtn') as HTMLButtonElement;

const loadingOverlay = document.getElementById('loadingOverlay') as HTMLElement;
const loadingText = document.getElementById('loadingText') as HTMLElement;
const statsPanel = document.getElementById('statsPanel') as HTMLElement;
const statTime = document.getElementById('statTime') as HTMLElement;
const statWeight = document.getElementById('statWeight') as HTMLElement;
const statLayers = document.getElementById('statLayers') as HTMLElement;
const statusArea = document.getElementById('statusArea') as HTMLElement;

const canvasContainer = (document.getElementById('canvas-container') ||
  document.getElementById('canvasContainer')) as HTMLElement;
const zSlider = document.getElementById('zSlider') as HTMLInputElement;
const zSliderValue = document.getElementById('zSliderValue') as HTMLElement;
const zSliderWrap = document.querySelector('.vertical-slider-wrap') as HTMLElement;
const transitionIndicators = document.getElementById('transitionIndicators') as HTMLElement;
const setTransitionBtn = document.getElementById('setTransitionBtn') as HTMLElement;
const homeViewBtn = document.getElementById('homeViewBtn') as HTMLElement;

const layerPlaybackSlider = document.getElementById('layerPlaybackSlider') as HTMLInputElement;
const layerPlaybackValue = document.getElementById('layerPlaybackValue') as HTMLElement;
const colorModeSelect = document.getElementById('colorModeSelect') as HTMLSelectElement;
const currentMetricValueEl = document.getElementById('currentMetricValue') as HTMLElement;
const legendType = document.getElementById('legendType') as HTMLElement;
const legendGradient = document.getElementById('legendGradient') as HTMLElement;
const legendMin = document.getElementById('legendMin') as HTMLElement;
const legendMax = document.getElementById('legendMax') as HTMLElement;

const playbackToggleBtn = document.getElementById('playbackToggleBtn') as HTMLButtonElement;
const playbackPlayIcon = document.getElementById('playbackPlayIcon') as HTMLElement;
const playbackPauseIcon = document.getElementById('playbackPauseIcon') as HTMLElement;
const playbackTimeline = document.getElementById('playbackTimeline') as HTMLInputElement;
const playbackTimeLabel = document.getElementById('playbackTimeLabel') as HTMLElement;
const playbackSpeedSelect = document.getElementById('playbackSpeedSelect') as HTMLSelectElement;

const bedXInput = document.getElementById('bedX') as HTMLInputElement;
const bedYInput = document.getElementById('bedY') as HTMLInputElement;

const inspectJunctionBtn = document.getElementById('inspectJunctionBtn') as HTMLButtonElement;
const inspectJunctionBarBtn = document.getElementById('inspectJunctionBarBtn') as HTMLButtonElement;

const guideModal = document.getElementById('guideModal') as HTMLElement;
const guideBtn = document.getElementById('guideBtn') as HTMLElement;
const closeGuideBtn = document.getElementById('closeGuideBtn') as HTMLElement;
const walkthroughBtn = document.getElementById('walkthroughBtn') as HTMLButtonElement;
const startWalkthroughBtn = document.getElementById('startWalkthroughBtn') as HTMLButtonElement;
const walkthroughOverlay = document.getElementById('walkthroughOverlay') as HTMLElement;
const walkthroughHighlight = document.getElementById('walkthroughHighlight') as HTMLElement;
const walkthroughCard = document.getElementById('walkthroughCard') as HTMLElement;
const walkthroughProgress = document.getElementById('walkthroughProgress') as HTMLElement;
const walkthroughTitle = document.getElementById('walkthroughTitle') as HTMLElement;
const walkthroughText = document.getElementById('walkthroughText') as HTMLElement;
const walkthroughCloseBtn = document.getElementById('walkthroughCloseBtn') as HTMLButtonElement;
const walkthroughPrevBtn = document.getElementById('walkthroughPrevBtn') as HTMLButtonElement;
const walkthroughNextBtn = document.getElementById('walkthroughNextBtn') as HTMLButtonElement;
const disclaimerModal = document.getElementById('disclaimerModal') as HTMLElement;
const acceptDisclaimerBtn = document.getElementById('acceptDisclaimerBtn') as HTMLElement;
const resetSettingsBtn = document.getElementById('resetSettingsBtn') as HTMLButtonElement;

const toast = document.getElementById('toast') as HTMLElement;
const toastMessage = document.getElementById('toastMessage') as HTMLElement;

const SETTINGS_KEY = 'kintsugi_typescript_settings_v2';
const persistedControlIds = [
  'flowMultiplier', 'useWallThickness', 'targetWidth', 'bedX', 'bedY', 'matDensity',
  'useSpeedTuning', 'transSpeed', 'rampMode', 'transLayersBefore', 'transLayersAfter',
  'transTemp', 'transFan', 'hopHeight', 'travelSpeedInput', 'primeSpeedInput',
  'useFlowTaper', 'usePlanarTransition', 'taperDistance', 'taperStartPct',
  'useSeamMatch', 'seamMatchLayersBefore', 'seamMatchLayersAfter', 'useLapJoint',
  'lapJointDistance', 'useLeadIn', 'leadInDistance', 'colorModeSelect',
  'playbackSpeedSelect'
] as const;

interface SavedAppState {
  firstMode?: 'base' | 'vase';
  transitions?: number[];
  junctions?: JunctionConfig[];
  controls?: Record<string, string | boolean>;
}

function loadSavedState(): SavedAppState {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') as SavedAppState;
  } catch {
    return {};
  }
}

const savedState = loadSavedState();
for (const [id, value] of Object.entries(savedState.controls || {})) {
  const element = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
  if (!element) continue;
  if (element instanceof HTMLInputElement && element.type === 'checkbox') element.checked = value === true;
  else if (typeof value === 'string') element.value = value;
}

// State
let firstMode: 'base' | 'vase' = savedState.firstMode === 'vase' ? 'vase' : 'base';
let transitions: number[] = Array.isArray(savedState.transitions) && savedState.transitions.length
  ? savedState.transitions.filter(z => Number.isFinite(z))
  : [25.0];
if (!transitions.length) transitions = [25.0];
let selectedTransitionValue: number = transitions[0];
let fileBaseContent: string | null = null;
let fileVaseContent: string | null = null;
let template3mfFile: File | null = null;
let templateGcodePath: string | null = null;
let splicedGcodeText: string | null = null;
let baseLayerHeights: number[] = [];
let currentSnappedZ: number | null = null;
let maxRenderZ: number = 0;
let modeChangedSinceSplice = false;
const junctionConfigs: JunctionConfig[] = transitions.map((z, index) => {
  const saved = Array.isArray(savedState.junctions) ? savedState.junctions[index] : undefined;
  return saved && typeof saved === 'object' ? { ...saved, z } : { z };
});
const generatedJunctions = new Map<number, string>();
const junctionPanel = new JunctionPanel(transitionsList);

function saveAppState() {
  const controls: Record<string, string | boolean> = {};
  for (const id of persistedControlIds) {
    const element = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (!element) continue;
    controls[id] = element instanceof HTMLInputElement && element.type === 'checkbox'
      ? element.checked
      : element.value;
  }
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ firstMode, transitions, junctions: junctionConfigs, controls }));
    // Keep the legacy transition key current for users moving between versions.
    localStorage.setItem('kintsugi_transitions', JSON.stringify(transitions));
  } catch { /* storage can be unavailable in locked-down browsers */ }
}

function renderJunctionPanel() {
  const index = getSelectedTransitionIndex();
  const config = junctionConfigs[index] ?? (junctionConfigs[index] = { z: transitions[index] });
  config.z = transitions[index];
  junctionPanel.render(config, generatedJunctions.get(config.z) ?? '', () => {
    downloadContainer?.classList.add('hidden');
    saveAppState();
  });
}

function updateFirstModeUI() {
  if (firstMode === 'base') {
    startModeBaseBtn?.classList.remove('text-gray-400', 'hover:text-gray-200');
    startModeBaseBtn?.classList.add('bg-blue-600', 'text-white', 'shadow');
    const baseDot = startModeBaseBtn?.querySelector('span');
    if (baseDot) baseDot.className = 'w-2 h-2 rounded-full bg-white/90';

    startModeVaseBtn?.classList.remove('bg-orange-600', 'text-white', 'shadow');
    startModeVaseBtn?.classList.add('text-gray-400', 'hover:text-gray-200');
    const vaseDot = startModeVaseBtn?.querySelector('span');
    if (vaseDot) vaseDot.className = 'w-2 h-2 rounded-full bg-orange-500';

    if (transitionModeDesc) {
      transitionModeDesc.textContent =
        'Print alternates Base → Vase → Base → … at each height, sorted low to high. Click a row to select it (drives the slider marker, Set Trans., and arrow-key snapping).';
    }
  } else {
    startModeVaseBtn?.classList.remove('text-gray-400', 'hover:text-gray-200');
    startModeVaseBtn?.classList.add('bg-orange-600', 'text-white', 'shadow');
    const vaseDot = startModeVaseBtn?.querySelector('span');
    if (vaseDot) vaseDot.className = 'w-2 h-2 rounded-full bg-white/90';

    startModeBaseBtn?.classList.remove('bg-blue-600', 'text-white', 'shadow');
    startModeBaseBtn?.classList.add('text-gray-400', 'hover:text-gray-200');
    const baseDot = startModeBaseBtn?.querySelector('span');
    if (baseDot) baseDot.className = 'w-2 h-2 rounded-full bg-blue-500';

    if (transitionModeDesc) {
      transitionModeDesc.textContent =
        'Print alternates Vase → Base → Vase → … at each height, sorted low to high. Click a row to select it (drives the slider marker, Set Trans., and arrow-key snapping).';
    }
  }
}

startModeBaseBtn?.addEventListener('click', () => {
  if (firstMode !== 'base') {
    firstMode = 'base';
    modeChangedSinceSplice = true;
    updateFirstModeUI();
    renderTransitionsList();
    saveAppState();
  }
});

startModeVaseBtn?.addEventListener('click', () => {
  if (firstMode !== 'vase') {
    firstMode = 'vase';
    modeChangedSinceSplice = true;
    updateFirstModeUI();
    renderTransitionsList();
    saveAppState();
  }
});
updateFirstModeUI();

// Worker Client & 3D Viewport
const workerClient = new SlicerWorkerClient();
const viewport = new ToolpathViewport(canvasContainer);
(window as any).__viewport = viewport;
const easterEggUrl = new URL('../../images/easter-egg.svg', import.meta.url).href;
let logoClickCount = 0;
let logoClickTimer: ReturnType<typeof setTimeout> | null = null;
let logoRepairState: 'intact' | 'broken' | 'repaired' = 'intact';

mainLogo?.addEventListener('click', () => {
  logoRepairState = logoRepairState === 'broken' ? 'repaired' : 'broken';
  mainLogo.classList.toggle('logo-broken', logoRepairState === 'broken');
  mainLogo.classList.toggle('logo-repaired', logoRepairState === 'repaired');
  mainLogo.dataset.repairState = logoRepairState;

  logoClickCount++;
  if (logoClickTimer !== null) clearTimeout(logoClickTimer);

  if (logoClickCount >= 5) {
    viewport.toggleEasterEgg(easterEggUrl);
    logoClickCount = 0;
    logoClickTimer = null;
  } else {
    logoClickTimer = setTimeout(() => {
      logoClickCount = 0;
      logoClickTimer = null;
    }, 1000);
  }
});

function updateBedGrid(resetView: boolean = false) {
  const bx = parseFloat(bedXInput?.value || '256') || 256;
  const by = parseFloat(bedYInput?.value || '256') || 256;
  viewport.setBedSize(bx, by, resetView);
}
bedXInput?.addEventListener('input', () => updateBedGrid());
bedYInput?.addEventListener('input', () => updateBedGrid());
updateBedGrid(true);

function syncVerticalZSlider() {
  if (zSliderWrap && zSlider) {
    zSlider.style.width = `${zSliderWrap.clientHeight}px`;
  }
}
window.addEventListener('resize', syncVerticalZSlider);
setTimeout(syncVerticalZSlider, 100);

// Disclaimer
if (!localStorage.getItem('kintsugi_disclaimer_accepted')) {
  disclaimerModal?.classList.remove('hidden');
}
acceptDisclaimerBtn?.addEventListener('click', () => {
  localStorage.setItem('kintsugi_disclaimer_accepted', 'true');
  disclaimerModal?.classList.add('hidden');
});

resetSettingsBtn?.addEventListener('click', () => {
  if (!window.confirm('Reset all settings and transition configuration to their defaults?')) return;
  localStorage.removeItem(SETTINGS_KEY);
  localStorage.removeItem('kintsugi_transitions');
  window.location.reload();
});

guideBtn?.addEventListener('click', () => guideModal?.classList.remove('hidden'));
closeGuideBtn?.addEventListener('click', () => guideModal?.classList.add('hidden'));

const walkthroughSteps = [
  { selector: '#loadDemoBtn', title: 'Load a matched file pair', text: 'Drop your own Standard base and Vase slices into the two boxes. For a quick trial, choose Demo pair 1 or 2 and load both matched files together.' },
  { selector: '#startModeBaseBtn', title: 'Choose the print order', text: 'Choose whether the bottom section starts in Base or Vase mode. Every added transition alternates to the other mode.' },
  { selector: '#transitionsList', title: 'Choose transition layers', text: 'Add one or more heights. Typed values snap to real layers, and Up/Down selects adjacent layers. Changing order triggers automatic nearest-layer correction if a saved height no longer works.' },
  { selector: 'label[for="usePlanarTransition"]', title: 'Build a level physical bond', text: 'Level Bonding / Support Loop creates the flat perimeter needed at each direction change. The controls below it tune matching, taper, overlap, and lead-in behavior.' },
  { selector: '#junctionPanel', title: 'Tune one junction', text: 'Select a transition row and open this panel to override shared settings or inspect and customize the G-code for only that junction.' },
  { selector: '#colorModeSelect', title: 'Inspect toolpath properties', text: 'Color the preview by source type, speed, flow, width, layer height, or temperature. Your selection stays active after resplicing.' },
  { selector: '#layerPlaybackSlider', title: 'Scrub the selected layer', text: 'The vertical control chooses a Z layer. LayerBuild reveals the moves within that layer, while the playback controls animate the whole toolpath.' },
  { selector: '#inspectJunctionBtn', title: 'Inspect the handoff closely', text: 'Select a transition and use Inspect Junction to zoom to its seam and animate the generated handoff.' },
  { selector: '#processBtn', title: 'Splice, review, and export', text: 'Generate the preview, inspect every junction, then use the header buttons to save plain G-code or a metadata-preserving .gcode.3mf archive.' }
] as const;
let walkthroughIndex = -1;

function currentWalkthroughTarget(): HTMLElement | null {
  return walkthroughIndex >= 0
    ? document.querySelector(walkthroughSteps[walkthroughIndex].selector) as HTMLElement | null
    : null;
}

function positionWalkthrough() {
  const target = currentWalkthroughTarget();
  if (!target) return;
  const rect = target.getBoundingClientRect();
  const pad = 6;
  walkthroughHighlight.style.left = `${Math.max(4, rect.left - pad)}px`;
  walkthroughHighlight.style.top = `${Math.max(4, rect.top - pad)}px`;
  walkthroughHighlight.style.width = `${Math.min(window.innerWidth - 8, rect.width + pad * 2)}px`;
  walkthroughHighlight.style.height = `${Math.min(window.innerHeight - 8, rect.height + pad * 2)}px`;
  const putCardOnTop = rect.bottom > window.innerHeight * 0.55;
  walkthroughCard.style.top = putCardOnTop ? '1rem' : 'auto';
  walkthroughCard.style.bottom = putCardOnTop ? 'auto' : '1rem';
}

function showWalkthroughStep(index: number) {
  walkthroughIndex = Math.max(0, Math.min(walkthroughSteps.length - 1, index));
  const step = walkthroughSteps[walkthroughIndex];
  const target = currentWalkthroughTarget();
  if (!target) { endWalkthrough(); return; }
  const details = target instanceof HTMLDetailsElement ? target : target.closest('details');
  if (details) details.open = true;
  target.scrollIntoView({ block: 'center', inline: 'nearest' });
  walkthroughProgress.textContent = `Step ${walkthroughIndex + 1} of ${walkthroughSteps.length}`;
  walkthroughTitle.textContent = step.title;
  walkthroughText.textContent = step.text;
  walkthroughPrevBtn.disabled = walkthroughIndex === 0;
  walkthroughNextBtn.textContent = walkthroughIndex === walkthroughSteps.length - 1 ? 'Finish' : 'Next';
  requestAnimationFrame(() => requestAnimationFrame(positionWalkthrough));
  walkthroughNextBtn.focus();
}

function startWalkthrough() {
  guideModal?.classList.add('hidden');
  walkthroughOverlay?.classList.remove('hidden');
  showWalkthroughStep(0);
}

function endWalkthrough() {
  walkthroughIndex = -1;
  walkthroughOverlay?.classList.add('hidden');
  walkthroughBtn?.focus();
}

walkthroughBtn?.addEventListener('click', startWalkthrough);
startWalkthroughBtn?.addEventListener('click', startWalkthrough);
walkthroughCloseBtn?.addEventListener('click', endWalkthrough);
walkthroughPrevBtn?.addEventListener('click', () => showWalkthroughStep(walkthroughIndex - 1));
walkthroughNextBtn?.addEventListener('click', () => {
  if (walkthroughIndex >= walkthroughSteps.length - 1) endWalkthrough();
  else showWalkthroughStep(walkthroughIndex + 1);
});
window.addEventListener('resize', positionWalkthrough);
document.addEventListener('scroll', positionWalkthrough, true);
document.addEventListener('keydown', event => {
  if (walkthroughIndex < 0) return;
  if (event.key === 'Escape') endWalkthrough();
  else if (event.key === 'ArrowRight') walkthroughNextBtn.click();
  else if (event.key === 'ArrowLeft' && walkthroughIndex > 0) walkthroughPrevBtn.click();
  else return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

// Toast
let toastTimer: any = null;
function showToast(msg: string, type: 'info' | 'success' | 'error' = 'info') {
  if (!toast) return;
  toastMessage.textContent = msg;
  toast.classList.remove('translate-y-20', 'opacity-0', 'pointer-events-none');
  if (type === 'error') toast.style.borderLeftColor = '#ef4444';
  else if (type === 'success') toast.style.borderLeftColor = '#10b981';
  else toast.style.borderLeftColor = '#f59e0b';

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add('translate-y-20', 'opacity-0', 'pointer-events-none');
  }, 3500);
}

function updateStatus(msg: string, isError = false) {
  if (!statusArea) return;
  statusArea.classList.remove('hidden');
  statusArea.textContent = msg;
  statusArea.className = isError
    ? 'mt-1 md:mt-2 p-2 md:p-3 rounded bg-gray-900 border border-red-700 text-[10px] md:text-xs font-mono text-red-400 whitespace-pre-wrap break-words flex-shrink-0'
    : 'mt-1 md:mt-2 p-2 md:p-3 rounded bg-gray-900 border border-gray-700 text-[10px] md:text-xs font-mono text-amber-400 whitespace-pre-wrap break-words flex-shrink-0';
}

function getSelectedTransitionIndex(): number {
  let idx = transitions.indexOf(selectedTransitionValue);
  if (idx === -1) idx = 0;
  return idx;
}

function updateSliderIndicator() {
  if (!transitionIndicators) return;
  transitionIndicators.innerHTML = '';
  if (maxRenderZ <= 0) return;
  const selIdx = getSelectedTransitionIndex();

  transitions.forEach((tz, idx) => {
    if (isNaN(tz) || tz < 0 || tz > maxRenderZ) return;
    const percent = tz / maxRenderZ;
    const marker = document.createElement('div');
    const isSelected = idx === selIdx;
    marker.className = `absolute rounded pointer-events-none ${
      isSelected
        ? 'w-4 h-1 md:w-5 md:h-1 bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)] z-10'
        : 'w-3 h-0.5 md:w-4 md:h-0.5 bg-amber-400/50 z-0'
    }`;
    marker.style.top = `calc(8px + ${1 - percent} * (100% - 16px))`;
    marker.style.left = '50%';
    marker.style.transform = 'translate(-50%, -50%)';
    transitionIndicators.appendChild(marker);
  });
}

function updateZHint() {
  if (!baseLayerHeights.length) return;
  const currentZ = selectedTransitionValue;
  if (currentZ === null || isNaN(currentZ)) return;

  const nearestZ = baseLayerHeights.reduce((prev, curr) =>
    Math.abs(curr - currentZ) < Math.abs(prev - currentZ) ? curr : prev
  );

  if (Math.abs(currentZ - nearestZ) < 0.001) {
    zHintText.textContent = '✓ Exact layer match.';
    zHintText.className = 'text-green-500 font-medium';
    zHintAction.classList.add('hidden');
  } else {
    zHintText.textContent = 'Nearest actual layer:';
    zHintText.className = 'text-gray-400';
    zHintAction.textContent = `${nearestZ.toFixed(2)}mm (Snap)`;
    zHintAction.classList.remove('hidden');
    currentSnappedZ = nearestZ;
  }
}

zHintAction?.addEventListener('click', () => {
  if (currentSnappedZ !== null) {
    updateTransitionValue(getSelectedTransitionIndex(), currentSnappedZ);
    renderTransitionsList();
  }
});

function selectTransition(idx: number) {
  selectedTransitionValue = transitions[idx];
  renderTransitionsList();
  updateZHint();
  updateSliderIndicator();
}

function updateTransitionValue(idx: number, val: number) {
  const selected = idx === getSelectedTransitionIndex();
  const snapped = snapLayer(val, baseLayerHeights);
  if (transitions.some((z, i) => i !== idx && Math.abs(z - snapped) < 0.001)) {
    showToast('A transition already exists at this layer.', 'error');
    return;
  }
  transitions[idx] = snapped;
  junctionConfigs[idx].z = snapped;
  if (selected) selectedTransitionValue = transitions[idx];
  updateZHint();
  updateSliderIndicator();
  renderJunctionPanel();
  saveAppState();
}

function renderTransitionsList() {
  if (!transitionsList) return;
  transitionsList.innerHTML = '';
  const selIdx = getSelectedTransitionIndex();

  transitions.forEach((z, idx) => {
    const row = document.createElement('div');
    row.className = `flex items-center gap-1.5 rounded px-1.5 py-1 cursor-pointer border ${
      idx === selIdx ? 'bg-gray-700 border-amber-500' : 'bg-gray-800 border-gray-700 hover:border-gray-600'
    }`;

    const isBaseEnding = firstMode === 'base' ? idx % 2 === 0 : idx % 2 !== 0;
    const swatch = document.createElement('span');
    swatch.className = `w-1.5 h-4 rounded-sm flex-shrink-0 ${isBaseEnding ? 'bg-blue-500' : 'bg-orange-500'}`;
    swatch.title = isBaseEnding ? 'Ends a Base section' : 'Ends a Vase section';
    row.appendChild(swatch);

    const label = document.createElement('span');
    label.className = 'text-[9px] text-gray-500 w-3 flex-shrink-0 text-center';
    label.textContent = String(idx + 1);
    row.appendChild(label);

    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.01';
    input.value = String(z);
    input.className =
      'flex-1 min-w-0 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-amber-400 transition-colors';
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('focus', () => {
      selectedTransitionValue = transitions[idx];
      Array.from(transitionsList.children).forEach((child, i) => {
        child.classList.toggle('border-amber-500', i === idx);
        child.classList.toggle('border-gray-700', i !== idx);
      });
      updateZHint();
      updateSliderIndicator();
      renderJunctionPanel();
    });
    input.addEventListener('change', () => {
      const v = parseFloat(input.value);
      if (!isNaN(v)) updateTransitionValue(idx, v);
      input.value = String(transitions[idx]);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        input.dispatchEvent(new Event('change'));
        return;
      }
      if (!baseLayerHeights.length) return;
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const currentZ = parseFloat(input.value) || 0;
      let nextZ = currentZ;
      if (e.key === 'ArrowUp') {
        const higher = baseLayerHeights.filter((hz) => hz > currentZ + 0.001);
        if (higher.length > 0) nextZ = higher[0];
      } else {
        const lower = baseLayerHeights.filter((hz) => hz < currentZ - 0.001);
        if (lower.length > 0) nextZ = lower[lower.length - 1];
      }
      nextZ = parseFloat(nextZ.toFixed(3));
      input.value = String(nextZ);
      updateTransitionValue(idx, nextZ);
    });
    row.appendChild(input);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove this transition';
    removeBtn.className =
      'flex-shrink-0 w-5 h-5 leading-none text-gray-500 hover:text-red-400 hover:bg-red-900/30 rounded font-bold text-sm';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (transitions.length <= 1) {
        showToast('At least one transition height is required.', 'error');
        return;
      }
      transitions.splice(idx, 1);
      junctionConfigs.splice(idx, 1);
      if (selectedTransitionValue === z) selectedTransitionValue = transitions[0];
      renderTransitionsList();
      updateZHint();
      updateSliderIndicator();
      saveAppState();
    });
    row.appendChild(removeBtn);

    row.addEventListener('click', () => selectTransition(idx));
    transitionsList.appendChild(row);
  });
  renderJunctionPanel();
}

addTransitionBtn?.addEventListener('click', () => {
  const base = transitions.length ? Math.max(...transitions) : maxRenderZ > 0 ? parseFloat(zSlider.value) : 25.0;
  let newZ = base + 5.0;
  if (maxRenderZ > 0) newZ = Math.min(newZ, maxRenderZ);
  newZ = snapLayer(newZ, baseLayerHeights);
  if (transitions.includes(newZ)) { showToast('Choose another layer for the new transition.', 'info'); return; }
  transitions.push(newZ);
  junctionConfigs.push({ z: newZ });
  selectedTransitionValue = transitions[transitions.length - 1];
  renderTransitionsList();
  updateSliderIndicator();
  saveAppState();
});

renderTransitionsList();

setTransitionBtn?.addEventListener('click', () => {
  const val = parseFloat(zSlider.value);
  if (!isNaN(val)) {
    updateTransitionValue(getSelectedTransitionIndex(), val);
    renderTransitionsList();
  }
});

// File Handlers
async function extractFileText(file: File): Promise<string> {
  if (file.name.toLowerCase().endsWith('.3mf')) {
    const zip = new JSZip();
    const contents = await zip.loadAsync(file);
    const gcodePath = Object.keys(contents.files).find((n) => n.toLowerCase().endsWith('.gcode'));
    if (!gcodePath) throw new Error('No .gcode file found inside the .3mf archive.');
    return contents.files[gcodePath].async('string');
  }
  return file.text();
}

/** Prefer the final, feature-specific wall-width setting emitted by Orca/Bambu/Prusa. */
export function detectVaseWallWidth(text: string): number | null {
  const specificKeys = [
    'outer_wall_line_width',
    'outer wall line width',
    'external_perimeter_extrusion_width',
    'perimeter_extrusion_width'
  ];
  const genericKeys = ['line_width', 'extrusion_width'];
  const findLast = (keys: string[]) => {
    let bestIndex = -1;
    let bestValue: number | null = null;
    for (const key of keys) {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`^\\s*;\\s*${escaped}\\s*[:=]\\s*([0-9]*\\.?[0-9]+)`, 'gim');
      for (const match of text.matchAll(pattern)) {
        if ((match.index ?? -1) > bestIndex) {
          bestIndex = match.index ?? -1;
          bestValue = Number(match[1]);
        }
      }
    }
    return bestValue;
  };
  return findLast(specificKeys) ?? findLast(genericKeys);
}

function setupDropzone(
  dropEl: HTMLElement,
  inputEl: HTMLInputElement,
  labelEl: HTMLElement,
  onLoaded: (text: string, file: File) => void | Promise<void>
) {
  dropEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropEl.classList.add('drag-over');
  });
  dropEl.addEventListener('dragleave', () => {
    dropEl.classList.remove('drag-over');
  });
  dropEl.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropEl.classList.remove('drag-over');
    if (e.dataTransfer?.files.length) {
      inputEl.files = e.dataTransfer.files;
      handleFile(e.dataTransfer.files[0]);
    }
  });

  inputEl.addEventListener('change', () => {
    if (inputEl.files?.length) {
      handleFile(inputEl.files[0]);
    }
  });

  async function handleFile(file: File) {
    labelEl.textContent = file.name;
    try {
      showToast(`Loading ${file.name}...`, 'info');
      const text = await extractFileText(file);
      await onLoaded(text, file);
      showToast(`Loaded ${file.name}`, 'success');
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  }

  return handleFile;
}

const loadBaseFile = setupDropzone(dropBase, fileBaseInput, labelBase, async (text, file) => {
  fileBaseContent = text;
  if (file.name.toLowerCase().endsWith('.3mf')) template3mfFile = file;

  // Scan layers for snapping
  baseLayerHeights = readLayerHeights(text);
  if (baseLayerHeights.length > 0) {
    const selected = getSelectedTransitionIndex();
    transitions = transitions.map(z => snapLayer(z, baseLayerHeights));
    transitions.forEach((z, i) => { junctionConfigs[i].z = z; });
    selectedTransitionValue = transitions[selected];
    renderTransitionsList();
    updateZHint();
  }

  // Preview Base
  try {
    const geom = await workerClient.parsePreview(text, [99999], 'base');
    viewport.setToolpath(geom);
    maxRenderZ = geom.metrics.maxZ;
    zSlider.max = String(maxRenderZ);
    zSlider.value = String(maxRenderZ);
    zSliderValue.textContent = `${maxRenderZ.toFixed(2)}mm`;
    syncVerticalZSlider();
    updateSliderIndicator();
  } catch (e) {
    console.error('Base preview parse error:', e);
  }
});

const loadVaseFile = setupDropzone(dropVase, fileVaseInput, labelVase, (text, file) => {
  fileVaseContent = text;
  if (file.name.toLowerCase().endsWith('.3mf') && !template3mfFile) template3mfFile = file;

  const detectedWidth = detectVaseWallWidth(text);
  slicedWidthInput.value = (detectedWidth ?? 0.42).toFixed(2);
  showToast(
    detectedWidth === null
      ? 'Could not detect vase wall width; using 0.42mm.'
      : `Detected ${detectedWidth.toFixed(2)}mm vase wall width.`,
    detectedWidth === null ? 'info' : 'success'
  );
});

const demoPairs = {
  '1': {
    name: 'Demo pair 1',
    base: 'demo/Standard-base.gcode.3mf',
    vase: 'demo/Vase.gcode.3mf'
  },
  '2': {
    name: 'Demo pair 2',
    base: 'demo/Standard-base-2.gcode.3mf',
    vase: 'demo/Vase-2.gcode.3mf'
  }
} as const;

loadDemoBtn?.addEventListener('click', async () => {
  const pairKey = demoSetSelect.value in demoPairs ? demoSetSelect.value as keyof typeof demoPairs : '1';
  const pair = demoPairs[pairKey];
  loadDemoBtn.disabled = true;
  demoSetSelect.disabled = true;
  const originalLabel = loadDemoBtn.textContent;
  loadDemoBtn.textContent = 'Loading…';
  try {
    const [baseResponse, vaseResponse] = await Promise.all([
      fetch(new URL(pair.base, document.baseURI)),
      fetch(new URL(pair.vase, document.baseURI))
    ]);
    if (!baseResponse.ok || !vaseResponse.ok) {
      throw new Error('The built-in demo files could not be downloaded.');
    }
    const [baseBuffer, vaseBuffer] = await Promise.all([
      baseResponse.arrayBuffer(),
      vaseResponse.arrayBuffer()
    ]);
    await loadBaseFile(new File([baseBuffer], 'Standard base.gcode.3mf', { type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' }));
    await loadVaseFile(new File([vaseBuffer], 'Vase.gcode.3mf', { type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' }));
    labelBase.textContent = 'Standard base';
    labelVase.textContent = 'Vase';
    loadDemoBtn.dataset.loadedPair = pairKey;
    showToast(`${pair.name} loaded: Standard base + Vase.`, 'success');
  } catch (err: any) {
    showToast(err?.message || 'Could not load the built-in demo files.', 'error');
  } finally {
    loadDemoBtn.disabled = false;
    demoSetSelect.disabled = false;
    loadDemoBtn.textContent = originalLabel;
  }
});

// UI Controls
const syncWallThickness = () => {
  if (useWallThickness.checked) wallThicknessControls.classList.remove('opacity-50', 'pointer-events-none');
  else wallThicknessControls.classList.add('opacity-50', 'pointer-events-none');
};
useWallThickness?.addEventListener('change', syncWallThickness);
syncWallThickness();

const syncSpeedTuning = () => {
  if (useSpeedTuning.checked) speedTuningControls.classList.remove('opacity-50', 'pointer-events-none');
  else speedTuningControls.classList.add('opacity-50', 'pointer-events-none');
};
useSpeedTuning?.addEventListener('change', syncSpeedTuning);
syncSpeedTuning();

const syncLapJoint = () => {
  if (useLapJoint.checked) lapJointControls?.classList.remove('opacity-50', 'pointer-events-none');
  else lapJointControls?.classList.add('opacity-50', 'pointer-events-none');
};
useLapJoint?.addEventListener('change', syncLapJoint);
syncLapJoint();

const syncLeadIn = () => {
  if (useLeadIn.checked) leadInControls?.classList.remove('opacity-50', 'pointer-events-none');
  else leadInControls?.classList.add('opacity-50', 'pointer-events-none');
};
useLeadIn?.addEventListener('change', syncLeadIn);
syncLeadIn();

for (const [toggle, id] of [[useFlowTaper, 'flowTaperControls'], [useSeamMatch, 'seamMatchControls']] as const) {
  const sync = () => {
    document.getElementById(id)?.classList.toggle('opacity-50', !toggle.checked);
    document.getElementById(id)?.classList.toggle('pointer-events-none', !toggle.checked);
  };
  toggle.addEventListener('change', sync);
  sync();
}

for (const id of persistedControlIds) {
  document.getElementById(id)?.addEventListener('change', saveAppState);
}

function updateMetric() {
  if (currentMetricValueEl) currentMetricValueEl.textContent = viewport.getVisibleMetric();
}

zSlider?.addEventListener('input', () => {
  if (isPlaying) {
    viewport.stopPlayback();
    isPlaying = false;
    playbackPlayIcon?.classList.remove('hidden');
    playbackPauseIcon?.classList.add('hidden');
  }
  const z = snapLayer(parseFloat(zSlider.value), viewport.getLayerHeights());
  zSlider.value = String(z);
  zSliderValue.textContent = `${z.toFixed(2)}mm`;
  layerPlaybackSlider.value = '100';
  layerPlaybackValue.textContent = 'All moves';
  viewport.setFilter(z, 1);
  updateMetric();
});

function stepZLayer(direction: number) {
  const heights = viewport.getLayerHeights();
  if (!heights.length) return;
  const index = heights.indexOf(snapLayer(Number(zSlider.value), heights));
  zSlider.value = String(heights[Math.max(0, Math.min(heights.length - 1, index + direction))]);
  zSlider.dispatchEvent(new Event('input'));
}

function stepLayerPlayback(direction: number, amount = 5) {
  const value = Math.max(0, Math.min(100, Number(layerPlaybackSlider.value) + direction * amount));
  layerPlaybackSlider.value = String(value);
  layerPlaybackSlider.dispatchEvent(new Event('input'));
}

zSliderWrap?.addEventListener('wheel', event => {
  event.preventDefault();
  stepZLayer(event.deltaY < 0 ? 1 : -1);
}, { passive: false });

function isTypingTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName?.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable) return true;
  return tag === 'INPUT' && (element as HTMLInputElement).type !== 'range';
}

document.addEventListener('keydown', event => {
  if (isTypingTarget(event.target) || !maxRenderZ) return;
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault();
    stepZLayer(event.key === 'ArrowUp' ? 1 : -1);
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    stepLayerPlayback(event.key === 'ArrowRight' ? 1 : -1);
  }
});

layerPlaybackSlider?.addEventListener('input', () => {
  if (isPlaying) {
    viewport.stopPlayback();
    isPlaying = false;
    playbackPlayIcon?.classList.remove('hidden');
    playbackPauseIcon?.classList.add('hidden');
  }
  const pct = parseFloat(layerPlaybackSlider.value) / 100;
  layerPlaybackValue.textContent = pct === 1 ? 'All moves' : `${Math.round(pct * 100)}%`;
  viewport.setFilter(parseFloat(zSlider.value), pct);
  updateMetric();
});

colorModeSelect?.addEventListener('change', () => {
  const mode = colorModeSelect.value as ColorMode;
  viewport.setColorMode(mode);

  updateMetric();

  if (mode === 'type') {
    legendType?.classList.remove('hidden');
    legendGradient?.classList.add('hidden');
  } else {
    legendType?.classList.add('hidden');
    legendGradient?.classList.remove('hidden');
    if (mode === 'speed') {
      legendMin.textContent = 'Slow';
      legendMax.textContent = 'Fast';
    } else if (mode === 'flow') {
      legendMin.textContent = 'Low Flow';
      legendMax.textContent = 'High Flow';
    } else if (mode === 'width') {
      legendMin.textContent = 'Thin';
      legendMax.textContent = 'Thick';
    } else if (mode === 'height') {
      legendMin.textContent = '0.0mm';
      legendMax.textContent = 'Max';
    } else if (mode === 'temp') {
      legendMin.textContent = 'Cool';
      legendMax.textContent = 'Hot';
    }
  }
});

homeViewBtn?.addEventListener('click', () => viewport.resetCamera());

// Real-Time Playback
let isPlaying = false;
function updatePlaybackUi(time: number, maxTime: number) {
  const timeline = maxTime > 0 ? Math.min(1000, Math.round((time / maxTime) * 1000)) : 0;
  playbackTimeline.value = String(timeline);
  const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  playbackTimeLabel.textContent = `${formatTime(time)} / ${formatTime(maxTime)}`;

  const layer = viewport.getPlaybackLayerState();
  if (layer) {
    zSlider.value = String(layer.z);
    zSliderValue.textContent = `${layer.z.toFixed(2)}mm`;
    const percent = Math.round(layer.progress * 100);
    layerPlaybackSlider.value = String(percent);
    layerPlaybackValue.textContent = percent >= 100 ? 'All moves' : `${percent}%`;
    updateMetric();
  }
}

playbackToggleBtn?.addEventListener('click', () => {
  if (isPlaying) {
    viewport.stopPlayback();
    isPlaying = false;
    playbackPlayIcon?.classList.remove('hidden');
    playbackPauseIcon?.classList.add('hidden');
  } else {
    const speed = parseFloat(playbackSpeedSelect?.value || '10');
    viewport.startPlayback(speed, (time, maxTime) => {
      updatePlaybackUi(time, maxTime);
      if (time >= maxTime - 0.01) {
        isPlaying = false;
        playbackPlayIcon?.classList.remove('hidden');
        playbackPauseIcon?.classList.add('hidden');
      }
    });
    isPlaying = true;
    playbackPlayIcon?.classList.add('hidden');
    playbackPauseIcon?.classList.remove('hidden');
  }
});

playbackTimeline?.addEventListener('input', () => {
  if (isPlaying) {
    viewport.stopPlayback();
    isPlaying = false;
    playbackPlayIcon?.classList.remove('hidden');
    playbackPauseIcon?.classList.add('hidden');
  }
  const frac = parseFloat(playbackTimeline.value) / 1000;
  viewport.seekPlayback(frac);
  const total = viewport.getTotalPlaybackTime();
  updatePlaybackUi(frac * total, total);
});

playbackSpeedSelect?.addEventListener('change', () => {
  viewport.setPlaybackSpeed(parseFloat(playbackSpeedSelect.value));
});

function handleInspectJunction() {
  if (!splicedGcodeText) {
    showToast('Please splice G-code first.', 'info');
    return;
  }
  const selIdx = getSelectedTransitionIndex();
  const j = viewport.focusAndPlayJunction(selIdx, 2.5, 6.0);
  if (j) {
    isPlaying = true;
    playbackPlayIcon?.classList.add('hidden');
    playbackPauseIcon?.classList.remove('hidden');
    showToast(`Zoomed to Transition Junction at Z=${j.z.toFixed(2)}mm`, 'info');
  } else {
    showToast('No transition junction found.', 'error');
  }
}

inspectJunctionBtn?.addEventListener('click', handleInspectJunction);
inspectJunctionBarBtn?.addEventListener('click', handleInspectJunction);

// Splicing Process
function numericValue(input: HTMLInputElement, fallback: number): number {
  const value = input?.value.trim();
  return value && Number.isFinite(Number(value)) ? Number(value) : fallback;
}

processBtn?.addEventListener('click', async () => {
  if (!fileBaseContent || !fileVaseContent) {
    showToast('Please upload both Base and Vase files.', 'error');
    updateStatus('Error: Select both Base and Vase files first.', true);
    return;
  }

  if (transitions.length === 0) {
    showToast('Add at least one transition height.', 'error');
    return;
  }

  loadingOverlay?.classList.remove('hidden');
  downloadContainer?.classList.add('hidden');
  statsPanel?.classList.add('hidden');
  loadingText.textContent = 'Splicing G-Code in Web Worker...';

  const options: SplicerOptions = {
    transitions: [...transitions],
    junctions: junctionConfigs,
    firstMode,
    planarTransitionEnabled: usePlanarTransition.checked,
    flowMultiplier: parseFloat(flowInput.value) || 1.0,
    useWallThickness: useWallThickness.checked,
    slicedWidth: parseFloat(slicedWidthInput.value) || 0.42,
    targetWidth: parseFloat(targetWidthInput.value) || 0.6,
    hopHeight: numericValue(hopHeightInput, 0.4),
    travelSpeed: parseFloat(travelSpeedInput.value) || 3000,
    primeSpeed: parseFloat(primeSpeedInput.value) || 1800,
    taperEnabled: useFlowTaper.checked,
    taperDistanceMM: parseFloat(taperDistanceInput.value) || 0,
    taperStartRatio: numericValue(taperStartPctInput, 25) / 100,
    overlapEnabled: useLapJoint ? useLapJoint.checked : true,
    overlapDistanceMM: numericValue(lapJointDistanceInput, 8),
    leadInEnabled: useLeadIn ? useLeadIn.checked : true,
    leadInDistanceMM: numericValue(leadInDistanceInput, 1.5),
    seamMatchEnabled: useSeamMatch.checked,
    seamMatchLayersBefore: numericValue(seamMatchLayersBeforeInput, 1),
    seamMatchLayersAfter: numericValue(seamMatchLayersAfterInput, 1),
    advSpeedEnabled: useSpeedTuning.checked,
    transSpeed: parseFloat(transSpeedInput.value) || 20,
    rampMode: rampModeInput.value === 'ramp' ? 'ramp' : 'flat',
    transLayersBefore: parseInt(transLayersBefore.value) || 0,
    transLayersAfter: parseInt(transLayersAfter.value) || 0,
    transTemp: transTempInput.value ? parseInt(transTempInput.value) : null,
    transFan: transFanInput.value ? parseInt(transFanInput.value) : null,
  };

  try {
    let autoAdjustments: Array<{ from: number; to: number }> = [];
    let spliceOutput: Awaited<ReturnType<SlicerWorkerClient['splice']>>;
    try {
      spliceOutput = await workerClient.splice(fileBaseContent, fileVaseContent, options, (msg) => {
        loadingText.textContent = msg;
      });
    } catch (initialError) {
      if (!modeChangedSinceSplice || baseLayerHeights.length === 0) throw initialError;
      const selectedIndex = getSelectedTransitionIndex();
      const correctedTransitions = [...transitions];
      for (let index = 0; index < transitions.length; index++) {
        const originalZ = transitions[index];
        const lower = index > 0 ? correctedTransitions[index - 1] + 0.001 : 0;
        const upper = index + 1 < transitions.length ? transitions[index + 1] - 0.001 : Infinity;
        const candidates = baseLayerHeights
          .filter(z => z > lower && z < upper)
          .sort((a, b) => Math.abs(a - originalZ) - Math.abs(b - originalZ) || a - b);
        const correctedZ = await workerClient.findNearestValidTransition(
          fileBaseContent, fileVaseContent, options, index, candidates,
          msg => { loadingText.textContent = `Transition ${index + 1}: ${msg}`; }
        );
        correctedTransitions[index] = correctedZ;
        if (Math.abs(correctedZ - originalZ) > 0.001) autoAdjustments.push({ from: originalZ, to: correctedZ });
      }
      if (autoAdjustments.length === 0) throw initialError;
      transitions = correctedTransitions;
      transitions.forEach((z, index) => { junctionConfigs[index].z = z; });
      selectedTransitionValue = transitions[selectedIndex];
      options.transitions = [...transitions];
      options.junctions = junctionConfigs;
      renderTransitionsList();
      updateZHint();
      updateSliderIndicator();
      saveAppState();
      spliceOutput = await workerClient.splice(fileBaseContent, fileVaseContent, options, (msg) => {
        loadingText.textContent = msg;
      });
    }
    const { result, geometry } = spliceOutput;

    splicedGcodeText = result.splicedGcode;
    generatedJunctions.clear();
    result.transitions.forEach(t => generatedJunctions.set(t.nominalZ, t.generatedGcode));
    renderJunctionPanel();
    (window as any).splicedGcodeText = result.splicedGcode;
    // Viewport update
    viewport.setToolpath(geometry, false);
    viewport.setColorMode(colorModeSelect.value as ColorMode);
    maxRenderZ = geometry.metrics.maxZ;

    zSlider.max = String(maxRenderZ);
    zSlider.value = String(maxRenderZ);
    zSliderValue.textContent = `${maxRenderZ.toFixed(2)}mm`;
    layerPlaybackSlider.value = '100';
    layerPlaybackValue.textContent = 'All moves';
    syncVerticalZSlider();
    updateSliderIndicator();

    if (playbackTimeline) playbackTimeline.value = '0';
    if (playbackTimeLabel) {
      const total = viewport.getTotalPlaybackTime();
      const mm = Math.floor(total / 60);
      const ss = Math.floor(total % 60);
      playbackTimeLabel.textContent = `0:00 / ${mm}:${ss < 10 ? '0' : ''}${ss}`;
    }

    // Stats
    statTime.textContent = `${Math.round(result.estimatedSeconds / 60)} min (~)`;
    const density = numericValue(document.getElementById('matDensity') as HTMLInputElement, 1.24);
    const weightGrams = (result.totalExtrudedE * 2.405 * density / 1000).toFixed(1);
    statWeight.textContent = `${weightGrams}g`;
    statLayers.textContent = String(result.finalLayerCount);

    statsPanel?.classList.remove('hidden');
    downloadContainer?.classList.remove('hidden');

    const summary = result.transitions
      .map(
        (t) =>
          `${t.nominalZ.toFixed(2)}mm (${t.matchedZ !== null ? `matched at ${t.matchedZ.toFixed(2)}mm` : 'unmatched'})`
      )
      .join(', ');
    const adjustmentSummary = autoAdjustments.length
      ? `Adjusted for ${firstMode === 'base' ? 'Base-first order' : 'Vase-first order'}: ${autoAdjustments.map(item => `${item.from.toFixed(2)}mm → ${item.to.toFixed(2)}mm`).join(', ')}\n`
      : '';
    updateStatus(`Success!\n${adjustmentSummary}Transitions: ${summary}`);
    modeChangedSinceSplice = false;
    showToast(autoAdjustments.length ? `Splicing complete with ${autoAdjustments.length} corrected transition layer${autoAdjustments.length === 1 ? '' : 's'}.` : 'Splicing Complete!', 'success');
  } catch (err: any) {
    showToast(err.message, 'error');
    updateStatus(`Error: ${err.message}`, true);
  } finally {
    loadingOverlay?.classList.add('hidden');
  }
});

// Download Handlers
downloadBtn?.addEventListener('click', () => {
  if (!splicedGcodeText) return;
  const blob = new Blob([splicedGcodeText], { type: 'text/plain' });
  triggerDownload(blob, 'kintsugi_print.gcode');
});

download3mfBtn?.addEventListener('click', async () => {
  if (!splicedGcodeText) return;
  const zip = new JSZip();

  if (template3mfFile) {
    await zip.loadAsync(template3mfFile);
    const gcodePath =
      templateGcodePath || Object.keys(zip.files).find((name) => name.toLowerCase().endsWith('.gcode'));
    const outputGcodePath = gcodePath || 'Metadata/plate_1.gcode';
    zip.file(outputGcodePath, splicedGcodeText);
    const checksumPath = Object.keys(zip.files).find(name => name.toLowerCase() === `${outputGcodePath.toLowerCase()}.md5`)
      || `${outputGcodePath}.md5`;
    zip.file(checksumPath, md5Hex(splicedGcodeText));
  } else {
    const contentTypesXML = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
  <Default Extension="gcode" ContentType="text/plain"/>
</Types>`;
    zip.file('[Content_Types].xml', contentTypesXML);
    zip.file('Metadata/plate_1.gcode', splicedGcodeText);
    zip.file('Metadata/plate_1.gcode.md5', md5Hex(splicedGcodeText));
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  triggerDownload(blob, 'kintsugi_print.gcode.3mf');
});

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
