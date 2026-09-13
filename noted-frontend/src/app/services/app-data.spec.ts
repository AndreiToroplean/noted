import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { API_BASE, Day, Week } from 'app/services/api';
import { AppData } from 'app/services/app-data';

const MONDAY = '2026-02-09';

function day(date: string): Day {
  return {
    date,
    status: 'working',
    arrival: null,
    departure: null,
    expected_minutes: 480,
    entries: [],
    breaks: [],
  };
}

function week(): Week {
  return {
    week: MONDAY,
    days: ['09', '10', '11', '12', '13', '14', '15'].map(d => day(`2026-02-${d}`)),
  };
}

/** Let the pending response propagate into the resource, then run effects. */
async function settle() {
  await new Promise(resolve => setTimeout(resolve));
  TestBed.tick();
}

describe('AppData', () => {
  let data: AppData;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    data = TestBed.inject(AppData);
    http = TestBed.inject(HttpTestingController);

    TestBed.tick();
    http.expectOne(`${API_BASE}/weeks`).flush([MONDAY]);
    await settle();
    http.expectOne(`${API_BASE}/journal/${MONDAY}`).flush(week());
    await settle();

    // Only the debounce needs controlling; loading above runs on real timers.
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads the newest week', () => {
    expect(data.selectedWeek()).toBe(MONDAY);
    expect(data.week()?.days).toHaveLength(7);
  });

  it('leaves an untouched week alone', () => {
    vi.advanceTimersByTime(5000);
    TestBed.tick();
    http.expectNone(`${API_BASE}/journal/${MONDAY}`);
  });

  it('writes the whole week back once the edits settle', () => {
    const edited = week();
    edited.days[0].entries = [
      {
        id: -1,
        position: 0,
        kind: 'task',
        done: false,
        category: null,
        project_id: null,
        text: 'Wrote the importer',
        note: null,
        explicit_minutes: null,
        explicit_start: null,
        explicit_end: null,
        approx_weight: null,
      },
    ];
    data.week.set(edited);
    TestBed.tick();

    // Nothing yet — the debounce is what keeps typing from becoming traffic.
    http.expectNone(`${API_BASE}/journal/${MONDAY}`);

    vi.advanceTimersByTime(1000);
    const request = http.expectOne(`${API_BASE}/journal/${MONDAY}`);
    expect(request.request.method).toBe('PUT');
    // Ids and positions are the server's to assign, so they are not sent.
    expect(request.request.body.days[0].entries[0]).not.toHaveProperty('id');
    expect(request.request.body.days[0].entries[0].text).toBe('Wrote the importer');
  });

  it('collapses a burst of edits into one write', () => {
    for (let i = 0; i < 3; i++) {
      const draft = week();
      draft.days[0].expected_minutes = 400 + i;
      data.week.set(draft);
      TestBed.tick();
      vi.advanceTimersByTime(100);
    }

    vi.advanceTimersByTime(1000);
    http.expectOne(`${API_BASE}/journal/${MONDAY}`);
  });

  afterEach(() => {
    http.verify();
  });
});
