import { JunctionConfig, JunctionTuning } from '../core/types';

const fields: [keyof JunctionTuning, string, string][] = [
  ['planarTransitionEnabled', 'Level bonding/support loop', 'boolean'],
  ['continuousConnection', 'Extrude matched connection', 'boolean'],
  ['flowMultiplier', 'Vase flow multiplier', 'number'],
  ['useWallThickness', 'Wall-width tuning', 'boolean'], ['slicedWidth', 'Sliced width (mm)', 'number'], ['targetWidth', 'Target width (mm)', 'number'],
  ['seamMatchEnabled', 'Match outer-wall seam', 'boolean'], ['seamMatchLayersBefore', 'Search layers before', 'number'], ['seamMatchLayersAfter', 'Search layers after', 'number'],
  ['overlapEnabled', 'Lap joint', 'boolean'], ['overlapDistanceMM', 'Lap distance (mm)', 'number'],
  ['leadInEnabled', 'Tangential lead-in', 'boolean'], ['leadInDistanceMM', 'Lead-in distance (mm)', 'number'],
  ['taperEnabled', 'Flow taper', 'boolean'], ['taperDistanceMM', 'Taper distance (mm)', 'number'], ['taperStartRatio', 'Taper start ratio (0–1)', 'number'],
  ['advSpeedEnabled', 'Speed tuning', 'boolean'], ['transSpeed', 'Transition speed (mm/s)', 'number'],
  ['transLayersBefore', 'Speed layers before', 'number'], ['transLayersAfter', 'Speed layers after', 'number'], ['rampMode', 'Speed shape', 'ramp'],
  ['transTemp', 'Temperature (°C)', 'number'], ['transFan', 'Fan (0–255)', 'number'],
  ['hopHeight', 'Fallback hop (mm)', 'number'], ['travelSpeed', 'Travel (mm/min)', 'number'], ['primeSpeed', 'Prime (mm/min)', 'number'],
];

export class JunctionPanel {
  private root = document.createElement('details');
  constructor(anchor: HTMLElement) {
    this.root.className = 'border border-gray-700 rounded p-3 text-xs space-y-2';
    this.root.id = 'junctionPanel';
    anchor.after(this.root);
  }

  render(config: JunctionConfig, generated: string, changed: () => void) {
    this.root.replaceChildren();
    const title = document.createElement('summary');
    title.className = 'cursor-pointer font-bold text-amber-400';
    title.textContent = `Selected junction · ${config.z} mm`;
    this.root.append(title);
    const hint = document.createElement('p');
    hint.textContent = 'Blank fields inherit shared settings. The level-loop option replaces the first rising vase turn or caps the final one; it supersedes lap/taper and short seam extrusion where they conflict. Flow/width apply to the incoming vase section. Base → Vase always searches forward. Splice again to apply edits.';
    hint.className = 'text-gray-400 my-2';
    this.root.append(hint);
    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-2 gap-2';
    config.overrides ??= {};
    for (const [key, label, kind] of fields) {
      const wrap = document.createElement('label');
      wrap.textContent = label;
      wrap.className = 'text-gray-400';
      const control = document.createElement(kind === 'number' ? 'input' : 'select');
      control.dataset.junctionSetting = key;
      control.className = 'w-full mt-1 bg-gray-900 border border-gray-600 rounded p-1 text-white';
      if (control instanceof HTMLInputElement) {
        control.type = 'number'; control.step = 'any'; control.min = '0'; control.placeholder = 'Shared';
        if (key === 'taperStartRatio') control.max = '1';
        if (key === 'transFan') control.max = '255';
      } else {
        const entries = kind === 'boolean' ? [['', 'Shared'], ['true', 'On'], ['false', 'Off']] : [['', 'Shared'], ['ramp', 'Ramp'], ['flat', 'Flat']];
        for (const [value, text] of entries) control.add(new Option(text, value));
      }
      control.value = config.overrides[key] == null ? '' : String(config.overrides[key]);
      control.addEventListener('change', () => {
        if (!control.checkValidity()) { control.reportValidity(); return; }
        const values = config.overrides as Record<string, unknown>;
        if (control.value === '') delete values[key];
        else values[key] = kind === 'boolean' ? control.value === 'true' : kind === 'number' ? Number(control.value) : control.value;
        changed();
      });
      wrap.append(control); grid.append(wrap);
    }
    this.root.append(grid);
    const reset = document.createElement('button'); reset.type = 'button';
    reset.textContent = 'Use shared settings'; reset.className = 'text-amber-400 py-2';
    reset.addEventListener('click', () => { config.overrides = {}; changed(); this.render(config, generated, changed); });
    this.root.append(reset);

    const preview = document.createElement('textarea');
    preview.readOnly = true; preview.rows = 5; preview.id = 'junctionGenerated';
    preview.className = 'w-full bg-gray-950 text-gray-300 font-mono p-2';
    preview.value = generated || 'Splice to see the generated junction code.';
    const previewLabel = document.createElement('p'); previewLabel.textContent = 'Last generated junction (before manual edits)';
    this.root.append(previewLabel, preview);
    config.gcode ??= {};
    for (const [key, text] of [['before', 'Before junction'], ['replacement', 'Junction body'], ['after', 'After junction']] as const) {
      const label = document.createElement('label'); label.textContent = text; label.className = 'block mt-2';
      const area = document.createElement('textarea'); area.rows = 4;
      area.dataset.junctionCode = key;
      area.className = 'w-full bg-gray-900 border border-gray-600 rounded p-2 text-white font-mono';
      area.value = config.gcode[key] ?? '';
      area.placeholder = key === 'replacement' ? 'Automatic generated body' : 'Optional G-code';
      area.disabled = key === 'replacement' && config.gcode.replacement === undefined;
      area.addEventListener('input', () => { config.gcode![key] = area.value; changed(); });
      label.append(area); this.root.append(label);
      if (key === 'replacement') {
        const edit = document.createElement('button'); edit.type = 'button'; edit.id = 'editGeneratedJunction';
        edit.textContent = 'Edit generated body'; edit.disabled = !generated;
        edit.className = 'text-amber-400 mr-3 disabled:opacity-50';
        edit.addEventListener('click', () => {
          config.gcode!.replacement = generated.split('\n').filter(line => !line.includes('KINTSUGIVASE TRANSITION')).join('\n').trim();
          changed(); this.render(config, generated, changed);
        });
        const auto = document.createElement('button'); auto.type = 'button'; auto.textContent = 'Use automatic body'; auto.className = 'text-amber-400';
        auto.addEventListener('click', () => { delete config.gcode!.replacement; changed(); this.render(config, generated, changed); });
        this.root.append(edit, auto);
      }
    }
  }
}
