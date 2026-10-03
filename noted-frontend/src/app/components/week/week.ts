import { Component, computed, input } from '@angular/core';

import { CdkDropListGroup } from '@angular/cdk/drag-drop';

import { Day } from 'app/components/day/day';
import { Day as DayData, IsoDate, Week as WeekData } from 'app/services/api';

@Component({
  selector: 'app-week',
  imports: [Day, CdkDropListGroup],
  templateUrl: './week.html',
})
export class Week {
  readonly week = input.required<WeekData>();

  /**
   * The weekend shows only when it holds something, so an ordinary week is five
   * columns rather than five and two apologies.
   */
  protected readonly visibleDays = computed<DayData[]>(() =>
    this.week().days.filter((day, index) => index < 5 || hasContent(day)),
  );

  /** The date of the shown day at an index, or null past either end. */
  protected dateAt(index: number): IsoDate | null {
    return index >= 0 ? (this.visibleDays()[index]?.date ?? null) : null;
  }
}

function hasContent(day: DayData): boolean {
  return day.items.length > 0;
}
