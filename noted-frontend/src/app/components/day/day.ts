import { DatePipe, NgTemplateOutlet, UpperCasePipe } from '@angular/common';
import { Component, inject, input, signal, viewChild } from '@angular/core';

import { MatMenuModule } from '@angular/material/menu';

import { BreakEditor } from 'app/components/break-editor/break-editor';
import { EntryEditor } from 'app/components/entry-editor/entry-editor';
import { Autofocus } from 'app/directives/autofocus';
import { Break, BreakDraft, Day as DayData, DayItem, Entry, isBreak } from 'app/services/api';
import { AppData } from 'app/services/app-data';
import { clock, formatMinutes } from 'app/services/time';

/** A day's two frame times. */
type Clock = 'arrival' | 'departure';

@Component({
  selector: 'app-day',
  imports: [
    UpperCasePipe,
    DatePipe,
    NgTemplateOutlet,
    Autofocus,
    EntryEditor,
    BreakEditor,
    MatMenuModule,
  ],
  templateUrl: './day.html',
})
export class Day {
  readonly day = input.required<DayData>();

  private readonly appData = inject(AppData);

  protected readonly categories = this.appData.categories.value;

  /** The entry open for editing, if any. */
  protected readonly editingId = signal<number | null>(null);

  /**
   * An edit is plain text, never the syntax again — see specification §3.2. The
   * first line is the entry and the rest its note, as when it was typed.
   */
  protected saveText(entry: Entry, typed: string) {
    const [first, ...rest] = typed.split('\n');
    const note = rest.join('\n').trim();
    this.appData.updateEntry(this.day().date, entry.id, { text: first.trim(), note: note || null });
    this.editingId.set(null);
  }

  protected draftOf(entry: Entry): string {
    return entry.note ? `${entry.text}\n${entry.note}` : entry.text;
  }

  /** Which of the day's frame times is open for editing, if either. */
  protected readonly editingClock = signal<Clock | null>(null);
  protected readonly clock = clock;

  protected onClockKey(event: KeyboardEvent, which: Clock, value: string) {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.saveClock(which, value);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.editingClock.set(null);
    }
  }

  /** Clicking away keeps the time too; only Esc throws it away. */
  protected saveClock(which: Clock, value: string) {
    if (this.editingClock() !== which) return;
    this.editingClock.set(null);
    this.appData.setHours(this.day().date, { [which]: value ? `${value}:00` : null });
  }

  /** The break open for editing, if any. */
  protected readonly editingBreakId = signal<number | null>(null);

  protected saveBreak(pause: Break, draft: BreakDraft) {
    this.appData.updateBreak(this.day().date, pause.id, draft);
    this.editingBreakId.set(null);
  }

  protected setCategory(entry: Entry, category: string | null) {
    this.appData.updateEntry(this.day().date, entry.id, { category });
  }

  /** What the row at the foot of the day is open for, if anything. */
  protected readonly adding = signal<'entry' | 'break' | null>(null);
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

  protected addBreak(draft: BreakDraft) {
    this.appData.addBreak(this.day().date, draft);
    // Back to entries, which is what follows a break far more often than another.
    this.adding.set('entry');
  }

  protected closeEditor() {
    this.adding.set(null);
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
