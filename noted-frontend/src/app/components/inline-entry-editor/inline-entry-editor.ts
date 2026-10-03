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

/** What an entry says: its line and its note. */
export interface EntryText {
  text: string;
  note: string | null;
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

  readonly saved = output<EntryText>();
  readonly closed = output<EntryText>();
  /** Ctrl+B, while adding: make a break instead, with what was typed kept. */
  readonly switchToBreak = output<EntryText>();

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
      const field = this.textField().nativeElement;
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
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

  protected onKeydown(event: KeyboardEvent) {
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
