import { Component, inject } from '@angular/core';

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
}
