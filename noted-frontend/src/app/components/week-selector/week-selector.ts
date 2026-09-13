import { DatePipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';

import { MatTabsModule } from '@angular/material/tabs';

import { AppData } from 'app/services/app-data';

@Component({
  selector: 'app-week-selector',
  imports: [DatePipe, MatTabsModule],
  templateUrl: './week-selector.html',
})
export class WeekSelector {
  protected readonly appData = inject(AppData);

  protected readonly selectedIndex = computed(() => {
    const selected = this.appData.selectedWeek()?.getTime();
    return this.appData.weeks().findIndex(week => week.getTime() === selected);
  });

  protected selectWeek(index: number) {
    const week = this.appData.weeks()[index];
    if (week) this.appData.selectedWeek.set(week);
  }
}
