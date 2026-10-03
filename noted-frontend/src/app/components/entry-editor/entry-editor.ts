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

import { MatDialog } from '@angular/material/dialog';

import { firstValueFrom } from 'rxjs';

import { ConfirmDiscard } from 'app/components/confirm-discard/confirm-discard';

/**
 * A line being typed into a day, in the spreadsheet's syntax. The first line
 * is the entry and anything under it the note, so Enter is a new line and
 * Ctrl+Enter is what finishes.
 */
@Component({
  selector: 'app-entry-editor',
  templateUrl: './entry-editor.html',
})
export class EntryEditor {
  /** What the field opens on: empty for a new line, the entry's own text when editing one. */
  readonly initial = input('');
  /** Why the last attempt was refused, shown under the field. */
  readonly error = input<string | null>(null);
  readonly busy = input(false);

  readonly submitted = output<string>();
  readonly cancelled = output<void>();

  protected readonly text = linkedSignal(() => this.initial());

  private readonly dialog = inject(MatDialog);
  private readonly field = viewChild.required<ElementRef<HTMLTextAreaElement>>('field');

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => {
      this.focus();
      // Focus only brings the field into view; the hint under it should come too.
      host.scrollIntoView?.({ block: 'nearest' });
    });
  }

  /** Empty again and ready for the next line. */
  reset() {
    this.text.set('');
    this.field().nativeElement.value = '';
    this.focus();
  }

  protected onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.submit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      void this.cancel();
    }
  }

  private submit() {
    if (this.busy()) return;
    if (!this.text().trim()) {
      this.cancelled.emit();
      return;
    }
    this.submitted.emit(this.text());
  }

  private async cancel() {
    if (this.text().trim() === this.initial().trim()) {
      this.cancelled.emit();
      return;
    }
    const discard = await firstValueFrom(this.dialog.open(ConfirmDiscard).afterClosed());
    if (discard) this.cancelled.emit();
    else this.focus();
  }

  private focus() {
    this.field().nativeElement.focus();
  }
}
