/**
 * Dastur holati.
 *
 * Bitta joyda saqlanadi va o'zgarganda kuzatuvchilarga xabar beriladi —
 * tray menyusi, ikonka va sozlamalar oynasi shu holatdan hosil bo'ladi.
 */
import type { BarcodeerConfig } from '@barcodeer/core';

export type Status = 'off' | 'idle' | 'busy' | 'error';

export interface LastRun {
  at: string;
  documents: number;
  rows: number;
  flagged: number;
  /** `Ид + ШК` allaqachon bor bo'lgani uchun o'tkazib yuborilgan qatorlar. */
  skipped: number;
  /** Xato bo'lsa qisqacha izoh. */
  error: string | null;
}

export interface AppState {
  config: BarcodeerConfig;
  status: Status;
  /** Hozir bajarilayotgan ish haqida qisqa matn (`Sahifa 2/4`). */
  activity: string | null;
  lastRun: LastRun | null;
  /** Kuzatuvchi papka ishlayaptimi. */
  watching: boolean;
}

type Listener = (state: AppState) => void;

export class Store {
  #state: AppState;
  readonly #listeners = new Set<Listener>();

  constructor(config: BarcodeerConfig) {
    this.#state = {
      config,
      status: config.enabled ? 'idle' : 'off',
      activity: null,
      lastRun: null,
      watching: false,
    };
  }

  get state(): Readonly<AppState> {
    return this.#state;
  }

  get enabled(): boolean {
    return this.#state.config.enabled;
  }

  get busy(): boolean {
    return this.#state.status === 'busy';
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  update(patch: Partial<AppState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener(this.#state);
  }

  patchConfig(patch: Partial<BarcodeerConfig>): BarcodeerConfig {
    const config = { ...this.#state.config, ...patch };
    // Yoqilganlik holati bevosita status'ga ta'sir qiladi.
    const status: Status = config.enabled ? (this.busy ? 'busy' : 'idle') : 'off';
    this.update({ config, status });
    return config;
  }
}
