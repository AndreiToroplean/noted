import { Component } from '@angular/core';

import { NewWeek } from 'app/components/new-week/new-week';
import { WeekSelector } from 'app/components/week-selector/week-selector';

@Component({
  selector: 'app-footer',
  imports: [NewWeek, WeekSelector],
  templateUrl: './footer.html',
})
export class Footer {}
