import { Component, inject } from '@angular/core';

import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

import { PickWeek, PickWeekData } from 'app/components/pick-week/pick-week';
import { IsoDate, addWeeks, mondayOf } from 'app/services/api';
import { AppData } from 'app/services/app-data';

/**
 * Starting a week. Rarely needed — the current week is always there — so it is
 * one button that asks which, opening on next week so that is just a click and
 * Enter.
 */
@Component({
  selector: 'app-new-week',
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './new-week.html',
})
export class NewWeek {
  private readonly appData = inject(AppData);
  private readonly dialog = inject(MatDialog);

  protected start() {
    const data: PickWeekData = {
      start: addWeeks(mondayOf(new Date()), 1),
      existing: this.appData.weekList(),
    };
    this.dialog
      .open<PickWeek, PickWeekData, IsoDate>(PickWeek, { data })
      .afterClosed()
      .subscribe(week => {
        if (week) this.appData.openWeek(week);
      });
  }
}
