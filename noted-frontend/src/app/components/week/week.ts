import { Component, computed, inject, input } from '@angular/core';

import { CdkDropListGroup } from '@angular/cdk/drag-drop';

import { Day } from 'app/components/day/day';
import { Day as DayData, IsoDate, Week as WeekData, hasContent } from 'app/services/api';
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
   * apologies.
   */
  protected readonly visibleDays = computed<DayData[]>(() =>
    this.week().days.filter(
      (day, index) => index < 5 || hasContent(day) || this.appData.weekendShown(),
    ),
  );

  /** The date of the shown day at an index, coming round past either end. */
  protected dateAt(index: number): IsoDate {
    const days = this.visibleDays();
    return days[(index + days.length) % days.length].date;
  }
}
