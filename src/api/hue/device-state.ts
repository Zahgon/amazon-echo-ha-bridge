/** The `state` block of a Hue light, both as sent by the Echo and as returned. */

import { bindBoolean, bindInt, bindNumberList, bindString, readObject } from '../../deps/jackson';

export class DeviceState {
  on = false;
  /** The original's field initialiser; a payload without `bri` means full brightness. */
  bri = 255;
  hue = 0;
  sat = 0;
  effect: string | null = null;
  ct = 0;
  alert: string | null = null;
  colormode: string | null = null;
  reachable = false;
  xy: number[] | null = null;

  /**
   * `mapper.readValue(requestString, DeviceState.class)`. A body of literal
   * `null` binds to a null reference rather than an instance — which is what
   * makes the `500` of the state endpoint reachable.
   */
  static fromJson(text: string): DeviceState | null {
    const source = readObject(text);
    if (source === null) {
      return null;
    }
    const state = new DeviceState();
    state.on = bindBoolean(source, 'on', false);
    state.bri = bindInt(source, 'bri', 255);
    state.hue = bindInt(source, 'hue', 0);
    state.sat = bindInt(source, 'sat', 0);
    state.effect = bindString(source, 'effect', null);
    state.ct = bindInt(source, 'ct', 0);
    state.alert = bindString(source, 'alert', null);
    state.colormode = bindString(source, 'colormode', null);
    state.reachable = bindBoolean(source, 'reachable', false);
    state.xy = bindNumberList(source, 'xy');
    return state;
  }

  /** Jackson emits the getters in field-declaration order, nulls included. */
  toJson(): Record<string, unknown> {
    return {
      on: this.on,
      bri: this.bri,
      hue: this.hue,
      sat: this.sat,
      effect: this.effect,
      ct: this.ct,
      alert: this.alert,
      colormode: this.colormode,
      reachable: this.reachable,
      xy: this.xy,
    };
  }

  toString(): string {
    return `DeviceState{on=${String(this.on)}, bri=${String(this.bri)}}`;
  }
}
