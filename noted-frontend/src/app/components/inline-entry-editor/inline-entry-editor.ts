import {
  Component,
  ElementRef,
  afterNextRender,
  inject,
  input,
  linkedSignal,
  output,
  viewChild,
} from '@angular/core';

import { caretLines } from 'app/components/inline-entry-editor/caret';

/** What an entry says: its line and its note. */
export interface EntryText {
  text: string;
  note: string | null;
}

/** Where the keyboard is taking the editing, and what was typed before it left. */
export interface EditorMove {
  to: 'up' | 'down' | 'next-day' | 'previous-day';
  typed: EntryText;
}

/**
 * An entry, edited where it is drawn, as one piece of text: its first line is
 * the entry and any lines under it the note, as when it was first typed. The
 * field takes the entry's type and grows with what is in it, so nothing moves
 * when editing starts.
 *
 * Enter saves; Ctrl+Enter is a new line. What is saved is read as a new line
 * would be, so syntax typed here — a category, a project, a break — applies to
 * the entry. Esc, or focus going anywhere else, closes without asking and
 * hands back what was typed, for the day to keep as a draft.
 *
 * The row at the foot of a day writes new entries with it too: there Ctrl+B
 * turns to making a break instead.
 *
 * Opened on such a draft, it knows the entry as saved too: Ctrl+Z, once the
 * field is back to the draft, goes back to the saved entry, and Ctrl+Y brings
 * the draft back. Before and after that, undo is the field's own.
 */
@Component({
  selector: 'app-inline-entry-editor',
  templateUrl: './inline-entry-editor.html',
  host: { '(focusout)': 'onFocusOut($event)' },
})
export class InlineEntryEditor {
  readonly value = input.required<EntryText>();
  /** The entry as saved, when `value` is a draft of it. */
  readonly original = input<EntryText | null>(null);
  /** Why the last save was refused, shown in place of the hint. */
  readonly error = input<string | null>(null);
  /** A save on its way: the field holds still until it lands. */
  readonly busy = input(false);
  /** Writing a new entry rather than editing one. */
  readonly adding = input(false);
  /**
   * Where the caret starts: at the end of the first line, as a double-click
   * leaves it; at the very start, coming down from above; or at the very end,
   * coming up from below.
   */
  readonly enterAt = input<'text' | 'start' | 'end'>('text');

  readonly saved = output<EntryText>();
  readonly closed = output<EntryText>();
  /** Ctrl+B, while adding: make a break instead, with what was typed kept. */
  readonly switchToBreak = output<EntryText>();
  /** The keyboard leaving for another entry, with what was typed here. */
  readonly moved = output<EditorMove>();

  protected readonly content = linkedSignal(() => joined(this.value()));

  /** Whether Ctrl+Z has just gone from the draft back to the entry as saved. */
  private reverted = false;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly field = viewChild.required<ElementRef<HTMLTextAreaElement>>('field');

  constructor() {
    afterNextRender(() => {
      const field = this.field().nativeElement;
      const enterAt = this.enterAt();
      const firstLine = field.value.split('\n')[0].length;
      this.place(enterAt === 'start' ? 0 : enterAt === 'end' ? field.value.length : firstLine);
    });
  }

  /**
   * Up and Down move the caret as in any field, and past its first or last
   * line go on to the entry above or below. Tab and Shift+Tab go to the next
   * day and the one before.
   */
  private moveOn(event: KeyboardEvent): boolean {
    if (this.busy() || event.ctrlKey || event.metaKey || event.altKey) return false;
    const field = this.field().nativeElement;
    let to: EditorMove['to'] | null = null;
    if (event.key === 'Tab') to = event.shiftKey ? 'previous-day' : 'next-day';
    else if (event.shiftKey) return false;
    else if (event.key === 'ArrowUp' && caretLines(field).first) to = 'up';
    else if (event.key === 'ArrowDown' && caretLines(field).last) to = 'down';
    if (!to) return false;
    event.preventDefault();
    this.moved.emit({ to, typed: this.current() });
    return true;
  }

  private place(position: number) {
    const field = this.field().nativeElement;
    field.focus();
    field.setSelectionRange(position, position);
  }

  protected onKeydown(event: KeyboardEvent) {
    if (this.moveOn(event)) return;
    const ctrl = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const undo = ctrl && key === 'z' && !event.shiftKey;
    const redo = ctrl && (key === 'y' || (key === 'z' && event.shiftKey));
    const original = this.original();
    if (undo && original && this.content() === joined(this.value())) {
      event.preventDefault();
      this.content.set(joined(original));
      this.reverted = true;
    } else if (redo && this.reverted) {
      event.preventDefault();
      this.content.set(joined(this.value()));
      this.reverted = false;
    } else if (this.adding() && ctrl && key === 'b') {
      event.preventDefault();
      this.switchToBreak.emit(this.current());
    } else if (event.key === 'Enter' && ctrl) {
      // A textarea makes no new line with Ctrl held; typed this way, it undoes.
      event.preventDefault();
      document.execCommand('insertText', false, '\n');
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.saved.emit(this.current());
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.closed.emit(this.current());
    }
  }

  /** Focus leaving for anything outside the editor is the same as Esc. */
  protected onFocusOut(event: FocusEvent) {
    const next = event.relatedTarget;
    if (next instanceof Node && this.host.contains(next)) return;
    this.closed.emit(this.current());
  }

  /** Typing anything starts the field's own undo afresh. */
  protected onInput(value: string) {
    this.content.set(value);
    this.reverted = false;
  }

  /** The first line is the entry, and whatever is under it the note. */
  private current(): EntryText {
    const [text, ...rest] = this.content().split('\n');
    const note = rest.join('\n').trim();
    return { text: text.trim(), note: note ? note : null };
  }
}

/** An entry as one piece of text, the note on the lines under it. */
function joined(value: EntryText): string {
  return value.note === null ? value.text : `${value.text}\n${value.note}`;
}
