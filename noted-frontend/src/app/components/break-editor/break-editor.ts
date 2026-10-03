import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

import { MatIconModule } from '@angular/material/icon';

import { BreakDraft } from 'app/services/api';
import { clock, formatMinutes } from 'app/services/time';

/** Breaks are counted in quarter hours, so that is what one click moves by. */
const STEP = 15;

/**
 * A break, said one of the two ways a break can be: how long it was, or when
 * it started and ended. Enter keeps it, and Ctrl+B goes back to typing an
 * entry. Esc, or focus going anywhere else, closes it without asking and hands
 * back any change, for the day to keep as a draft.
 */
@Component({
  selector: 'app-break-editor',
  imports: [MatIconModule],
  templateUrl: './break-editor.html',
  host: { '(focusout)': 'onFocusOut($event)' },
})
export class BreakEditor {
  /** What the editor opens on: the break being edited, a draft left earlier, or nothing. */
  readonly initial = input<BreakDraft | null>(null);
  /** Whether Ctrl+B may turn it back into an entry: only a new break can. */
  readonly canSwitch = input(false);

  readonly submitted = output<BreakDraft>();
  /**
   * Closed unsaved, by Esc or by focus going elsewhere: what was made of the
   * break, for the day to keep as a draft, or null if nothing was changed.
   */
  readonly closed = output<BreakDraft | null>();
  readonly switchToEntry = output<BreakDraft | null>();

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

  /**
   * What the editor opened on, to tell a change from a look. Taken as it opens,
   * by an effect, since a computed would only be worked out when first read —
   * after the change it is meant to be compared with.
   */
  private openedOn = '';

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly first = viewChild<ElementRef<HTMLElement>>('first');

  constructor() {
    effect(() => {
      this.initial();
      this.openedOn = untracked(() => JSON.stringify(this.draft()));
    });
    afterNextRender(() => {
      this.first()?.nativeElement.focus();
      // Focus only brings the first field into view; the rest of the editor should come too.
      this.host.scrollIntoView?.({ block: 'nearest' });
    });
  }

  protected step(by: number) {
    this.minutes.update(minutes => Math.max(STEP, minutes + by));
  }

  protected onKeydown(event: KeyboardEvent) {
    const ctrl = event.ctrlKey || event.metaKey;
    if (event.key === 'Enter') {
      event.preventDefault();
      this.submit();
    } else if (event.key.toLowerCase() === 'b' && ctrl) {
      if (!this.canSwitch()) return;
      event.preventDefault();
      this.switchToEntry.emit(this.changes());
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.closed.emit(this.changes());
    }
  }

  /** Focus leaving for anything outside the editor is the same as Esc. */
  protected onFocusOut(event: FocusEvent) {
    const next = event.relatedTarget;
    if (next instanceof Node && this.host.contains(next)) return;
    this.closed.emit(this.changes());
  }

  /** The break as edited, or null if it is still what the editor opened on. */
  private changes(): BreakDraft | null {
    const draft = this.draft();
    return JSON.stringify(draft) === this.openedOn ? null : draft;
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
}

/** The time now, plus some minutes, as `HH:mm`. */
function now(plus: number): string {
  const at = new Date(Date.now() + plus * 60_000);
  return `${`${at.getHours()}`.padStart(2, '0')}:${`${at.getMinutes()}`.padStart(2, '0')}`;
}
