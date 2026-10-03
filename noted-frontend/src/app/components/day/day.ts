import { DatePipe, SlicePipe, UpperCasePipe } from '@angular/common';
import { Component, inject, input, signal, viewChild } from '@angular/core';

import { EntryEditor } from 'app/components/entry-editor/entry-editor';
import { Break, Day as DayData, DayItem, Entry, isBreak } from 'app/services/api';
import { AppData } from 'app/services/app-data';

@Component({
  selector: 'app-day',
  imports: [UpperCasePipe, DatePipe, SlicePipe, EntryEditor],
  templateUrl: './day.html',
})
export class Day {
  readonly day = input.required<DayData>();

  private readonly appData = inject(AppData);

  /** Whether the row at the foot of the day is open for typing. */
  protected readonly adding = signal(false);
  protected readonly addError = signal<string | null>(null);
  protected readonly addBusy = signal(false);
  private readonly editor = viewChild(EntryEditor);

  protected async add(text: string) {
    this.addBusy.set(true);
    try {
      await this.appData.addTyped(this.day().date, text);
      this.addError.set(null);
      this.addBusy.set(false);
      // Straight on to the next line: a day is usually typed in one go.
      this.editor()?.reset();
    } catch (error) {
      this.addError.set(error instanceof Error ? error.message : String(error));
      this.addBusy.set(false);
    }
  }

  protected closeEditor() {
    this.adding.set(false);
    this.addError.set(null);
  }

  /**
   * Narrowing for the template, which cannot do `instanceof` or a type guard of
   * its own: each returns the item only when it is of that kind, so an `@if …
   * as` binds it already narrowed.
   */
  protected asBreak(item: DayItem): Break | null {
    return isBreak(item) ? item : null;
  }

  protected asEntry(item: DayItem): Entry | null {
    return isBreak(item) ? null : item;
  }

  protected colourOf(category: string | null): string | null {
    return category ? (this.appData.categoriesByName().get(category)?.colour ?? null) : null;
  }

  /** A break says either when it ran or how long it was, never both. */
  protected describeBreak(pause: Break): string {
    if (pause.start && pause.end) return `${clock(pause.start)}–${clock(pause.end)}`;
    if (pause.start) return `from ${clock(pause.start)}`;
    return pause.minutes === null ? '' : formatMinutes(pause.minutes);
  }
}

function clock(time: string): string {
  return time.slice(0, 5);
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h${`${rest}`.padStart(2, '0')}` : `${hours}h`;
}
