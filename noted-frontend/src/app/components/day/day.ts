import { DatePipe, UpperCasePipe } from '@angular/common';
import { Component, input } from '@angular/core';
import { TableModule } from 'primeng/table';

@Component({
  selector: 'app-day',
  imports: [UpperCasePipe, DatePipe, TableModule],
  templateUrl: './day.html',
})
export class Day {
  readonly date = input.required<Date>();
}
