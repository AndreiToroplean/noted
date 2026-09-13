import { Component, inject } from '@angular/core';

import { AppData } from 'app/services/app-data';

@Component({
  selector: 'app-topbar',
  imports: [],
  templateUrl: './topbar.html',
})
export class Topbar {
  protected readonly appData = inject(AppData);
}
