import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  untracked,
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
 * An entry's text and note, edited where they are drawn. The two fields take
 * the exact type, spacing and dimming the entry is displayed with, and grow
 * with what is in them, so nothing moves when editing starts.
 *
 * Enter goes from the text down to the note, which is the entry's second line;
 * Ctrl+Enter saves. What is saved is read as a new line would be, so syntax
 * typed here — a category, a project, a break — applies to the entry. Esc, or
 * focus going anywhere else, closes without asking and hands back what was
 * typed, for the day to keep as a draft.
 *
 * The row at the foot of a day writes new entries with it too: there Ctrl+B
 * turns to making a break instead, and a new `value` after each line is added
 * starts the next one.
 *
 * Opened on such a draft, it knows the entry as saved too: Ctrl+Z, once the
 * fields are back to the draft, goes back to the saved entry, and Ctrl+Y brings
 * the draft back. Before and after that, undo is the fields' own.
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
  /** A save on its way: the fields hold still until it lands. */
  readonly busy = input(false);
  /** Writing a new entry rather than editing one. */
  readonly adding = input(false);
  /**
   * Where the caret starts: at the end of the text, as a double-click leaves
   * it; at the very start, coming down from above; or at the very end, note
   * and all, coming up from below.
   */
  readonly enterAt = input<'text' | 'start' | 'end'>('text');

  readonly saved = output<EntryText>();
  readonly closed = output<EntryText>();
  /** Ctrl+B, while adding: make a break instead, with what was typed kept. */
  readonly switchToBreak = output<EntryText>();
  /** The keyboard leaving for another entry, with what was typed here. */
  readonly moved = output<EditorMove>();

  protected readonly text = linkedSignal(() => this.value().text);
  protected readonly note = linkedSignal(() => this.value().note);

  /** Whether Ctrl+Z has just gone from the draft back to the entry as saved. */
  private reverted = false;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  private readonly textField = viewChild.required<ElementRef<HTMLTextAreaElement>>('textField');
  private readonly noteField = viewChild<ElementRef<HTMLTextAreaElement>>('noteField');

  constructor() {
    afterNextRender(() => {
      const enterAt = this.enterAt();
      const note = this.noteField()?.nativeElement;
      if (enterAt === 'start') this.place(this.textField().nativeElement, 'start');
      else if (enterAt === 'end' && note) this.place(note, 'end');
      else this.place(this.textField().nativeElement, 'end');
    });
    // A fresh value starts over. Written into the fields straight away, as a
    // binding may not see a change from a value it never drew; and focus goes
    // to the text before a note field that is going away takes it along, which
    // would read as leaving.
    let opened = false;
    effect(() => {
      const value = this.value();
      if (opened) {
        untracked(() => {
          const text = this.textField().nativeElement;
          text.value = value.text;
          const note = this.noteField()?.nativeElement;
          if (note) note.value = value.note ?? '';
          text.focus();
        });
      }
      opened = true;
    });
  }

  protected onTextKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !(event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (this.note() === null) this.note.set('');
      // The note field may only now be appearing, so focus it once it is drawn.
      afterNextRender(() => this.noteField()?.nativeElement.focus(), { injector: this.injector });
      return;
    }
    this.onKeydown(event);
  }

  /**
   * Up and Down move the caret as in any field, and leave it only from its
   * first or last line: from the text down to the note, from the note up to the
   * text, and past either end to the entry above or below. Tab and Shift+Tab go
   * to the next day and the one before.
   */
  private moveOn(event: KeyboardEvent): boolean {
    if (this.busy() || event.ctrlKey || event.metaKey || event.altKey) return false;
    const field = event.target as HTMLTextAreaElement;
    const inNote = field === this.noteField()?.nativeElement;
    let to: EditorMove['to'] | null = null;
    if (event.key === 'Tab') {
      to = event.shiftKey ? 'previous-day' : 'next-day';
    } else if (event.shiftKey) {
      return false;
    } else if (event.key === 'ArrowUp' && caretLines(field).first) {
      if (inNote) {
        event.preventDefault();
        this.place(this.textField().nativeElement, 'end');
        return true;
      }
      to = 'up';
    } else if (event.key === 'ArrowDown' && caretLines(field).last) {
      const note = this.noteField()?.nativeElement;
      if (!inNote && note) {
        event.preventDefault();
        this.place(note, 'start');
        return true;
      }
      to = 'down';
    }
    if (!to) return false;
    event.preventDefault();
    this.moved.emit({ to, typed: this.current() });
    return true;
  }

  private place(field: HTMLTextAreaElement, at: 'start' | 'end') {
    field.focus();
    const position = at === 'start' ? 0 : field.value.length;
    field.setSelectionRange(position, position);
  }

  protected onKeydown(event: KeyboardEvent) {
    if (this.moveOn(event)) return;
    const ctrl = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const undo = ctrl && key === 'z' && !event.shiftKey;
    const redo = ctrl && (key === 'y' || (key === 'z' && event.shiftKey));
    const original = this.original();
    if (undo && original && this.shows(this.value())) {
      event.preventDefault();
      this.show(original);
      this.reverted = true;
    } else if (redo && this.reverted) {
      event.preventDefault();
      this.show(this.value());
      this.reverted = false;
    } else if (this.adding() && ctrl && key === 'b') {
      event.preventDefault();
      this.switchToBreak.emit(this.current());
    } else if (event.key === 'Enter' && ctrl) {
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

  /** Typing anything starts the fields' own undo afresh. */
  protected onInput(field: 'text' | 'note', value: string) {
    this[field].set(value);
    this.reverted = false;
  }

  private shows(value: EntryText): boolean {
    return this.text() === value.text && this.note() === value.note;
  }

  private show(value: EntryText) {
    const inNote = document.activeElement === this.noteField()?.nativeElement;
    this.text.set(value.text);
    this.note.set(value.note);
    // A note that is gone takes the focus with it, so give it back to the text.
    if (inNote && value.note === null) {
      afterNextRender(() => this.textField().nativeElement.focus(), { injector: this.injector });
    }
  }

  private current(): EntryText {
    const note = this.note()?.trim();
    return { text: this.text().trim(), note: note ? note : null };
  }
}
