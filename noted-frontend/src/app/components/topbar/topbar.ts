import { Component, inject } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';

import { AppData } from 'app/services/app-data';

@Component({
  selector: 'app-topbar',
  imports: [MatIconModule],
  templateUrl: './topbar.html',
})
export class Topbar {
  protected readonly appData = inject(AppData);
}
