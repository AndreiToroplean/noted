import { Component, computed, effect, input } from '@angular/core';

import { Day } from 'app/components/day/day';

@Component({
  selector: 'app-week',
  imports: [Day],
  templateUrl: './week.html',
})
export class Week {
  readonly week = input.required<Date>();

  protected readonly weekDates = computed<Date[]>(() => {
    const startDate = this.week();
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + i);
      return date;
    });
  });

  constructor() {
    effect(() => {
      // Validate that the date is a Monday
      const dayOfWeek = this.week().getDay();
      if (dayOfWeek !== 1) console.warn(`The provided date ${this.week()} is not a Monday.`);
    });
  }
}
