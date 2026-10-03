import { DatePipe, NgTemplateOutlet, UpperCasePipe } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

import {
  CdkDrag,
  CdkDragDrop,
  CdkDragPlaceholder,
  CdkDragPreview,
  CdkDropList,
} from '@angular/cdk/drag-drop';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';

import { BreakEditor } from 'app/components/break-editor/break-editor';
import {
  EditorMove,
  EntryText,
  InlineEntryEditor,
} from 'app/components/inline-entry-editor/inline-entry-editor';
import { Autofocus } from 'app/directives/autofocus';
import {
  Break,
  BreakDraft,
  Category,
  Day as DayData,
  DayItem,
  Entry,
  IsoDate,
  isBreak,
  isoDate,
  itemKey,
} from 'app/services/api';
import { AppData } from 'app/services/app-data';
import { Drafts } from 'app/services/drafts';
import { EditHandoff } from 'app/services/edit-handoff';
import { Selection } from 'app/services/selection';
import { clock, formatMinutes } from 'app/services/time';

/** A day's two frame times. */
type Clock = 'arrival' | 'departure';

/** Where an editor's caret starts — see `InlineEntryEditor.enterAt`. */
type EnterAt = 'text' | 'start' | 'end';

/** An entry with nothing written in it yet. */
const BLANK: EntryText = { text: '', note: null };

@Component({
  selector: 'app-day',
  imports: [
    UpperCasePipe,
    DatePipe,
    NgTemplateOutlet,
    Autofocus,
    InlineEntryEditor,
    BreakEditor,
    MatMenuModule,
    MatIconModule,
    MatTooltipModule,
    CdkDropList,
    CdkDrag,
    CdkDragPlaceholder,
    CdkDragPreview,
  ],
  templateUrl: './day.html',
})
export class Day {
  readonly day = input.required<DayData>();
  /** The days shown either side, where Shift+Tab and Tab take the editing. */
  readonly previousDate = input<IsoDate | null>(null);
  readonly nextDate = input<IsoDate | null>(null);

  private readonly appData = inject(AppData);
  private readonly selection = inject(Selection);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly keyOf = itemKey;

  /** The day's items as keys, top to bottom: what a Shift range and the arrow keys follow. */
  private readonly order = computed(() => this.day().items.map(itemKey));

  /** The option last focused. It holds the day's one tab stop, so Tab lands back on it. */
  protected readonly focused = signal<string | null>(null);
  protected readonly tabStop = computed(() => {
    const focused = this.focused();
    return focused && this.order().includes(focused) ? focused : (this.order()[0] ?? null);
  });

  protected isSelected(key: string): boolean {
    return this.selection.has(this.day().date, key);
  }

  protected onItemClick(key: string, event: MouseEvent) {
    if (insideEditor(event.target)) return;
    this.selection.click(this.day().date, key, this.order(), {
      ctrl: event.ctrlKey || event.metaKey,
      shift: event.shiftKey,
    });
  }

  /** Shift+click would otherwise select the text between the two clicks. */
  protected onItemMousedown(key: string, event: MouseEvent) {
    if (insideEditor(event.target)) return;
    if (event.shiftKey) event.preventDefault();
    this.measureCarried(key);
  }

  /**
   * Measured on press rather than once the drag starts: the drag makes its gap
   * before it says it has started. It is one measurement per click, and it
   * hides nothing, so a plain click is unaffected.
   */
  private measureCarried(key: string) {
    const keys = this.selection.carriedBy(this.day().date, key);
    const rows = this.order()
      .filter(other => keys.has(other))
      .map(other => this.host.nativeElement.querySelector<HTMLElement>(`[data-key="${other}"]`))
      .filter(row => row !== null);
    if (rows.length === 0) return;
    // Each item keeps one step of space below it, so each join adds one of those.
    const join = parseFloat(getComputedStyle(rows[0]).marginBottom) || 0;
    const height = rows.reduce((total, row) => total + row.getBoundingClientRect().height, 0);
    this.selection.carriedHeight.set(height + join * (rows.length - 1));
    this.pressed.set({ key, keys, width: rows[0].getBoundingClientRect().width });
  }

  /** The item last pressed, what it would carry, and how wide the day draws it. */
  protected readonly pressed = signal<{
    key: string;
    keys: ReadonlySet<string>;
    width: number;
  } | null>(null);

  /** What a drag of the pressed item holds, in the day's order: the preview draws these. */
  protected readonly carriedItems = computed(() => {
    const keys = this.pressed()?.keys;
    return keys ? this.day().items.filter(item => keys.has(itemKey(item))) : [];
  });

  /** Whether one of this day's items is being dragged right now. */
  private readonly dragging = signal(false);
  private readonly changes = inject(ChangeDetectorRef);

  /**
   * The other items a drag carries fold away while it is on, so the day shows
   * the shape it will have. Applied at once: the drag measures the list straight
   * after this, and must measure it folded.
   */
  protected onDragStarted() {
    this.dragging.set(true);
    this.changes.detectChanges();
  }

  protected onDragEnded() {
    this.dragging.set(false);
  }

  /** Folded away for the drag: carried along, but not the item in hand. */
  protected isFolded(key: string): boolean {
    const pressed = this.pressed();
    if (!this.dragging() || !pressed || key === pressed.key) return false;
    return pressed.keys.has(key);
  }

  protected readonly carriedHeight = this.selection.carriedHeight;

  /**
   * A listbox's arrow keys: move and select, Shift to extend from where the
   * range started, Ctrl to move without selecting. Keys typed into an editor
   * inside the option are the editor's.
   */
  protected onItemKeydown(key: string, event: KeyboardEvent) {
    if (event.target !== event.currentTarget) return;
    if (event.key === ' ') {
      event.preventDefault(); // acted on at keyup, as a native control does; this stops the scroll
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      this.edit(key);
      return;
    }
    const step = { ArrowUp: -1, ArrowDown: 1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();

    const order = this.order();
    const next = order[Math.min(order.length - 1, Math.max(0, order.indexOf(key) + step))];
    const ctrl = event.ctrlKey || event.metaKey;
    if (!ctrl) {
      this.selection.click(this.day().date, next, order, { ctrl: false, shift: event.shiftKey });
    }
    this.focusOption(next);
  }

  /**
   * Space ticks the selection, or the focused item if it is not part of it.
   * Mixed, it ticks them all; all done already, it unticks them. One edit, so
   * one Ctrl+Z.
   */
  protected onItemKeyup(key: string, event: KeyboardEvent) {
    if (event.target !== event.currentTarget || event.key !== ' ') return;
    if (!this.isSelected(key)) this.selection.only(this.day().date, key);

    const tasks = this.selectedTasks();
    if (tasks.length === 0) return;
    const done = tasks.some(entry => !entry.done);
    this.appData.updateEntries(this.day().date, new Set(tasks.map(itemKey)), { done });
  }

  /** Open an item in its editor, as a double-click does. */
  private edit(key: string) {
    const item = this.day().items.find(other => itemKey(other) === key);
    if (!item) return;
    if (isBreak(item)) this.openBreak(item);
    else this.openEntry(item);
  }

  /** An item open in an editor stays put: dragging would take the text field with it. */
  protected isEditing(item: DayItem): boolean {
    return isBreak(item) ? this.editingBreakId() === item.id : this.editing()?.id === item.id;
  }

  /**
   * A drop from this day or from another; every day's list is in one group.
   *
   * The drag reports where the item in hand landed among the list it was
   * dropped in, folded items included. The block goes in before the first of
   * the day's other items to follow that point.
   */
  protected onDrop(event: CdkDragDrop<IsoDate, IsoDate, string>) {
    const from = event.previousContainer.data;
    const to = event.container.data;
    const inHand = event.item.data;
    const keys = this.selection.carriedBy(from, inHand);

    const target = to === this.day().date ? this.order() : [];
    const before = target
      .filter(key => key !== inHand)
      .slice(0, event.currentIndex)
      .filter(key => !keys.has(key)).length;
    this.appData.moveItems(from, keys, to, from === to ? before : event.currentIndex);
  }

  /** How many items the context menu's Delete acts on. */
  protected readonly selectedCount = this.selection.size;

  /** Where the right-click was, so the menu opens under the pointer. */
  protected readonly menuAt = signal({ x: 0, y: 0 });
  private readonly itemMenu = viewChild.required<MatMenuTrigger>('itemMenuTrigger');

  /**
   * Right-click acts on the selection when it lands inside it, and otherwise on
   * the item clicked — what a file manager does. An editor keeps the browser's
   * own menu, which has copy and paste on it.
   */
  protected onItemContextMenu(key: string, event: MouseEvent) {
    if (insideEditor(event.target)) return;
    event.preventDefault();
    if (!this.isSelected(key)) this.selection.only(this.day().date, key);
    this.menuAt.set({ x: event.clientX, y: event.clientY });
    this.itemMenu().openMenu();
  }

  protected deleteSelected() {
    this.selection.deleteSelected();
  }

  private focusOption(key: string) {
    this.focused.set(key);
    this.host.nativeElement.querySelector<HTMLElement>(`[data-key="${key}"]`)?.focus();
  }

  protected readonly categories = this.appData.categories.value;

  /**
   * The entry open for editing, if any, and what its editor opened on: the
   * draft left last time, or the entry as it is. Taken once, at opening, so a
   * redraw while typing cannot reset the editor to it.
   */
  protected readonly editing = signal<{
    id: number;
    from: EntryText;
    /** The entry as saved, when it opened on a draft, for Ctrl+Z to go back to. */
    original: EntryText | null;
    enterAt: EnterAt;
  } | null>(null);

  private readonly drafts = inject(Drafts);

  /**
   * Editing is of one item, and its own highlight says which, so the selection
   * lets go rather than wash over the text being typed.
   */
  protected openEntry(entry: Entry, enterAt: EnterAt = 'text') {
    this.selection.clear();
    this.editError.set(null);
    const saved = { text: entry.text, note: entry.note };
    const draft = this.drafts.get<EntryText>(itemKey(entry));
    this.editing.set({
      id: entry.id,
      from: draft ?? saved,
      original: draft ? saved : null,
      enterAt,
    });
  }

  /** The day's entries in order, breaks aside: what Up and Down travel through. */
  private readonly entries = computed(() =>
    this.day().items.filter((item): item is Entry => !isBreak(item)),
  );

  private readonly handoff = inject(EditHandoff);

  /**
   * The keyboard leaving an editor: `from` is the entry it was open on, or null
   * for the row for a new one. What was typed waits as a draft, as it would on
   * Esc. Breaks are passed over, their fields having their own use for arrows.
   * With nowhere to go, the editor stays open.
   */
  protected onMoved(from: Entry | null, move: EditorMove) {
    const entries = this.entries();
    const index = from ? entries.findIndex(entry => entry.id === from.id) : entries.length;
    const leave = () => (from ? this.closeEdit(from, move.typed) : this.closeEditor(move.typed));

    if (move.to === 'up') {
      const above = entries[index - 1];
      if (!above) return;
      leave();
      this.openEntry(above, 'end');
    } else if (move.to === 'down') {
      if (!from) return;
      const below = entries[index + 1];
      leave();
      if (below) this.openEntry(below, 'start');
      else this.writeEntry('start');
    } else {
      const forward = move.to === 'next-day';
      const date = forward ? this.nextDate() : this.previousDate();
      if (!date) return;
      leave();
      this.handoff.hand(date, forward ? 'first' : 'last');
    }
  }

  /** Editing handed over from another day: open the entry it asks for. */
  private readonly takeHandoff = effect(() => {
    const request = this.handoff.request();
    if (request?.date !== this.day().date) return;
    untracked(() => {
      this.handoff.request.set(null);
      const entries = this.entries();
      const entry = request.at === 'first' ? entries[0] : entries.at(-1);
      const enterAt = request.at === 'first' ? 'start' : 'end';
      if (entry) this.openEntry(entry, enterAt);
      else this.writeEntry(enterAt);
    });
  });

  /** Why the open entry's last save was refused, and whether one is on its way. */
  protected readonly editError = signal<string | null>(null);
  protected readonly editBusy = signal(false);

  /**
   * Saved as a new line would be: read through the syntax, and laid over the
   * entry, so a category typed at its head replaces the one it had.
   */
  protected async saveText(entry: Entry, edited: EntryText) {
    this.editBusy.set(true);
    try {
      await this.appData.retype(this.day().date, entry.id, edited);
      this.drafts.drop(itemKey(entry));
      this.editError.set(null);
      this.editing.set(null);
    } catch (error) {
      this.editError.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.editBusy.set(false);
    }
  }

  /** Closed unsaved: anything that differs from the entry waits as a draft. */
  protected closeEdit(entry: Entry, edited: EntryText) {
    // Already closed — a save that landed takes the field away, which blurs it.
    if (this.editing()?.id !== entry.id) return;
    const unchanged = edited.text === entry.text && edited.note === entry.note;
    if (unchanged) this.drafts.drop(itemKey(entry));
    else this.drafts.keep(itemKey(entry), edited);
    this.editError.set(null);
    this.editing.set(null);
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

  protected openBreak(pause: Break) {
    this.selection.clear();
    this.editingBreakId.set(pause.id);
  }

  /** What a break's editor opens on: the draft left last time, or the break as it is. */
  protected breakDraftOf(pause: Break): BreakDraft {
    return this.drafts.get<BreakDraft>(itemKey(pause)) ?? pause;
  }

  protected saveBreak(pause: Break, draft: BreakDraft) {
    this.appData.updateBreak(this.day().date, pause.id, draft);
    this.drafts.drop(itemKey(pause));
    this.editingBreakId.set(null);
  }

  /** Closed unsaved: a change waits as a draft. */
  protected closeBreakEdit(pause: Break, changed: BreakDraft | null) {
    if (changed) this.drafts.keep(itemKey(pause), changed);
    this.editingBreakId.set(null);
  }

  /** Whether the day is over: what turns its unfinished work into failed work. */
  private readonly past = computed(() => this.day().date < isoDate(new Date()));

  /** Specification §8: past, not done, and with something written. Red beats every other colour. */
  protected isFailedItem(item: DayItem): boolean {
    return this.past() && item.kind === 'task' && !item.done && item.text.trim() !== '';
  }

  protected toggleDone(entry: Entry) {
    this.appData.updateEntry(this.day().date, entry.id, { done: !entry.done });
  }

  /** The selected tasks: what Space ticks. */
  private readonly selectedTasks = computed(() =>
    this.day().items.filter(
      (item): item is Entry =>
        item.kind === 'task' && this.selection.has(this.day().date, itemKey(item)),
    ),
  );

  /** The entry whose category menu is open. */
  protected readonly categoryFor = signal<Entry | null>(null);
  private readonly categoryMenu = viewChild.required<MatMenuTrigger>('categoryMenuTrigger');

  /** A double-click on the category's tag opens the menu of categories under it. */
  protected openCategoryMenu(entry: Entry, event: MouseEvent) {
    const tag = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.categoryFor.set(entry);
    this.menuAt.set({ x: tag.left, y: tag.bottom });
    this.categoryMenu().openMenu();
  }

  protected setCategory(category: string | null) {
    const entry = this.categoryFor();
    if (entry) this.appData.updateEntry(this.day().date, entry.id, { category });
  }

  /** What the row at the foot of the day is open for, if anything. */
  protected readonly adding = signal<'entry' | 'break' | null>(null);
  protected readonly addError = signal<string | null>(null);
  protected readonly addBusy = signal(false);
  /** What the new line's editor starts from: a draft, or nothing yet. */
  protected readonly newFrom = signal<EntryText>(BLANK);
  protected readonly newEnterAt = signal<EnterAt>('text');

  /** Open the row for writing an entry, where the last one was left. */
  protected writeEntry(enterAt: EnterAt = 'text') {
    this.newFrom.set(this.newDraft() ?? BLANK);
    this.newEnterAt.set(enterAt);
    this.adding.set('entry');
  }

  protected async add(typed: EntryText) {
    this.addBusy.set(true);
    try {
      await this.appData.addTyped(this.day().date, typed);
      this.drafts.drop(this.newDraftKey());
      this.addError.set(null);
      // Straight on to the next line: a day is usually typed in one go.
      this.newFrom.set({ ...BLANK });
    } catch (error) {
      this.addError.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.addBusy.set(false);
    }
  }

  /** A new line left half-typed in this day, if any. */
  private readonly newDraftKey = computed(() => `new-${this.day().date}`);
  protected readonly newDraft = computed(() => this.drafts.get<EntryText>(this.newDraftKey()));

  private keepNewDraft(typed: EntryText) {
    if (typed.text || typed.note) this.drafts.keep(this.newDraftKey(), typed);
    else this.drafts.drop(this.newDraftKey());
  }

  /** Ctrl+B: the line typed so far waits as a draft while the break is made. */
  protected switchToBreak(typed: EntryText) {
    this.keepNewDraft(typed);
    this.adding.set('break');
  }

  /** A new break left half-made in this day, if any. */
  private readonly newBreakKey = computed(() => `new-break-${this.day().date}`);
  protected readonly newBreakDraft = computed(() =>
    this.drafts.get<BreakDraft>(this.newBreakKey()),
  );

  protected closeBreakEditor(changed: BreakDraft | null) {
    if (changed) this.drafts.keep(this.newBreakKey(), changed);
    this.adding.set(null);
  }

  /** Ctrl+B back to typing: the break made so far waits as a draft. */
  protected switchToEntry(changed: BreakDraft | null) {
    if (changed) this.drafts.keep(this.newBreakKey(), changed);
    this.writeEntry();
  }

  protected addBreak(draft: BreakDraft) {
    this.drafts.drop(this.newBreakKey());
    this.appData.addBreak(this.day().date, draft);
    // Back to entries, which is what follows a break far more often than another.
    this.writeEntry();
  }

  protected closeEditor(typed: EntryText) {
    // Already closed: a blur from the field going away, not from leaving it.
    if (this.adding() !== 'entry') return;
    this.keepNewDraft(typed);
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

  protected categoryOf(name: string | null): Category | null {
    return name ? (this.appData.categoriesByName().get(name) ?? null) : null;
  }

  /** A break says either when it ran or how long it was, never both. */
  protected describeBreak(pause: Break): string {
    if (pause.start && pause.end) return `${clock(pause.start)}–${clock(pause.end)}`;
    if (pause.start) return `from ${clock(pause.start)}`;
    return pause.minutes === null ? '' : formatMinutes(pause.minutes);
  }
}

/** Whether an event came from inside one of the editors an option can hold. */
function insideEditor(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('app-entry-editor, app-inline-entry-editor, app-break-editor') !== null
  );
}
