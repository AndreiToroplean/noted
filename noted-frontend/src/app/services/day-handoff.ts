import { Injectable, signal } from '@angular/core';

import { IsoDate } from 'app/services/api';

/** Which end of a day the keyboard arrives at. */
export type HandoffAt = 'first' | 'last';

/**
 * The keyboard handed from one day to another, as Tab and Shift+Tab do: to
 * select there, or, from an editor, to go on editing. Each day watches for its
 * own date, takes the request, and clears it.
 */
@Injectable({ providedIn: 'root' })
export class DayHandoff {
  readonly request = signal<{ date: IsoDate; at: HandoffAt; editing: boolean } | null>(null);

  hand(date: IsoDate, at: HandoffAt, editing: boolean) {
    this.request.set({ date, at, editing });
  }
}
