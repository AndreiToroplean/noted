import { Injectable, linkedSignal, signal } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class AppData {
  readonly selectedWeek = linkedSignal<Date | null>(() => this.weeks()[0] || null);
  readonly weeks = signal<Date[]>([
    // TODO: Remove when backend is operational
    new Date('2026-03-16'),
    new Date('2026-03-09'),
    new Date('2026-03-02'),
  ]);
}
