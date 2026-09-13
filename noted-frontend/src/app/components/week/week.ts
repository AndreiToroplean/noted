import { Component, computed, input } from '@angular/core';

import { Day } from 'app/components/day/day';
import { Day as DayData, Week as WeekData } from 'app/services/api';

@Component({
  selector: 'app-week',
  imports: [Day],
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
}

function hasContent(day: DayData): boolean {
  return day.entries.length > 0 || day.breaks.length > 0;
}
