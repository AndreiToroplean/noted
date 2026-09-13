import { DatePipe, UpperCasePipe } from '@angular/common';
import { Component, input } from '@angular/core';

@Component({
  selector: 'app-day',
  imports: [UpperCasePipe, DatePipe],
  templateUrl: './day.html',
})
export class Day {
  readonly date = input.required<Date>();
}
