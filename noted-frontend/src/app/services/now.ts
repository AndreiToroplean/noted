import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/** The time now, to the minute: what decides which day is going on. */
@Injectable({ providedIn: 'root' })
export class Now {
  readonly at = signal(new Date());

  constructor() {
    const timer = setInterval(() => this.at.set(new Date()), 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }
}
