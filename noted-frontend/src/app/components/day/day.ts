import { DatePipe, SlicePipe, UpperCasePipe } from '@angular/common';
import { Component, inject, input } from '@angular/core';

import { Break, Day as DayData } from 'app/services/api';
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

  /** A break says either when it ran or how long it was, never both. */
  protected describeBreak(pause: Break): string {
    if (pause.start && pause.end) return `${clock(pause.start)}–${clock(pause.end)}`;
    if (pause.start) return `from ${clock(pause.start)}`;
    return pause.minutes === null ? '' : formatMinutes(pause.minutes);
  }
}

function clock(time: string): string {
  return time.slice(0, 5);
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h${`${rest}`.padStart(2, '0')}` : `${hours}h`;
}
