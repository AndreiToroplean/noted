import { Component } from '@angular/core';

import { WeekSelector } from 'app/components/week-selector/week-selector';

@Component({
  selector: 'app-footer',
  imports: [WeekSelector],
  templateUrl: './footer.html',
})
export class Footer {}
