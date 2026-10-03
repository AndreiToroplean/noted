import { Component, computed, inject, input } from '@angular/core';

import { CdkDropListGroup } from '@angular/cdk/drag-drop';

import { Day } from 'app/components/day/day';
import { Day as DayData, IsoDate, Week as WeekData, weekendInUse } from 'app/services/api';
import { AppData } from 'app/services/app-data';

@Component({
  selector: 'app-week',
  imports: [Day, CdkDropListGroup],
  templateUrl: './week.html',
})
export class Week {
  readonly week = input.required<WeekData>();

  private readonly appData = inject(AppData);

  /**
   * The weekend shows only when it holds something, or when asked for from the
   * week's menu, so an ordinary week is five columns rather than five and two
   * apologies. It shows whole or not at all.
   */
  protected readonly visibleDays = computed<DayData[]>(() => {
    const weekend = weekendInUse(this.week()) || this.appData.weekendShown();
    return this.week().days.slice(0, weekend ? 7 : 5);
  });

  /** The date of the shown day at an index, coming round past either end. */
  protected dateAt(index: number): IsoDate {
    const days = this.visibleDays();
    return days[(index + days.length) % days.length].date;
  }
}
