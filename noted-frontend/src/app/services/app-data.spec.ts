import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { settle } from 'testing/settle';

import { API_BASE, Day, Entry, Week } from 'app/services/api';
import { AppData } from 'app/services/app-data';

const MONDAY = '2026-02-09';

function day(date: string): Day {
  return {
    date,
    status: 'working',
    arrival: null,
    departure: null,
    expected_minutes: 480,
    items: [],
  };
}

function week(): Week {
  return {
    week: MONDAY,
    days: ['09', '10', '11', '12', '13', '14', '15'].map(d => day(`2026-02-${d}`)),
  };
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
    http.expectOne(`${API_BASE}/categories`).flush([]);
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
    edited.days[0].items = [
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
    expect(request.request.body.days[0].items[0]).not.toHaveProperty('id');
    expect(request.request.body.days[0].items[0].text).toBe('Wrote the importer');
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

describe('AppData typing into a day', () => {
  let data: AppData;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    data = TestBed.inject(AppData);
    http = TestBed.inject(HttpTestingController);

    TestBed.tick();
    http.expectOne(`${API_BASE}/categories`).flush([]);
    http.expectOne(`${API_BASE}/weeks`).flush([MONDAY]);
    await settle();
    http.expectOne(`${API_BASE}/journal/${MONDAY}`).flush(week());
    await settle();
  });

  async function type(text: string, reply: object) {
    const done = data.addTyped(MONDAY, text);
    const request = http.expectOne(`${API_BASE}/parse`);
    expect(request.request.body).toEqual({ text });
    request.flush(reply);
    await done;
    return data.week()!.days[0];
  }

  const task = {
    kind: 'task',
    done: false,
    category: 'T',
    project_id: null,
    text: 'Fixed it',
    note: null,
    explicit_minutes: null,
    explicit_start: null,
    explicit_end: null,
    approx_weight: null,
  };

  it('adds what the line was read as to the end of the day', async () => {
    const monday = await type('[T] Fixed it', task);
    expect(monday.items).toHaveLength(1);
    expect(monday.items[0]).toMatchObject({ kind: 'task', text: 'Fixed it' });
  });

  it('gives each new item an id of its own until the server assigns one', async () => {
    await type('[T] Fixed it', task);
    const monday = await type('[T] Fixed it', task);
    const [first, second] = monday.items;
    expect(first.id).not.toBe(second.id);
  });

  it('reads an arrow before any work as the arrival', async () => {
    const monday = await type('[-> 9:15]', { kind: 'clock', time: '09:15:00' });
    expect(monday.arrival).toBe('09:15:00');
    expect(monday.items).toHaveLength(0);
  });

  it('reads an arrow after some work as the departure', async () => {
    await type('[T] Fixed it', task);
    const monday = await type('[-> 18:30]', { kind: 'clock', time: '18:30:00' });
    expect(monday.departure).toBe('18:30:00');
  });

  it('says why a line was refused', async () => {
    const done = data.addTyped(MONDAY, '[Zz] Something');
    http
      .expectOne(`${API_BASE}/parse`)
      .flush(
        { detail: 'There is no [Zz] category.' },
        { status: 422, statusText: 'Unprocessable' },
      );
    await expect(done).rejects.toThrow('There is no [Zz] category.');
    expect(data.week()!.days[0].items).toHaveLength(0);
  });
});

describe('AppData editing an item', () => {
  let data: AppData;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    data = TestBed.inject(AppData);
    http = TestBed.inject(HttpTestingController);

    TestBed.tick();
    http.expectOne(`${API_BASE}/categories`).flush([]);
    http.expectOne(`${API_BASE}/weeks`).flush([MONDAY]);
    await settle();
    const loaded = week();
    loaded.days[0].items = [
      { ...task(1), text: 'First' },
      { ...task(2), text: 'Second' },
    ];
    http.expectOne(`${API_BASE}/journal/${MONDAY}`).flush(loaded);
    await settle();
  });

  function task(id: number): Entry {
    return {
      id,
      position: id - 1,
      kind: 'task',
      done: false,
      category: null,
      project_id: null,
      text: '',
      note: null,
      explicit_minutes: null,
      explicit_start: null,
      explicit_end: null,
      approx_weight: null,
    };
  }

  it('changes only the item it names', () => {
    data.updateEntry(MONDAY, 2, { category: 'M', note: 'and a note' });
    const [first, second] = data.week()!.days[0].items;
    expect(first).toMatchObject({ text: 'First', category: null, note: null });
    expect(second).toMatchObject({ text: 'Second', category: 'M', note: 'and a note' });
  });
});
