import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { settle } from 'testing/settle';

import { API_BASE, Day, Entry, Week, itemKey } from 'app/services/api';
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
    http.expectOne(`${API_BASE}/settings`).flush([]);
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

  it('stays on the chosen week when the list of weeks reloads', async () => {
    // Every save reloads the list; editing an older week must not jump back to
    // the newest one.
    vi.useRealTimers();
    data.weeks.set([MONDAY, '2026-02-02']);
    data.selectedWeek.set('2026-02-02');
    data.weeks.reload();
    TestBed.tick();
    http.expectOne(`${API_BASE}/weeks`).flush(['2026-02-16', MONDAY, '2026-02-02']);
    await settle();
    expect(data.selectedWeek()).toBe('2026-02-02');
    http.match(`${API_BASE}/journal/2026-02-02`).forEach(request => request.flush(week()));
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

  it('keeps its own copy once saved, so the ids the page goes by hold', () => {
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
    vi.advanceTimersByTime(1000);
    const saved = week();
    saved.days[0].items = [{ ...edited.days[0].items[0], id: 41 }];
    http.expectOne(`${API_BASE}/journal/${MONDAY}`).flush(saved);
    TestBed.tick();

    expect(data.week()).toBe(edited);
    vi.advanceTimersByTime(1000);
    http.expectNone(`${API_BASE}/journal/${MONDAY}`);
    http.expectOne(`${API_BASE}/weeks`).flush([MONDAY]);
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

describe('AppData coming back', () => {
  it('turns the time left into a break, and puts the departure back to the default', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const data = TestBed.inject(AppData);
    const http = TestBed.inject(HttpTestingController);
    TestBed.tick();
    http
      .expectOne(`${API_BASE}/settings`)
      .flush([{ weekday: 0, arrival: '09:30:00', departure: '18:30:00' }]);
    await settle();
    const left = week();
    left.days[0] = { ...left.days[0], arrival: '09:30:00', departure: '12:30:00' };
    data.week.set(left);

    data.cameBack(MONDAY, '13:45:00');
    const monday = data.week()!.days[0];
    expect(monday.departure).toBe('18:30:00');
    expect(monday.items).toEqual([
      expect.objectContaining({
        kind: 'break',
        is_noon: false,
        start: '12:30:00',
        end: '13:45:00',
        minutes: null,
      }),
    ]);
  });

  it('takes coming back in the minute of leaving as not having left', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const data = TestBed.inject(AppData);
    const http = TestBed.inject(HttpTestingController);
    TestBed.tick();
    http
      .expectOne(`${API_BASE}/settings`)
      .flush([{ weekday: 0, arrival: '09:30:00', departure: '18:30:00' }]);
    await settle();
    const left = week();
    left.days[0] = { ...left.days[0], arrival: '09:30:00', departure: '12:30:00' };
    data.week.set(left);

    data.cameBack(MONDAY, '12:30:00');
    expect(data.week()!.days[0]).toMatchObject({ departure: '18:30:00', items: [] });
  });

  it('keeps no break that ends when it starts, however it is made', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const data = TestBed.inject(AppData);
    data.week.set(week());
    const pause = {
      kind: 'break',
      is_noon: false,
      description: null,
      start: '12:30:00',
      end: '12:30:00',
      minutes: null,
    } as const;

    data.addBreak(MONDAY, pause);
    expect(data.week()!.days[0].items).toEqual([]);

    data.addBreak(MONDAY, { ...pause, end: '13:00:00' });
    const kept = data.week()!.days[0].items[0];
    data.updateBreak(MONDAY, kept.id, pause);
    expect(data.week()!.days[0].items).toEqual([]);
  });

  it("knows a date's default hours by its weekday", async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const data = TestBed.inject(AppData);
    const http = TestBed.inject(HttpTestingController);
    TestBed.tick();
    http.expectOne(`${API_BASE}/settings`).flush([
      { weekday: 0, departure: '18:30:00' },
      { weekday: 4, departure: '16:00:00' },
    ]);
    await settle();
    expect(data.defaultsFor(MONDAY)?.departure).toBe('18:30:00');
    expect(data.defaultsFor('2026-02-13')?.departure).toBe('16:00:00');
    expect(data.defaultsFor('2026-02-14')).toBeUndefined();
  });
});

describe('AppData showing the weekend', () => {
  it('forgets that the weekend was shown once another week is chosen', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const data = TestBed.inject(AppData);
    const http = TestBed.inject(HttpTestingController);
    TestBed.tick();
    http.expectOne(`${API_BASE}/categories`).flush([]);
    http.expectOne(`${API_BASE}/weeks`).flush([MONDAY, '2026-02-02']);
    await settle();

    data.weekendShown.set(true);
    data.selectedWeek.set('2026-02-02');
    expect(data.weekendShown()).toBe(false);
    http.match(() => true);
  });

  it('shows a weekend the week loads with as if asked to, so emptying it keeps it', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const data = TestBed.inject(AppData);
    const http = TestBed.inject(HttpTestingController);
    TestBed.tick();
    http.expectOne(`${API_BASE}/categories`).flush([]);
    http.expectOne(`${API_BASE}/weeks`).flush([MONDAY]);
    await settle();
    const loaded = week();
    loaded.days[5].arrival = '10:00:00';
    http.expectOne(`${API_BASE}/journal/${MONDAY}`).flush(loaded);
    await settle();

    expect(data.weekendShown()).toBe(true);
    data.setHours('2026-02-14', { arrival: null });
    expect(data.weekendInUse()).toBe(false);
    expect(data.weekendShown()).toBe(true);
    http.match(() => true);
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
    const done = data.addTyped(MONDAY, { text, note: null });
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
    const done = data.addTyped(MONDAY, { text: '[Zz] Something', note: null });
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

describe('AppData retyping an entry', () => {
  let data: AppData;
  let http: HttpTestingController;

  const entry: Entry = {
    id: 1,
    position: 0,
    kind: 'task',
    done: true,
    category: 'T',
    project_id: 4,
    text: 'Fixed it',
    note: 'the header',
    explicit_minutes: null,
    explicit_start: null,
    explicit_end: null,
    approx_weight: null,
  };
  const later: Entry = { ...entry, id: 2, position: 1, text: 'Later' };

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
    loaded.days[0].items = [entry, later];
    http.expectOne(`${API_BASE}/journal/${MONDAY}`).flush(loaded);
    await settle();
  });

  async function retype(text: string, note: string | null, reply: object) {
    const done = data.retype(MONDAY, 1, { text, note });
    const request = http.expectOne(`${API_BASE}/parse`);
    expect(request.request.body).toEqual({ text: note === null ? text : `${text}\n${note}` });
    request.flush(reply);
    await done;
    return data.week()!.days[0];
  }

  const parsed = {
    kind: 'task',
    done: false,
    category: null,
    project_id: null,
    text: 'Fixed it',
    note: null,
    explicit_minutes: null,
    explicit_start: null,
    explicit_end: null,
    approx_weight: null,
  };

  it('keeps the category and project when the line names neither', async () => {
    const monday = await retype('Fixed the header', null, { ...parsed, text: 'Fixed the header' });
    expect(monday.items[0]).toMatchObject({
      id: 1,
      done: true,
      category: 'T',
      project_id: 4,
      text: 'Fixed the header',
      note: null,
    });
  });

  it('overrides the category and project the line names', async () => {
    const monday = await retype('[M] web: Fixed it', 'the header', {
      ...parsed,
      category: 'M',
      project_id: 9,
      note: 'the header',
    });
    expect(monday.items[0]).toMatchObject({ id: 1, category: 'M', project_id: 9, done: true });
  });

  it('keeps its timing when the line names none, and takes the new one whole when it does', async () => {
    let monday = await retype('Fixed it', '[1h]', { ...parsed, explicit_minutes: 60 });
    expect(monday.items[0]).toMatchObject({ explicit_minutes: 60 });

    monday = await retype('Fixed it again', null, { ...parsed, text: 'Fixed it again' });
    expect(monday.items[0]).toMatchObject({ explicit_minutes: 60 });

    monday = await retype('Fixed it', '[-> 17:30]', { ...parsed, explicit_end: '17:30:00' });
    expect(monday.items[0]).toMatchObject({ explicit_minutes: null, explicit_end: '17:30:00' });
  });

  it('turns into an annotation, with no category, when written as one', async () => {
    const monday = await retype('[On site]', null, {
      ...parsed,
      kind: 'meta',
      text: '[On site]',
    });
    expect(monday.items[0]).toMatchObject({ kind: 'meta', category: null, project_id: null });
  });

  it('turns into a break in the same place when written as one', async () => {
    const monday = await retype('[15m]', null, {
      kind: 'break',
      is_noon: false,
      description: null,
      start: null,
      end: null,
      minutes: 15,
    });
    expect(monday.items.map(item => item.kind)).toEqual(['break', 'task']);
    expect(monday.items[0]).toMatchObject({ minutes: 15 });
  });

  it("becomes the day's hours when written as an arrow, and leaves the list", async () => {
    const monday = await retype('[-> 17:30]', null, { kind: 'clock', time: '17:30:00' });
    expect(monday.items.map(item => item.id)).toEqual([2]);
    expect(monday.departure).toBe('17:30:00');
  });

  it('says why a line was refused, and changes nothing', async () => {
    const done = data.retype(MONDAY, 1, { text: '[Zz] Fixed it', note: null });
    http
      .expectOne(`${API_BASE}/parse`)
      .flush(
        { detail: 'There is no [Zz] category.' },
        { status: 422, statusText: 'Unprocessable' },
      );
    await expect(done).rejects.toThrow('There is no [Zz] category.');
    expect(data.week()!.days[0].items[0]).toEqual(entry);
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

  it('removes the items it names, and only those', () => {
    data.addBreak(MONDAY, {
      kind: 'break',
      is_noon: false,
      description: null,
      start: null,
      end: null,
      minutes: 15,
    });
    const pause = data.week()!.days[0].items[2];
    data.removeItems(MONDAY, new Set(['entry-2', itemKey(pause)]));
    expect(data.week()!.days[0].items).toMatchObject([{ kind: 'task', text: 'First' }]);
  });

  it('moves an item to another place in its day', () => {
    data.moveItems(MONDAY, new Set(['entry-1']), MONDAY, 1);
    expect(data.week()!.days[0].items.map(item => item.id)).toEqual([2, 1]);
  });

  it('moves an item into another day, where it is put', () => {
    data.moveItems(MONDAY, new Set(['entry-2']), '2026-02-10', 0);
    const [monday, tuesday] = data.week()!.days;
    expect(monday.items.map(item => item.id)).toEqual([1]);
    expect(tuesday.items).toMatchObject([{ id: 2, text: 'Second' }]);
  });

  it('moves several items as one block, in their order, to where they are put', () => {
    data.addBreak(MONDAY, {
      kind: 'break',
      is_noon: false,
      description: null,
      start: null,
      end: null,
      minutes: 15,
    });
    // Monday is now: entry-1, entry-2, break. Move entry-1 and the break to the end.
    const pause = itemKey(data.week()!.days[0].items[2]);
    data.moveItems(MONDAY, new Set(['entry-1', pause]), MONDAY, 1);
    expect(data.week()!.days[0].items.map(itemKey)).toEqual(['entry-2', 'entry-1', pause]);
  });

  it('moves several items into another day as one edit', () => {
    data.moveItems(MONDAY, new Set(['entry-1', 'entry-2']), '2026-02-10', 0);
    expect(data.week()!.days[0].items).toEqual([]);
    expect(data.week()!.days[1].items.map(itemKey)).toEqual(['entry-1', 'entry-2']);
    data.undo();
    expect(data.week()!.days[0].items.map(itemKey)).toEqual(['entry-1', 'entry-2']);
  });

  it('takes a move back in one undo, across days too', () => {
    data.moveItems(MONDAY, new Set(['entry-2']), '2026-02-10', 0);
    data.undo();
    const [monday, tuesday] = data.week()!.days;
    expect(monday.items.map(item => item.id)).toEqual([1, 2]);
    expect(tuesday.items).toEqual([]);
  });

  it('changes only the item it names', () => {
    data.updateEntry(MONDAY, 2, { category: 'M', note: 'and a note' });
    const [first, second] = data.week()!.days[0].items;
    expect(first).toMatchObject({ text: 'First', category: null, note: null });
    expect(second).toMatchObject({ text: 'Second', category: 'M', note: 'and a note' });
  });
});

describe('AppData starting a week', () => {
  let data: AppData;
  let http: HttpTestingController;

  async function load(weeks: string[]) {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    data = TestBed.inject(AppData);
    http = TestBed.inject(HttpTestingController);
    TestBed.tick();
    http.expectOne(`${API_BASE}/categories`).flush([]);
    http.expectOne(`${API_BASE}/weeks`).flush(weeks);
    await settle();
    http.match(() => true).forEach(request => request.flush(week()));
    await settle();
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 1, 11, 9, 0)); // a Wednesday, in the week of MONDAY
  });

  afterEach(() => {
    http.match(() => true).forEach(request => request.flush(week()));
    vi.useRealTimers();
  });

  it('lists an opened week in its place and selects it', async () => {
    await load([MONDAY, '2026-02-02']);
    data.openWeek('2026-02-23');
    data.openWeek('2026-01-26');
    expect(data.weekList()).toEqual(['2026-02-23', MONDAY, '2026-02-02', '2026-01-26']);
    expect(data.selectedWeek()).toBe('2026-01-26');
  });

  it('just selects a week that is already there', async () => {
    await load([MONDAY, '2026-02-02']);
    data.openWeek('2026-02-02');
    expect(data.weekList()).toEqual([MONDAY, '2026-02-02']);
    expect(data.selectedWeek()).toBe('2026-02-02');
  });
});

describe('AppData undo', () => {
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
    http.expectOne(`${API_BASE}/weeks`).flush([MONDAY, '2026-02-02']);
    await settle();
    http.expectOne(`${API_BASE}/journal/${MONDAY}`).flush(week());
    await settle();
  });

  function arrival() {
    return data.week()!.days[0].arrival;
  }

  it('takes back the last change, then the one before', () => {
    data.setHours(MONDAY, { arrival: '09:00:00' });
    data.setHours(MONDAY, { arrival: '10:00:00' });
    data.undo();
    expect(arrival()).toBe('09:00:00');
    data.undo();
    expect(arrival()).toBeNull();
  });

  it('puts an undone change back on redo', () => {
    data.setHours(MONDAY, { arrival: '09:00:00' });
    data.undo();
    data.redo();
    expect(arrival()).toBe('09:00:00');
  });

  it('forgets what could be redone once something new is changed', () => {
    data.setHours(MONDAY, { arrival: '09:00:00' });
    data.undo();
    data.setHours(MONDAY, { arrival: '11:00:00' });
    data.redo();
    expect(arrival()).toBe('11:00:00');
  });

  it('does nothing with nothing to undo', () => {
    data.undo();
    data.redo();
    expect(arrival()).toBeNull();
  });

  it('starts afresh on another week', async () => {
    data.setHours(MONDAY, { arrival: '09:00:00' });
    data.selectedWeek.set('2026-02-02');
    TestBed.tick();
    const other = week();
    other.week = '2026-02-02';
    http.expectOne(`${API_BASE}/journal/2026-02-02`).flush(other);
    await settle();
    data.undo();
    expect(data.week()!.week).toBe('2026-02-02');
    expect(data.canUndo()).toBe(false);
  });
});

describe('AppData deleting a week', () => {
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
    http.expectOne(`${API_BASE}/weeks`).flush(['2026-02-16', MONDAY, '2026-02-02']);
    await settle();
    http.match(() => true).forEach(request => request.flush(week()));
    await settle();
  });

  it('deletes it on the server and moves to the week before it', async () => {
    data.selectedWeek.set(MONDAY);
    const done = data.deleteWeek(MONDAY);
    const request = http.expectOne(`${API_BASE}/journal/${MONDAY}`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await done;
    expect(data.selectedWeek()).toBe('2026-02-02');
    TestBed.tick();
    http.expectOne(`${API_BASE}/weeks`).flush(['2026-02-16', '2026-02-02']);
    await settle();
    expect(data.weekList()).toEqual(['2026-02-16', '2026-02-02']);
    http.match(() => true).forEach(request => request.flush(week()));
  });

  it('forgets a started week that was never saved, without asking the server', async () => {
    data.openWeek('2026-02-23');
    await data.deleteWeek('2026-02-23');
    http.expectNone(request => request.method === 'DELETE');
    expect(data.weekList()).not.toContain('2026-02-23');
    expect(data.selectedWeek()).toBe('2026-02-16');
    http.match(() => true).forEach(request => request.flush(week()));
  });
});
