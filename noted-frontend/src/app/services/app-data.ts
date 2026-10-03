import { HttpClient, HttpErrorResponse, httpResource } from '@angular/common/http';
import { Injectable, computed, effect, inject, linkedSignal, signal } from '@angular/core';

import { firstValueFrom } from 'rxjs';

import {
  API_BASE,
  BreakDraft,
  Category,
  Day,
  Entry,
  IsoDate,
  ParsedItem,
  Week,
  toWrite,
} from 'app/services/api';

/**
 * How long the week sits still before it is written back. Long enough that
 * typing a line doesn't produce a request per keystroke, short enough that
 * closing the tab mid-thought loses nothing worth mourning.
 */
const SAVE_DEBOUNCE_MS = 800;

/**
 * Ids for items made here and not yet saved. Negative so they can never meet
 * one the server assigned; they are dropped on the way out, like every id.
 */
let nextLocalId = -1;

@Injectable({ providedIn: 'root' })
export class AppData {
  private readonly http = inject(HttpClient);

  /**
   * The category vocabulary, colours included. They live in the database rather
   * than in CSS because they are the user's data: he renames them and repaints
   * them, and the app must not have an opinion baked into a stylesheet.
   */
  readonly categories = httpResource<Category[]>(() => `${API_BASE}/categories`, {
    defaultValue: [],
  });

  readonly categoriesByName = computed(
    () => new Map(this.categories.value().map(category => [category.name, category])),
  );

  readonly weeks = httpResource<IsoDate[]>(() => `${API_BASE}/weeks`, { defaultValue: [] });

  /**
   * The newest week to begin with, then whichever the user picks. The list
   * reloads after every save, and that must not move them off the week they
   * are editing.
   */
  readonly selectedWeek = linkedSignal<IsoDate[], IsoDate | null>({
    source: this.weeks.value,
    computation: (weeks, previous) =>
      previous?.value && weeks.includes(previous.value) ? previous.value : (weeks[0] ?? null),
  });

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

  /**
   * Read a typed line and add what it turned out to be to the end of a day.
   * Rejects with the API's own explanation when the line cannot be read, so
   * the editor can show it where it was typed.
   */
  async addTyped(date: IsoDate, text: string): Promise<void> {
    let parsed: ParsedItem;
    try {
      parsed = await firstValueFrom(this.http.post<ParsedItem>(`${API_BASE}/parse`, { text }));
    } catch (error) {
      throw new Error(explain(error));
    }
    this.updateDay(date, day => place(day, parsed));
  }

  /** Add a break made in the editor, already in fields, to the end of a day. */
  addBreak(date: IsoDate, draft: BreakDraft) {
    this.updateDay(date, day => place(day, draft));
  }

  /** Set a day's arrival or departure. */
  setHours(date: IsoDate, hours: Partial<Pick<Day, 'arrival' | 'departure'>>) {
    this.updateDay(date, day => ({ ...day, ...hours }));
  }

  /** Replace a break with what the editor made of it. */
  updateBreak(date: IsoDate, id: number, draft: BreakDraft) {
    this.updateDay(date, day => ({
      ...day,
      items: day.items.map(item =>
        item.kind === 'break' && item.id === id ? { ...draft, id, position: item.position } : item,
      ),
    }));
  }

  /** Change some of an entry's fields. Breaks have ids of their own, so only entries match. */
  updateEntry(date: IsoDate, id: number, change: Partial<Entry>) {
    this.updateDay(date, day => ({
      ...day,
      items: day.items.map(item =>
        item.kind !== 'break' && item.id === id ? { ...item, ...change } : item,
      ),
    }));
  }

  private updateDay(date: IsoDate, change: (day: Day) => Day) {
    this.week.update(
      week =>
        week && { ...week, days: week.days.map(day => (day.date === date ? change(day) : day)) },
    );
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

function place(day: Day, parsed: ParsedItem): Day {
  if (parsed.kind === 'clock') {
    // The importer's rule: an arrow before any work is the arrival, and one
    // after it is the departure.
    const started = day.items.some(item => item.kind === 'task');
    return started ? { ...day, departure: parsed.time } : { ...day, arrival: parsed.time };
  }
  const item = { ...parsed, id: nextLocalId--, position: day.items.length };
  return { ...day, items: [...day.items, item] };
}

function explain(error: unknown): string {
  const detail: unknown = error instanceof HttpErrorResponse ? error.error?.detail : undefined;
  return typeof detail === 'string' ? detail : 'That line could not be read.';
}
