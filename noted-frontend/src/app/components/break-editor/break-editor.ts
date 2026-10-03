import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

import { firstValueFrom } from 'rxjs';

import { ConfirmDiscard } from 'app/components/confirm-discard/confirm-discard';
import { Break, BreakDraft } from 'app/services/api';
import { clock, formatMinutes } from 'app/services/time';

/** Breaks are counted in quarter hours, so that is what one click moves by. */
const STEP = 15;

/**
 * A break, said one of the two ways a break can be: how long it was, or when
 * it started and ended. Ctrl+Enter keeps it, Esc asks before losing a change,
 * and Ctrl+B goes back to typing an entry.
 */
@Component({
  selector: 'app-break-editor',
  imports: [MatIconModule],
  templateUrl: './break-editor.html',
})
export class BreakEditor {
  /** The break being edited, or nothing for a new one. */
  readonly initial = input<Break | null>(null);

  readonly submitted = output<BreakDraft>();
  readonly cancelled = output<void>();
  readonly switchToEntry = output<void>();

  protected readonly mode = linkedSignal<'duration' | 'range'>(() =>
    this.initial()?.start ? 'range' : 'duration',
  );
  protected readonly minutes = linkedSignal(() => this.initial()?.minutes ?? STEP);
  protected readonly start = linkedSignal(() => {
    const start = this.initial()?.start;
    return start ? clock(start) : now(0);
  });
  protected readonly end = linkedSignal(() => {
    const end = this.initial()?.end;
    return end ? clock(end) : now(STEP);
  });
  protected readonly isNoon = linkedSignal(() => this.initial()?.is_noon ?? false);
  protected readonly description = linkedSignal(() => this.initial()?.description ?? '');
  protected readonly error = signal<string | null>(null);

  protected readonly length = computed(() => formatMinutes(this.minutes()));

  /** What the editor opened on, to tell a change from a look. */
  private readonly openedOn = computed(() => {
    this.initial();
    return untracked(() => JSON.stringify(this.draft()));
  });

  private readonly dialog = inject(MatDialog);
  private readonly first = viewChild<ElementRef<HTMLElement>>('first');

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => {
      this.first()?.nativeElement.focus();
      // Focus only brings the first field into view; the rest of the editor should come too.
      host.scrollIntoView?.({ block: 'nearest' });
    });
  }

  protected step(by: number) {
    this.minutes.update(minutes => Math.max(STEP, minutes + by));
  }

  protected onKeydown(event: KeyboardEvent) {
    const ctrl = event.ctrlKey || event.metaKey;
    if (event.key === 'Enter' && ctrl) {
      event.preventDefault();
      this.submit();
    } else if (event.key.toLowerCase() === 'b' && ctrl) {
      event.preventDefault();
      this.switchToEntry.emit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      void this.cancel();
    }
  }

  protected setMinutes(value: string) {
    const minutes = Number.parseInt(value, 10);
    if (Number.isFinite(minutes) && minutes > 0) this.minutes.set(minutes);
  }

  private draft(): BreakDraft {
    const range = this.mode() === 'range';
    return {
      kind: 'break',
      is_noon: this.isNoon(),
      description: this.description().trim() || null,
      start: range ? `${this.start()}:00` : null,
      end: range ? `${this.end()}:00` : null,
      minutes: range ? null : this.minutes(),
    };
  }

  private submit() {
    if (this.mode() === 'range' && this.end() <= this.start()) {
      this.error.set('This break ends before it starts.');
      return;
    }
    this.error.set(null);
    this.submitted.emit(this.draft());
  }

  private async cancel() {
    if (JSON.stringify(this.draft()) === this.openedOn()) {
      this.cancelled.emit();
      return;
    }
    const discard = await firstValueFrom(this.dialog.open(ConfirmDiscard).afterClosed());
    if (discard) this.cancelled.emit();
    else this.first()?.nativeElement.focus();
  }
}

/** The time now, plus some minutes, as `HH:mm`. */
function now(plus: number): string {
  const at = new Date(Date.now() + plus * 60_000);
  return `${`${at.getHours()}`.padStart(2, '0')}:${`${at.getMinutes()}`.padStart(2, '0')}`;
}
