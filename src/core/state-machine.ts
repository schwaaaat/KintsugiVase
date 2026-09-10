import { GCodeCommand, MachineState } from './types';

export class KinematicStateMachine {
  state: MachineState;

  constructor(initial?: Partial<MachineState>) {
    this.state = {
      x: 0,
      y: 0,
      z: 0,
      f: 3000,
      isRelativeE: true, // Default to relative E
      lastE: 0,
      totalExtrudedE: 0,
      hotendTemp: null,
      waitTemp: null,
      fanSpeed: null,
      activeFeature: 'UNKNOWN',
      ...initial,
    };
  }

  process(cmd: GCodeCommand): { deltaE: number; isExtrusion: boolean } {
    let deltaE = 0;
    let isExtrusion = false;

    if (cmd.type === 'mode') {
      if (cmd.cmd === 'M82') {
        this.state.isRelativeE = false;
      } else if (cmd.cmd === 'M83') {
        this.state.isRelativeE = true;
      } else if (cmd.cmd === 'G92') {
        if (cmd.e !== undefined) {
          this.state.lastE = cmd.e;
        }
      }
    } else if (cmd.type === 'temp') {
      if (cmd.m === 104) {
        this.state.hotendTemp = cmd.s ?? null;
      } else if (cmd.m === 109) {
        this.state.waitTemp = cmd.s ?? null;
      } else if (cmd.m === 106) {
        this.state.fanSpeed = cmd.s ?? null;
      } else if (cmd.m === 107) {
        this.state.fanSpeed = 0;
      }
    } else if (cmd.type === 'comment') {
      if (cmd.feature) {
        this.state.activeFeature = cmd.feature;
      }
    } else if (cmd.type === 'motion') {
      if (cmd.f !== undefined) this.state.f = cmd.f;
      if (cmd.x !== undefined) this.state.x = cmd.x;
      if (cmd.y !== undefined) this.state.y = cmd.y;
      if (cmd.z !== undefined) this.state.z = cmd.z;

      if (cmd.e !== undefined) {
        if (this.state.isRelativeE) {
          deltaE = cmd.e;
        } else {
          deltaE = cmd.e - this.state.lastE;
          this.state.lastE = cmd.e;
        }

        if (deltaE > 0) {
          isExtrusion = true;
          this.state.totalExtrudedE += deltaE;
        }
      }
    }

    return { deltaE, isExtrusion };
  }

  snapshot(): MachineState {
    return { ...this.state };
  }
}
