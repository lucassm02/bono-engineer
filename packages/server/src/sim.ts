/**
 * Demo mode: an in-process FakeConsole streaming synthetic laps on alternate UDP ports (so a real
 * console on 33739/33740 is never disturbed). Optionally restarts the synthetic session (menu +
 * out lap) every N laps, like `npm run sim -- --laps N`.
 */

import { FakeConsole } from '@gt7/protocol';
import type { SimConfig } from './config.ts';

export class DemoConsole {
  readonly config: SimConfig;
  #fake: FakeConsole | null = null;
  #timer: NodeJS.Timeout | null = null;
  #session = 0;
  #restarting = false;
  #stopped = false;

  constructor(config: SimConfig) {
    this.config = config;
  }

  get console(): FakeConsole | null {
    return this.#fake;
  }

  async start(): Promise<void> {
    this.#stopped = false;
    this.#fake = this.#make(this.config.seed);
    await this.#fake.start();
    if (this.config.laps > 0) {
      this.#timer = setInterval(() => void this.#checkLaps(), 500);
      this.#timer.unref?.();
    }
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    const f = this.#fake;
    this.#fake = null;
    if (f) await f.stop();
  }

  #make(seed: number): FakeConsole {
    const c = this.config;
    return new FakeConsole({
      host: '127.0.0.1',
      port: c.consolePort,
      targetPort: c.clientPort,
      seed,
      source: { kind: 'synthetic', profile: c.profile, seed, replay: c.replay, includeMenu: true },
    });
  }

  async #checkLaps(): Promise<void> {
    const f = this.#fake;
    if (!f || this.#restarting || this.#stopped) return;
    const laps = f.synthetic?.completedLaps.length ?? 0;
    if (laps < this.config.laps) return;
    this.#restarting = true;
    try {
      await f.stop();
      if (this.#stopped) return;
      this.#session++;
      this.#fake = this.#make(this.config.seed + this.#session);
      await this.#fake.start();
    } finally {
      this.#restarting = false;
    }
  }
}
