import { DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';

import { Tab, TabList, Tabs } from 'primeng/tabs';

import { AppData } from 'app/services/app-data';

@Component({
  selector: 'app-week-selector',
  imports: [DatePipe, Tabs, TabList, Tab],
  templateUrl: './week-selector.html',
})
export class WeekSelector {
  protected appData = inject(AppData);

  protected setSelectedWeek(week: unknown) {
    this.appData.selectedWeek.set(new Date(week as string));
  }
}
