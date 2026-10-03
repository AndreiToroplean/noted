import { DatePipe } from '@angular/common';
import { Component, effect, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';

import { Footer } from 'app/components/footer/footer';
import { Topbar } from 'app/components/topbar/topbar';
import { Week } from 'app/components/week/week';
import { AppData } from 'app/services/app-data';

@Component({
  selector: 'app-root',
  imports: [Week, Topbar, Footer],
  templateUrl: './app.html',
  styleUrl: './app.css',
  host: { class: 'contents' },
})
export class App {
  protected appData = inject(AppData);

  private readonly title = inject(Title);
  private readonly dates = new DatePipe('en-US');

  constructor() {
    // Named after the week being edited, so a bookmark or a row of tabs says
    // which week each one is.
    effect(() => {
      const week = this.appData.selectedWeek();
      this.title.setTitle(
        week ? `Noted – week of ${this.dates.transform(week, 'd MMM y')}` : 'Noted',
      );
    });
  }
}
