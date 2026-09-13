import { DatePipe, SlicePipe, UpperCasePipe } from '@angular/common';
import { Component, inject, input } from '@angular/core';

import { Day as DayData } from 'app/services/api';
import { AppData } from 'app/services/app-data';

@Component({
  selector: 'app-day',
  imports: [UpperCasePipe, DatePipe, SlicePipe],
  templateUrl: './day.html',
})
export class Day {
  readonly day = input.required<DayData>();

  private readonly appData = inject(AppData);

  protected colourOf(category: string | null): string | null {
    return category ? (this.appData.categoriesByName().get(category)?.colour ?? null) : null;
  }
}
