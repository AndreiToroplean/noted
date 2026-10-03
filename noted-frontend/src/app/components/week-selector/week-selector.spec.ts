import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { settle } from 'testing/settle';

import { WeekSelector } from 'app/components/week-selector/week-selector';
import { API_BASE } from 'app/services/api';
import { AppData } from 'app/services/app-data';
import { provideDateFormat } from 'app/services/dates';

describe('WeekSelector', () => {
  it.each([
    ['in front of the selected one', '2026-02-16'],
    ['further down the list', '2026-01-26'],
  ])('marks a newly started week as the one selected, %s', async (_, started) => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideDateFormat()],
    });
    const appData = TestBed.inject(AppData);
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(WeekSelector);
    fixture.detectChanges();
    http.expectOne(`${API_BASE}/weeks`).flush(['2026-02-09', '2026-02-02']);
    await settle();
    fixture.detectChanges();

    // A new week goes in front of the selected one, at the same index.
    appData.openWeek(started);
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();

    const active = fixture.nativeElement.querySelector('[role="tab"][aria-selected="true"]');
    expect(active?.textContent?.trim()).toBe(started.split('-').reverse().join('/'));
    expect(appData.selectedWeek()).toBe(started);
  });
});
