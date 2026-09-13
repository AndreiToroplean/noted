import { DatePipe, SlicePipe, UpperCasePipe } from '@angular/common';
import { Component, input } from '@angular/core';

import { Day as DayData } from 'app/services/api';

@Component({
  selector: 'app-day',
  imports: [UpperCasePipe, DatePipe, SlicePipe],
  templateUrl: './day.html',
})
export class Day {
  readonly day = input.required<DayData>();
}
