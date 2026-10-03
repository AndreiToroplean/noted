import { Injectable, signal } from '@angular/core';

import { IsoDate } from 'app/services/api';

/** Which entry of a day to open when editing is handed to it. */
export type HandoffAt = 'first' | 'last';

/**
 * Editing handed from one day to another, as Tab and Shift+Tab do from an
 * editor. Each day watches for its own date, opens the entry asked for, and
 * clears the request.
 */
@Injectable({ providedIn: 'root' })
export class EditHandoff {
  readonly request = signal<{ date: IsoDate; at: HandoffAt } | null>(null);

  hand(date: IsoDate, at: HandoffAt) {
    this.request.set({ date, at });
  }
}
