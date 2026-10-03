import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';

import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

import { Autofocus } from 'app/directives/autofocus';
import { IsoDate, addWeeks } from 'app/services/api';

export interface PickWeekData {
  /** The week the picker opens on. */
  start: IsoDate;
  /** Weeks already in the journal, so picking one can say it will be opened, not made. */
  existing: IsoDate[];
}

/**
 * Choose a week by its Monday, a week at a time. Arrow keys step, Enter takes
 * it, so a week or two away is a couple of keystrokes rather than a calendar.
 * Closes with the chosen Monday.
 */
@Component({
  selector: 'app-pick-week',
  imports: [DatePipe, MatButtonModule, MatDialogModule, MatIconModule, Autofocus],
  templateUrl: './pick-week.html',
})
export class PickWeek {
  private readonly data = inject<PickWeekData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<PickWeek, IsoDate>>(MatDialogRef);

  protected readonly week = signal(this.data.start);
  protected readonly exists = computed(() => this.data.existing.includes(this.week()));

  protected step(by: number) {
    this.week.update(week => addWeeks(week, by));
  }

  protected take() {
    this.ref.close(this.week());
  }

  protected onKeydown(event: KeyboardEvent) {
    const steps: Record<string, number> = {
      ArrowLeft: -1,
      ArrowDown: -1,
      ArrowRight: 1,
      ArrowUp: 1,
    };
    if (event.key in steps) {
      event.preventDefault();
      this.step(steps[event.key]);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.take();
    }
  }
}
