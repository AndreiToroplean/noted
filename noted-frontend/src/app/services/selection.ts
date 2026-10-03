import { Injectable, computed, inject, linkedSignal } from '@angular/core';

import { DayItem, IsoDate } from 'app/services/api';
import { AppData } from 'app/services/app-data';

/**
 * Names an item within its day. Entries and breaks are separate tables, so an
 * id alone can belong to one of each.
 */
export function itemKey(item: DayItem): string {
  return `${item.kind === 'break' ? 'break' : 'entry'}-${item.id}`;
}

interface Selected {
  date: IsoDate | null;
  keys: ReadonlySet<string>;
  /** Where a Shift range is measured from: the last item clicked without Shift. */
  anchor: string | null;
}

const NOTHING: Selected = { date: null, keys: new Set(), anchor: null };

/**
 * Which items are selected, the way a file list does it: a click selects one,
 * Ctrl adds or removes, Shift takes the range from the last click. Always
 * within one day, since a range across days has no order to follow.
 */
@Injectable({ providedIn: 'root' })
export class Selection {
  private readonly appData = inject(AppData);

  private readonly state = linkedSignal<IsoDate | null, Selected>({
    source: this.appData.selectedWeek,
    computation: () => NOTHING,
  });

  readonly date = computed(() => this.state().date);
  readonly keys = computed(() => this.state().keys);
  readonly size = computed(() => this.state().keys.size);

  has(date: IsoDate, key: string): boolean {
    const { date: selectedDate, keys } = this.state();
    return selectedDate === date && keys.has(key);
  }

  /** `order` is the day's items as keys, top to bottom, which is what a range follows. */
  click(date: IsoDate, key: string, order: string[], mods: { ctrl: boolean; shift: boolean }) {
    const current = this.state();
    const sameDay = current.date === date;

    if (mods.shift && sameDay && current.anchor !== null) {
      const from = order.indexOf(current.anchor);
      const to = order.indexOf(key);
      if (from !== -1 && to !== -1) {
        const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
        // The anchor stays put, so a second Shift+click moves the range's end.
        const keys = mods.ctrl ? new Set([...current.keys, ...range]) : new Set(range);
        this.state.set({ date, keys, anchor: current.anchor });
        return;
      }
    }

    if (mods.ctrl && sameDay) {
      const keys = new Set(current.keys);
      if (keys.has(key)) keys.delete(key);
      else keys.add(key);
      this.state.set({ date, keys, anchor: key });
      return;
    }

    this.state.set({ date, keys: new Set([key]), anchor: key });
  }

  /** Select exactly these, as a right-click on an unselected item does. */
  only(date: IsoDate, key: string) {
    this.state.set({ date, keys: new Set([key]), anchor: key });
  }

  clear() {
    this.state.set(NOTHING);
  }
}
