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

  protected readonly selectedIndex = computed(() =>
    this.appData.weeks.value().indexOf(this.appData.selectedWeek() ?? ''),
  );

  protected selectWeek(index: number) {
    const week = this.appData.weeks.value()[index];
    if (week) this.appData.selectedWeek.set(week);
  }
}
