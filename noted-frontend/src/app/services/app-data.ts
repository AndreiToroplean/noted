import { HttpClient, HttpErrorResponse, httpResource } from '@angular/common/http';
import { Injectable, computed, effect, inject, linkedSignal, signal } from '@angular/core';

import { firstValueFrom } from 'rxjs';

import {
  API_BASE,
  BreakDraft,
  Category,
  Day,
  DayItem,
  Entry,
  IsoDate,
  ParsedItem,
  Settings,
  Time,
  Week,
  itemKey,
  toWrite,
} from 'app/services/api';

/** A line as typed into a day, and the note typed under it. */
export interface Typed {
  text: string;
  note: string | null;
}

/**
 * How long the week sits still before it is written back. Long enough that
 * typing a line doesn't produce a request per keystroke, short enough that
 * closing the tab mid-thought loses nothing worth mourning.
 */
const SAVE_DEBOUNCE_MS = 800;

/** How many changes back Ctrl+Z reaches. */
const UNDO_DEPTH = 200;

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

  /** The default hours of each weekday, which a day's hours start from. */
  readonly settings = httpResource<Settings[]>(() => `${API_BASE}/settings`, {
    defaultValue: [],
  });

  /** The default hours of a date's weekday. */
  defaultsFor(date: IsoDate): Settings | undefined {
    const weekday = (new Date(`${date}T00:00`).getDay() + 6) % 7;
    return this.settings.value().find(row => row.weekday === weekday);
  }

  readonly weeks = httpResource<IsoDate[]>(() => `${API_BASE}/weeks`, { defaultValue: [] });

  /**
   * Weeks opened here that have nothing saved yet. A week exists only as the
   * days stored in it, so a new one is listed from here until it is written to.
   */
  private readonly opened = signal<IsoDate[]>([]);

  /** Every week there is to choose from, newest first. */
  readonly weekList = computed(
    () => [...new Set([...this.weeks.value(), ...this.opened()])].sort().reverse(),
    // The list reloads after every save, nearly always unchanged; only a real
    // change should reach what is built from it.
    { equal: (a, b) => a.length === b.length && a.every((week, index) => week === b[index]) },
  );

  /**
   * The newest week to begin with, then whichever the user picks. The list
   * reloads after every save, and that must not move them off the week they
   * are editing.
   */
  readonly selectedWeek = linkedSignal<IsoDate[], IsoDate | null>({
    source: this.weekList,
    computation: (weeks, previous) =>
      previous?.value && weeks.includes(previous.value) ? previous.value : (weeks[0] ?? null),
  });

  private readonly loaded = httpResource<Week>(() => {
    const week = this.selectedWeek();
    return week ? `${API_BASE}/journal/${week}` : undefined;
  });

  /** The week being edited. Every change to it is eventually written back whole. */
  readonly week = linkedSignal<Week | undefined>(() => this.loaded.value());

  /** The open week's weekend asked for while empty. Forgotten on leaving the week. */
  readonly weekendShown = linkedSignal({ source: this.selectedWeek, computation: () => false });

  /** Something written on the weekend, which keeps it shown. */
  readonly weekendInUse = computed(
    () =>
      this.week()
        ?.days.slice(5)
        .some(day => day.items.length > 0) ?? false,
  );

  /** The last version known to be on the server, so edits can be told from reloads. */
  private readonly persisted = linkedSignal<Week | undefined>(() => this.loaded.value());

  /**
   * Earlier versions of the week, newest last, and versions undone. Kept per
   * week: moving to another week starts both afresh, since a change to one week
   * is not something to take back from another.
   */
  private readonly past = linkedSignal<IsoDate | null, Week[]>({
    source: this.selectedWeek,
    computation: () => [],
  });
  private readonly future = linkedSignal<IsoDate | null, Week[]>({
    source: this.selectedWeek,
    computation: () => [],
  });

  readonly canUndo = computed(() => this.past().length > 0);
  readonly canRedo = computed(() => this.future().length > 0);

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

  /** Go to a week, listing it first if it is new. */
  openWeek(week: IsoDate) {
    if (!this.weekList().includes(week)) this.opened.update(opened => [...opened, week]);
    this.selectedWeek.set(week);
  }

  /**
   * Delete a week for good. Not undoable — it is gone from the server — which is
   * why the footer always asks first. A week started here and never written to
   * was never on the server, so it is only forgotten. If it was the week being
   * edited, the one before it takes its place.
   */
  async deleteWeek(week: IsoDate): Promise<void> {
    const list = this.weekList();
    const index = list.indexOf(week);
    const saved = this.weeks.value().includes(week);

    if (this.selectedWeek() === week) {
      this.selectedWeek.set(list[index + 1] ?? list[index - 1] ?? null);
    }
    this.opened.update(opened => opened.filter(other => other !== week));
    if (!saved) return;

    await firstValueFrom(this.http.delete(`${API_BASE}/journal/${week}`));
    this.weeks.reload();
  }

  /**
   * Read a typed line and add what it turned out to be to the end of a day.
   * Rejects with the API's own explanation when the line cannot be read, so
   * the editor can show it where it was typed.
   */
  async addTyped(date: IsoDate, typed: Typed): Promise<void> {
    const parsed = await this.read(typed);
    this.updateDay(date, day => place(day, parsed));
  }

  /**
   * Retype an entry: read what its editor holds as a new line would be read,
   * and apply it over the entry. What the line names overrides; what it leaves
   * out — a category, a project — the entry keeps. A line that reads as a break
   * or a time turns the entry into that.
   */
  async retype(date: IsoDate, id: number, typed: Typed) {
    const parsed = await this.read(typed);
    this.updateDay(date, day => overlay(day, id, parsed));
  }

  /** A line as typed, with its note as the line under it, read by the API's grammar. */
  private async read(typed: Typed): Promise<ParsedItem> {
    const text = typed.note === null ? typed.text : `${typed.text}\n${typed.note}`;
    try {
      return await firstValueFrom(this.http.post<ParsedItem>(`${API_BASE}/parse`, { text }));
    } catch (error) {
      throw new Error(explain(error));
    }
  }

  /** Add a break made in the editor, already in fields, to the end of a day. */
  addBreak(date: IsoDate, draft: BreakDraft) {
    this.updateDay(date, day => place(day, draft));
  }

  /** Set a day's arrival or departure. */
  setHours(date: IsoDate, hours: Partial<Pick<Day, 'arrival' | 'departure'>>) {
    this.updateDay(date, day => ({ ...day, ...hours }));
  }

  /**
   * Back from where the departure said they had gone: the time away becomes a
   * break, and the departure goes back to the default, the day not being over.
   */
  cameBack(date: IsoDate, at: Time) {
    const departure = this.defaultsFor(date)?.departure ?? null;
    this.updateDay(date, day => {
      if (!day.departure) return day;
      const away: BreakDraft = {
        kind: 'break',
        is_noon: false,
        description: null,
        start: day.departure,
        end: at,
        minutes: null,
      };
      return place({ ...day, departure }, away);
    });
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

  /** Remove items from a day, named by `itemKey`. Undoable like any other edit. */
  removeItems(date: IsoDate, keys: ReadonlySet<string>) {
    this.updateDay(date, day => ({
      ...day,
      items: day.items.filter(item => !keys.has(itemKey(item))),
    }));
  }

  /** Change the same fields on several entries, named by `itemKey`, in one edit. */
  updateEntries(date: IsoDate, keys: ReadonlySet<string>, change: Partial<Entry>) {
    this.updateDay(date, day => ({
      ...day,
      items: day.items.map(item =>
        item.kind !== 'break' && keys.has(itemKey(item)) ? { ...item, ...change } : item,
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

  /** Take back the last change. It is written back like any other edit. */
  undo() {
    const current = this.week();
    const previous = this.past().at(-1);
    if (!current || !previous) return;
    this.past.update(past => past.slice(0, -1));
    this.future.update(future => [...future, current]);
    this.week.set(previous);
  }

  redo() {
    const current = this.week();
    const next = this.future().at(-1);
    if (!current || !next) return;
    this.future.update(future => future.slice(0, -1));
    this.past.update(past => [...past, current]);
    this.week.set(next);
  }

  /**
   * Move items, named by `itemKey`, within their day or into another, as one
   * block in the order they had. `toIndex` counts among the day's other items:
   * the block goes in before whichever of them is at that index. One edit, so
   * one undo puts it all back, across days included.
   */
  moveItems(fromDate: IsoDate, keys: ReadonlySet<string>, toDate: IsoDate, toIndex: number) {
    this.change(week => {
      const moving = week.days
        .find(day => day.date === fromDate)
        ?.items.filter(item => keys.has(itemKey(item)));
      if (!moving?.length) return week;
      return {
        ...week,
        days: week.days.map(day => {
          let items = day.items;
          if (day.date === fromDate) items = items.filter(item => !keys.has(itemKey(item)));
          if (day.date === toDate) {
            items = [...items.slice(0, toIndex), ...moving, ...items.slice(toIndex)];
          }
          return items === day.items ? day : { ...day, items };
        }),
      };
    });
  }

  private updateDay(date: IsoDate, change: (day: Day) => Day) {
    this.change(week => ({
      ...week,
      days: week.days.map(day => (day.date === date ? change(day) : day)),
    }));
  }

  /** Every edit comes through here, which is what makes every edit undoable. */
  private change(edit: (week: Week) => Week) {
    const before = this.week();
    if (!before) return;
    const after = edit(before);
    if (after === before) return;
    this.week.set(after);
    this.past.update(past => [...past.slice(1 - UNDO_DEPTH), before]);
    this.future.set([]);
  }

  private save(draft: Week) {
    this.saving.set(true);
    this.saveFailed.set(false);

    this.http.put<Week>(`${API_BASE}/journal/${draft.week}`, toWrite(draft)).subscribe({
      next: () => {
        // The draft is what is on the server now. Its copy is not adopted: the
        // server gives every item a new id on each save, and the page goes by
        // ids — what is selected, open, or kept as a draft.
        this.persisted.set(draft);
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

function overlay(day: Day, id: number, parsed: ParsedItem): Day {
  const index = day.items.findIndex(item => item.kind !== 'break' && item.id === id);
  if (index < 0) return day;
  const entry = day.items[index] as Entry;
  if (parsed.kind === 'clock') {
    return place({ ...day, items: day.items.filter((_, at) => at !== index) }, parsed);
  }
  let item: DayItem;
  if (parsed.kind === 'break') {
    item = { ...parsed, id: nextLocalId--, position: entry.position };
  } else if (parsed.kind === 'meta') {
    item = {
      ...entry,
      kind: 'meta',
      text: parsed.text,
      note: parsed.note,
      category: null,
      project_id: null,
    };
  } else {
    item = {
      ...entry,
      kind: 'task',
      text: parsed.text,
      note: parsed.note,
      category: parsed.category ?? (entry.kind === 'meta' ? null : entry.category),
      project_id: parsed.project_id ?? entry.project_id,
    };
  }
  return { ...day, items: day.items.map((other, at) => (at === index ? item : other)) };
}

function explain(error: unknown): string {
  const detail: unknown = error instanceof HttpErrorResponse ? error.error?.detail : undefined;
  return typeof detail === 'string' ? detail : 'That line could not be read.';
}
