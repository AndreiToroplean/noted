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

/**
 * A new line being typed into a day, in the spreadsheet's syntax. The first
 * line is the entry and anything under it the note, so Enter is a new line and
 * Ctrl+Enter is what finishes.
 *
 * Esc, or focus going anywhere else, closes it without asking and hands back
 * what was typed, for the day to keep as a draft.
 */
@Component({
  selector: 'app-entry-editor',
  templateUrl: './entry-editor.html',
  host: { '(focusout)': 'onFocusOut($event)' },
})
export class EntryEditor {
  /** What the field opens on: a draft left earlier, or nothing. */
  readonly initial = input('');
  /** Why the last attempt was refused, shown under the field. */
  readonly error = input<string | null>(null);
  readonly busy = input(false);

  readonly submitted = output<string>();
  readonly closed = output<string>();
  /** Ctrl+B: the user means a break, which is not typed. */
  readonly switchToBreak = output<string>();

  protected readonly text = linkedSignal(() => this.initial());

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly field = viewChild.required<ElementRef<HTMLTextAreaElement>>('field');

  constructor() {
    afterNextRender(() => {
      const field = this.field().nativeElement;
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
      // Focus only brings the field into view; the hint under it should come too.
      this.host.querySelector('.editor-hint')?.scrollIntoView?.({ block: 'nearest' });
    });
  }

  /** Empty again and ready for the next line. */
  reset() {
    this.text.set('');
    this.field().nativeElement.value = '';
    this.field().nativeElement.focus();
  }

  protected onKeydown(event: KeyboardEvent) {
    const ctrl = event.ctrlKey || event.metaKey;
    if (event.key === 'Enter' && ctrl) {
      event.preventDefault();
      this.submit();
    } else if (event.key.toLowerCase() === 'b' && ctrl) {
      event.preventDefault();
      this.switchToBreak.emit(this.text());
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.closed.emit(this.text());
    }
  }

  /** Focus leaving for anything outside the editor is the same as Esc. */
  protected onFocusOut(event: FocusEvent) {
    const next = event.relatedTarget;
    if (next instanceof Node && this.host.contains(next)) return;
    this.closed.emit(this.text());
  }

  private submit() {
    if (this.busy()) return;
    if (!this.text().trim()) {
      this.closed.emit('');
      return;
    }
    this.submitted.emit(this.text());
  }
}
