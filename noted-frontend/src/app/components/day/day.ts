import { DatePipe, NgTemplateOutlet, UpperCasePipe } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';

import { CdkDrag, CdkDragDrop, CdkDragPlaceholder, CdkDropList } from '@angular/cdk/drag-drop';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';

import { BreakEditor } from 'app/components/break-editor/break-editor';
import { EntryEditor } from 'app/components/entry-editor/entry-editor';
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
import { Selection } from 'app/services/selection';
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
    MatIconModule,
    MatTooltipModule,
    CdkDropList,
    CdkDrag,
    CdkDragPlaceholder,
  ],
  templateUrl: './day.html',
})
export class Day {
  readonly day = input.required<DayData>();

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
    this.pressed.set({ key, count: rows.length });
  }

  /** The item last pressed, and how many it would carry: the preview shows the count. */
  protected readonly pressed = signal<{ key: string; count: number } | null>(null);

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
    return this.selection.carriedBy(this.day().date, pressed.key).has(key);
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
    if (isBreak(item)) this.editingBreakId.set(item.id);
    else this.editingId.set(item.id);
  }

  /** An item open in an editor stays put: dragging would take the text field with it. */
  protected isEditing(item: DayItem): boolean {
    return isBreak(item) ? this.editingBreakId() === item.id : this.editingId() === item.id;
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

  /** Whether the day is over: what turns its unfinished work into failed work. */
  private readonly past = computed(() => this.day().date < isoDate(new Date()));

  /** Specification §8: past, not done, and with something written. Red beats every other colour. */
  protected isFailedItem(item: DayItem): boolean {
    return this.past() && item.kind === 'task' && !item.done && item.text.trim() !== '';
  }

  protected toggleDone(entry: Entry) {
    this.appData.updateEntry(this.day().date, entry.id, { done: !entry.done });
  }

  /** The selected tasks: what the context menu's Category acts on. */
  private readonly selectedTasks = computed(() =>
    this.day().items.filter(
      (item): item is Entry =>
        item.kind === 'task' && this.selection.has(this.day().date, itemKey(item)),
    ),
  );
  protected readonly selectionHasTasks = computed(() => this.selectedTasks().length > 0);

  /** The category the selected tasks share, to tick in the menu; undefined if they differ. */
  protected readonly selectedCategory = computed(() => {
    const categories = new Set(this.selectedTasks().map(entry => entry.category));
    return categories.size === 1 ? [...categories][0] : undefined;
  });

  /** One edit for the lot, so one Ctrl+Z puts every one back. */
  protected setCategoryOfSelected(category: string | null) {
    const keys = new Set(this.selectedTasks().map(itemKey));
    this.appData.updateEntries(this.day().date, keys, { category });
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
  return target instanceof Element && target.closest('app-entry-editor, app-break-editor') !== null;
}
