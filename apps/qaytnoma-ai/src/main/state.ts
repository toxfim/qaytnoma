/**
 * Ilova holati — tray menyusi, ikonka va sozlamalar oynasi shundan hosil
 * bo'ladi.
 */
import type { BarcodeerConfig } from '@barcodeer/core';

export type Status = 'off' | 'idle' | 'busy' | 'error';

export interface LastRun {
  at: string;
  documents: number;
  rows: number;
  flagged: number;
  skipped: number;
  /** Sarflangan tokenlar va taxminiy narx — foydalanuvchi ko'rib tursin. */
  tokens: number;
  usd: number;
  error: string | null;
}

export interface AppState {
  config: BarcodeerConfig;
  status: Status;
  activity: string | null;
  lastRun: LastRun | null;
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
    const status: Status = config.enabled ? (this.busy ? 'busy' : 'idle') : 'off';
    this.update({ config, status });
    return config;
  }
}
