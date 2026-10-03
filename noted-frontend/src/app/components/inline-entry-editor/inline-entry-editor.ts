import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  input,
  linkedSignal,
  output,
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
 * Ctrl+Enter saves. Esc, or focus going anywhere else, closes without asking
 * and hands back what was typed, for the day to keep as a draft.
 */
@Component({
  selector: 'app-inline-entry-editor',
  templateUrl: './inline-entry-editor.html',
  host: { '(focusout)': 'onFocusOut($event)' },
})
export class InlineEntryEditor {
  readonly value = input.required<EntryText>();

  readonly saved = output<EntryText>();
  readonly closed = output<EntryText>();

  protected readonly text = linkedSignal(() => this.value().text);
  protected readonly note = linkedSignal(() => this.value().note);

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
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
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

  private current(): EntryText {
    const note = this.note()?.trim();
    return { text: this.text().trim(), note: note ? note : null };
  }
}
