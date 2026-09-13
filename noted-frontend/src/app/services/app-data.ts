import { HttpClient, httpResource } from '@angular/common/http';
import { Injectable, effect, inject, linkedSignal, signal } from '@angular/core';

import { API_BASE, IsoDate, Week, toWrite } from 'app/services/api';

/**
 * How long the week sits still before it is written back. Long enough that
 * typing a line doesn't produce a request per keystroke, short enough that
 * closing the tab mid-thought loses nothing worth mourning.
 */
const SAVE_DEBOUNCE_MS = 800;

@Injectable({ providedIn: 'root' })
export class AppData {
  private readonly http = inject(HttpClient);

  readonly weeks = httpResource<IsoDate[]>(() => `${API_BASE}/weeks`, { defaultValue: [] });

  readonly selectedWeek = linkedSignal<IsoDate | null>(() => this.weeks.value()[0] ?? null);

  private readonly loaded = httpResource<Week>(() => {
    const week = this.selectedWeek();
    return week ? `${API_BASE}/journal/${week}` : undefined;
  });

  /** The week being edited. Every change to it is eventually written back whole. */
  readonly week = linkedSignal<Week | undefined>(() => this.loaded.value());

  /** The last version known to be on the server, so edits can be told from reloads. */
  private readonly persisted = linkedSignal<Week | undefined>(() => this.loaded.value());

  readonly loading = this.loaded.isLoading;
  readonly saving = signal(false);
  readonly saveFailed = signal(false);

  constructor() {
    effect(onCleanup => {
      const draft = this.week();
      if (!draft || draft === this.persisted()) return;

      const handle = setTimeout(() => this.save(draft), SAVE_DEBOUNCE_MS);
      onCleanup(() => clearTimeout(handle));
    });
  }

  private save(draft: Week) {
    this.saving.set(true);
    this.saveFailed.set(false);

    this.http.put<Week>(`${API_BASE}/journal/${draft.week}`, toWrite(draft)).subscribe({
      next: saved => {
        // Adopt the server's copy only if nothing was typed while it was in
        // flight; otherwise keep the newer draft and let the effect save again.
        if (this.week() === draft) {
          this.week.set(saved);
          this.persisted.set(saved);
        } else {
          this.persisted.set(draft);
        }
        this.saving.set(false);
        this.weeks.reload();
      },
      error: () => {
        this.saving.set(false);
        this.saveFailed.set(true);
      },
    });
  }
}
