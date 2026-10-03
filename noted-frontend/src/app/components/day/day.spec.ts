import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { settle } from 'testing/settle';

import { Day } from 'app/components/day/day';
import { API_BASE, Break, Day as DayData, DayItem, Entry } from 'app/services/api';
import { AppData } from 'app/services/app-data';

function entry(category: string | null, over: Partial<Entry> = {}): Entry {
  return {
    id: 1,
    position: 0,
    kind: 'task',
    done: false,
    category,
    project_id: null,
    text: 'Wrote the importer',
    note: null,
    explicit_minutes: null,
    explicit_start: null,
    explicit_end: null,
    approx_weight: null,
    ...over,
  };
}

function pause(over: Partial<Break> = {}): Break {
  return {
    id: 1,
    position: 0,
    kind: 'break',
    is_noon: true,
    description: null,
    start: null,
    end: null,
    minutes: 60,
    ...over,
  };
}

function day(items: DayItem[]): DayData {
  return {
    date: '2026-02-09',
    status: 'working',
    arrival: null,
    departure: null,
    expected_minutes: 480,
    items,
  };
}

describe('Day', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  async function swatchFor(category: string | null): Promise<HTMLElement | null> {
    const fixture = TestBed.createComponent(Day);
    fixture.componentRef.setInput('day', day([entry(category)]));
    fixture.detectChanges();

    http
      .match(`${API_BASE}/categories`)
      .forEach(request => request.flush([{ name: 'M', meaning: 'Meeting', colour: '#351c75' }]));
    await settle();
    fixture.detectChanges();

    return fixture.nativeElement.querySelector('[data-category]');
  }

  it('colours an entry from the category the API defines', async () => {
    // rgb, because that is how the DOM reports a colour it has parsed.
    expect((await swatchFor('M'))?.style.backgroundColor).toBe('rgb(53, 28, 117)');
  });

  it('leaves an entry with no category uncoloured', async () => {
    expect(await swatchFor(null)).toBeNull();
  });
});

describe('Day hours', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  async function render(data: DayData) {
    const fixture = TestBed.createComponent(Day);
    fixture.componentRef.setInput('day', data);
    fixture.detectChanges();
    http.match(`${API_BASE}/categories`).forEach(request => request.flush([]));
    await settle();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function withHours(over: Partial<DayData>): DayData {
    return { ...day([]), ...over };
  }

  it('shows arrival and departure', async () => {
    const dom = await render(withHours({ arrival: '09:30:00', departure: '18:45:00' }));
    expect(dom.querySelector('[data-arrival]')?.textContent?.trim()).toBe('09:30');
    expect(dom.querySelector('[data-departure]')?.textContent?.trim()).toBe('18:45');
  });

  it('keeps arrival and departure out of the part that scrolls', async () => {
    // They frame the day, so they stay put while a long day's entries scroll
    // between them.
    const dom = await render(
      withHours({ arrival: '09:30:00', departure: '18:45:00', items: [entry(null)] }),
    );
    const list = dom.querySelector('[data-items]');
    expect(list?.querySelector('li')).not.toBeNull();
    expect(list?.querySelector('[data-arrival], [data-departure]')).toBeNull();
  });

  it('shows a break given as a range', async () => {
    const dom = await render(
      withHours({ items: [pause({ start: '13:00:00', end: '14:00:00', minutes: null })] }),
    );
    expect(dom.querySelector('[data-break]')?.textContent).toContain('13:00–14:00');
  });

  it('shows a break given as a duration', async () => {
    const dom = await render(withHours({ items: [pause({ is_noon: false, minutes: 90 })] }));
    expect(dom.querySelector('[data-break]')?.textContent).toContain('1h30');
  });

  it('keeps a break where it sat among the entries', async () => {
    // Lunch is a divider in the day's flow, so it renders between the morning's
    // work and the afternoon's rather than under both.
    const dom = await render(
      withHours({
        items: [
          entry(null, { id: 1, position: 0, text: 'Morning' }),
          pause({ id: 2, position: 1 }),
          entry(null, { id: 3, position: 2, text: 'Afternoon' }),
        ],
      }),
    );
    const rows = [...dom.querySelectorAll('li')]
      .filter(row => !row.querySelector('[data-add]'))
      .map(row => (row.querySelector('[data-break]') ? 'break' : row.textContent?.trim()));
    expect(rows).toEqual(['Morning', 'break', 'Afternoon']);
  });

  it('shows a non-working day by its status instead of its hours', async () => {
    const dom = await render(withHours({ status: 'paid_holiday', arrival: '09:30:00' }));
    expect(dom.textContent).toContain('paid holiday');
    expect(dom.querySelector('[data-arrival]')).toBeNull();
  });
});

describe('Day adding an entry', () => {
  let http: HttpTestingController;
  let appData: AppData;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    appData = TestBed.inject(AppData);
  });

  async function render() {
    appData.week.set({ week: '2026-02-09', days: [day([])] });
    const fixture = TestBed.createComponent(Day);
    fixture.componentRef.setInput('day', appData.week()!.days[0]);
    fixture.detectChanges();
    http.match(() => true).forEach(request => request.flush([]));
    await settle();
    fixture.detectChanges();
    return fixture;
  }

  function open(fixture: Awaited<ReturnType<typeof render>>) {
    (fixture.nativeElement.querySelector('[data-add]') as HTMLElement).click();
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
  }

  function finish(field: HTMLTextAreaElement, text: string) {
    field.value = text;
    field.dispatchEvent(new Event('input'));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
  }

  it('ends each day with a row to add to it', async () => {
    const fixture = await render();
    expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
    expect(open(fixture)).not.toBeNull();
  });

  it('adds the line to the day and stays open for the next one', async () => {
    const fixture = await render();
    const field = open(fixture);
    finish(field, '[T] Fixed it');
    http.expectOne(`${API_BASE}/parse`).flush(entry('T', { text: 'Fixed it' }));
    await settle();
    fixture.detectChanges();

    expect(appData.week()!.days[0].items).toHaveLength(1);
    const reopened = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    expect(reopened.value).toBe('');
  });

  it('adds a break instead after Ctrl+B, then goes back to entries', async () => {
    const fixture = await render();
    const field = open(fixture);
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true }));
    fixture.detectChanges();

    const editor = fixture.nativeElement.querySelector('[data-break-editor]') as HTMLElement;
    expect(editor).not.toBeNull();
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
    fixture.detectChanges();

    http.expectNone(`${API_BASE}/parse`);
    expect(appData.week()!.days[0].items).toMatchObject([{ kind: 'break', minutes: 15 }]);
    expect(fixture.nativeElement.querySelector('[data-break-editor]')).toBeNull();
    expect(fixture.nativeElement.querySelector('textarea')).not.toBeNull();
  });

  it('keeps the line and says why when it cannot be read', async () => {
    const fixture = await render();
    const field = open(fixture);
    finish(field, '[Zz] Something');
    http
      .expectOne(`${API_BASE}/parse`)
      .flush(
        { detail: 'There is no [Zz] category.' },
        { status: 422, statusText: 'Unprocessable' },
      );
    await settle();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('There is no [Zz] category.');
    expect((fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement).value).toBe(
      '[Zz] Something',
    );
  });
});

describe('Day editing an entry', () => {
  let http: HttpTestingController;
  let appData: AppData;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    appData = TestBed.inject(AppData);
  });

  async function render() {
    appData.week.set({
      week: '2026-02-09',
      days: [day([entry('T', { id: 7, text: 'Fixed it', note: 'the header' })])],
    });
    const fixture = TestBed.createComponent(Day);
    fixture.componentRef.setInput('day', appData.week()!.days[0]);
    fixture.detectChanges();
    http.match(`${API_BASE}/categories`).forEach(request =>
      request.flush([
        { name: 'T', meaning: '', colour: '#7f6000' },
        { name: 'M', meaning: '', colour: '#351c75' },
      ]),
    );
    http.match(() => true).forEach(request => request.flush([]));
    await settle();
    fixture.detectChanges();
    return fixture;
  }

  function stored(): Entry {
    return appData.week()!.days[0].items[0] as Entry;
  }

  it('opens the text and note for editing on a double-click', async () => {
    const fixture = await render();
    fixture.nativeElement
      .querySelector('[data-entry-text]')
      .dispatchEvent(new MouseEvent('dblclick'));
    fixture.detectChanges();
    const field = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    expect(field.value).toBe('Fixed it\nthe header');

    field.value = 'Fixed the header\nit was the z-index';
    field.dispatchEvent(new Event('input'));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
    fixture.detectChanges();

    // Edited as plain text: nothing goes back through the syntax.
    http.expectNone(`${API_BASE}/parse`);
    expect(stored()).toMatchObject({ text: 'Fixed the header', note: 'it was the z-index' });
    expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
  });

  it('changes the category from the swatch', async () => {
    const fixture = await render();
    (fixture.nativeElement.querySelector('[data-category]') as HTMLElement).click();
    fixture.detectChanges();
    await fixture.whenStable();

    const choice = document.querySelector('[data-choose-category="M"]') as HTMLElement;
    expect(choice).not.toBeNull();
    choice.click();
    expect(stored().category).toBe('M');
  });
});

describe('Day editing a break', () => {
  let http: HttpTestingController;
  let appData: AppData;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    appData = TestBed.inject(AppData);
  });

  it('opens a break for editing on a double-click and keeps the change', async () => {
    // An entry with the same id as the break: the two are separate tables.
    appData.week.set({
      week: '2026-02-09',
      days: [day([entry(null, { id: 4, text: 'Morning' }), pause({ id: 4, minutes: 60 })])],
    });
    const fixture = TestBed.createComponent(Day);
    fixture.componentRef.setInput('day', appData.week()!.days[0]);
    fixture.detectChanges();
    http.match(() => true).forEach(request => request.flush([]));
    await settle();
    fixture.detectChanges();

    fixture.nativeElement.querySelector('[data-break]').dispatchEvent(new MouseEvent('dblclick'));
    fixture.detectChanges();
    const editor = fixture.nativeElement.querySelector('[data-break-editor]') as HTMLElement;
    expect((editor.querySelector('[data-minutes]') as HTMLInputElement).value).toBe('60');

    (editor.querySelector('[data-more]') as HTMLElement).click();
    fixture.detectChanges();
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
    fixture.detectChanges();

    const [morning, lunch] = appData.week()!.days[0].items;
    expect(lunch).toMatchObject({ kind: 'break', minutes: 75, is_noon: true });
    expect(morning).toMatchObject({ kind: 'task', text: 'Morning' });
    expect(fixture.nativeElement.querySelector('[data-break-editor]')).toBeNull();
  });
});

describe('Day editing its hours', () => {
  let http: HttpTestingController;
  let appData: AppData;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    appData = TestBed.inject(AppData);
  });

  async function render(over: Partial<DayData> = {}) {
    appData.week.set({ week: '2026-02-09', days: [{ ...day([]), ...over }] });
    const fixture = TestBed.createComponent(Day);
    fixture.componentRef.setInput('day', appData.week()!.days[0]);
    fixture.detectChanges();
    http.match(() => true).forEach(request => request.flush([]));
    await settle();
    fixture.detectChanges();
    return fixture;
  }

  function edit(
    fixture: Awaited<ReturnType<typeof render>>,
    which: string,
    value: string,
    key: string,
  ) {
    fixture.nativeElement
      .querySelector(`[data-${which}]`)
      .dispatchEvent(new MouseEvent('dblclick'));
    fixture.detectChanges();
    const field = fixture.nativeElement.querySelector('input[type="time"]') as HTMLInputElement;
    field.value = value;
    field.dispatchEvent(new Event('input'));
    field.dispatchEvent(new KeyboardEvent('keydown', { key }));
    fixture.detectChanges();
  }

  it('changes the arrival on a double-click', async () => {
    const fixture = await render({ arrival: '09:30:00', departure: '18:00:00' });
    edit(fixture, 'arrival', '09:15', 'Enter');
    expect(appData.week()!.days[0].arrival).toBe('09:15:00');
    expect(fixture.nativeElement.querySelector('input[type="time"]')).toBeNull();
  });

  it('changes the departure on a double-click', async () => {
    const fixture = await render({ arrival: '09:30:00', departure: '18:00:00' });
    edit(fixture, 'departure', '18:45', 'Enter');
    expect(appData.week()!.days[0].departure).toBe('18:45:00');
  });

  it('leaves the time alone on Esc', async () => {
    const fixture = await render({ arrival: '09:30:00', departure: '18:00:00' });
    edit(fixture, 'arrival', '07:00', 'Escape');
    expect(appData.week()!.days[0].arrival).toBe('09:30:00');
  });

  it('offers a working day with no hours somewhere to write them', async () => {
    const fixture = await render({ arrival: null, departure: null });
    edit(fixture, 'departure', '18:00', 'Enter');
    expect(appData.week()!.days[0].departure).toBe('18:00:00');
  });
});

describe('Day selecting items', () => {
  let http: HttpTestingController;
  let appData: AppData;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    appData = TestBed.inject(AppData);
  });

  async function render() {
    appData.week.set({
      week: '2026-02-09',
      days: [
        day([
          entry(null, { id: 1, text: 'One' }),
          pause({ id: 1 }),
          entry(null, { id: 2, text: 'Two' }),
          entry(null, { id: 3, text: 'Three' }),
        ]),
      ],
    });
    const fixture = TestBed.createComponent(Day);
    fixture.componentRef.setInput('day', appData.week()!.days[0]);
    fixture.detectChanges();
    http.match(() => true).forEach(request => request.flush([]));
    await settle();
    fixture.detectChanges();
    return fixture;
  }

  function options(fixture: Awaited<ReturnType<typeof render>>): HTMLElement[] {
    return [...fixture.nativeElement.querySelectorAll('[role="option"]')];
  }

  function selected(fixture: Awaited<ReturnType<typeof render>>): number[] {
    return options(fixture).flatMap((option, index) =>
      option.getAttribute('aria-selected') === 'true' ? [index] : [],
    );
  }

  function click(
    fixture: Awaited<ReturnType<typeof render>>,
    index: number,
    mods: MouseEventInit = {},
  ) {
    options(fixture)[index].dispatchEvent(new MouseEvent('click', { bubbles: true, ...mods }));
    fixture.detectChanges();
  }

  function key(
    fixture: Awaited<ReturnType<typeof render>>,
    index: number,
    init: KeyboardEventInit,
    type = 'keydown',
  ) {
    options(fixture)[index].dispatchEvent(new KeyboardEvent(type, { bubbles: true, ...init }));
    fixture.detectChanges();
  }

  it('is a list of options that can be several at once', async () => {
    const fixture = await render();
    const list = fixture.nativeElement.querySelector('[role="listbox"]');
    expect(list.getAttribute('aria-multiselectable')).toBe('true');
    expect(options(fixture)).toHaveLength(4);
    expect(selected(fixture)).toEqual([]);
  });

  it('selects on click, adds with Ctrl and takes a range with Shift', async () => {
    const fixture = await render();
    click(fixture, 0);
    expect(selected(fixture)).toEqual([0]);
    click(fixture, 3, { ctrlKey: true });
    expect(selected(fixture)).toEqual([0, 3]);
    click(fixture, 2, { shiftKey: true });
    expect(selected(fixture)).toEqual([2, 3]);
  });

  it('moves and selects with the arrow keys, extending with Shift', async () => {
    const fixture = await render();
    click(fixture, 0);
    key(fixture, 0, { key: 'ArrowDown' });
    expect(selected(fixture)).toEqual([1]);
    expect(document.activeElement).toBe(options(fixture)[1]);
    key(fixture, 1, { key: 'ArrowDown', shiftKey: true });
    expect(selected(fixture)).toEqual([1, 2]);
  });

  it('moves without selecting under Ctrl, and toggles with Space', async () => {
    const fixture = await render();
    click(fixture, 0);
    key(fixture, 0, { key: 'ArrowDown', ctrlKey: true });
    key(fixture, 1, { key: 'ArrowDown', ctrlKey: true });
    expect(selected(fixture)).toEqual([0]);
    key(fixture, 2, { key: ' ' }, 'keyup');
    expect(selected(fixture)).toEqual([0, 2]);
  });
});

describe('Day deleting items', () => {
  let http: HttpTestingController;
  let appData: AppData;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    appData = TestBed.inject(AppData);
  });

  async function render() {
    appData.week.set({
      week: '2026-02-09',
      days: [
        day([
          entry(null, { id: 1, text: 'One' }),
          pause({ id: 1 }),
          entry(null, { id: 2, text: 'Two' }),
        ]),
      ],
    });
    const fixture = TestBed.createComponent(Day);
    fixture.componentRef.setInput('day', appData.week()!.days[0]);
    fixture.detectChanges();
    http.match(() => true).forEach(request => request.flush([]));
    await settle();
    fixture.detectChanges();
    return fixture;
  }

  function option(fixture: Awaited<ReturnType<typeof render>>, index: number): HTMLElement {
    return fixture.nativeElement.querySelectorAll('[role="option"]')[index];
  }

  async function rightClick(fixture: Awaited<ReturnType<typeof render>>, index: number) {
    option(fixture, index).dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 60 }),
    );
    fixture.detectChanges();
    await settle();
    return document.querySelector('[data-delete-selected]') as HTMLElement;
  }

  it('offers to delete what was right-clicked, selecting it first', async () => {
    const fixture = await render();
    const remove = await rightClick(fixture, 2);
    expect(remove.textContent?.trim()).toMatch(/Delete$/);
    remove.click();
    expect(appData.week()!.days[0].items.map(item => item.id)).toEqual([1, 1]);
  });

  it('deletes the whole selection when the right-click is on part of it', async () => {
    const fixture = await render();
    option(fixture, 0).click();
    option(fixture, 1).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    fixture.detectChanges();
    const remove = await rightClick(fixture, 1);
    expect(remove.textContent).toContain('Delete 2 items');
    remove.click();
    expect(appData.week()!.days[0].items).toMatchObject([{ text: 'Two' }]);
  });
});
