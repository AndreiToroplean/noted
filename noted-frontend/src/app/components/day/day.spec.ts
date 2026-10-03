import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { CdkDrag, CdkDropList } from '@angular/cdk/drag-drop';

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

/** What `/parse` answers for a plain task line, before the test's own fields. */
const parsedTask = {
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

describe('Day entry cell', () => {
  let http: HttpTestingController;
  let appData: AppData;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    appData = TestBed.inject(AppData);
  });

  async function render(over: Partial<Entry> = {}) {
    appData.week.set({ week: '2026-02-09', days: [day([entry('M', over)])] });
    const fixture = TestBed.createComponent(Day);
    fixture.componentRef.setInput('day', appData.week()!.days[0]);
    fixture.detectChanges();
    http
      .match(`${API_BASE}/categories`)
      .forEach(request => request.flush([{ name: 'M', meaning: 'Meeting', colour: '#351c75' }]));
    http.match(() => true).forEach(request => request.flush([]));
    await settle();
    fixture.detectChanges();
    return fixture;
  }

  function cell(fixture: Awaited<ReturnType<typeof render>>): HTMLElement {
    return fixture.nativeElement.querySelector('[data-category-cell]');
  }

  it('fills the cell with the colour the API gives the category', async () => {
    const fixture = await render();
    expect(cell(fixture).style.getPropertyValue('--category')).toBe('#351c75');
  });

  it('names the category in the cell, spelt as the vocabulary spells it', async () => {
    const fixture = await render({ category: 'M' });
    expect(cell(fixture).textContent?.trim()).toBe('M');
  });

  it('leaves the cell uncoloured for an entry with no category', async () => {
    const fixture = await render({ category: null });
    expect(cell(fixture).style.getPropertyValue('--category')).toBe('');
  });

  it('ticks and unticks the entry from the checkbox in the cell', async () => {
    const fixture = await render({ done: false });
    const box = cell(fixture).querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(box.checked).toBe(false);
    box.click();
    expect((appData.week()!.days[0].items[0] as Entry).done).toBe(true);
    // The week passes the changed day back down, as it does in the app.
    fixture.componentRef.setInput('day', appData.week()!.days[0]);
    fixture.detectChanges();
    box.click();
    expect((appData.week()!.days[0].items[0] as Entry).done).toBe(false);
  });

  it('does not dim a done entry', async () => {
    const fixture = await render({ done: true });
    expect(fixture.nativeElement.querySelector('.opacity-60:not(.text-xs)')).toBeNull();
  });

  it('has no cell for an annotation, which is not something to do', async () => {
    const fixture = await render({ kind: 'meta', category: null, text: '[On site]' });
    expect(cell(fixture)).toBeNull();
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
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  }

  it('ends each day with a row to add to it', async () => {
    const fixture = await render();
    expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
    expect(open(fixture)).not.toBeNull();
  });

  it('writes the new line in an entry like any other, cell and all', async () => {
    const fixture = await render();
    open(fixture);
    const row = fixture.nativeElement.querySelector('[data-adding]') as HTMLElement;
    expect(row.classList).toContain('day-item');
    expect(row.querySelector('.entry-cell')).not.toBeNull();
    expect(row.querySelector('app-inline-entry-editor [data-edit-text]')).not.toBeNull();
  });

  it('takes a note on the line below, as an entry being edited does', async () => {
    const fixture = await render();
    const field = open(fixture);
    field.value = '[T] Fixed it\nthe header';
    field.dispatchEvent(new Event('input'));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    const request = http.expectOne(`${API_BASE}/parse`);
    expect(request.request.body).toEqual({ text: '[T] Fixed it\nthe header' });
    request.flush(entry('T', { text: 'Fixed it', note: 'the header' }));
    await settle();
  });

  it('adds the line to the day, closing on it selected', async () => {
    const fixture = await render();
    const field = open(fixture);
    finish(field, '[T] Fixed it');
    http.expectOne(`${API_BASE}/parse`).flush(entry('T', { text: 'Fixed it' }));
    await settle();
    fixture.componentRef.setInput('day', appData.week()!.days[0]);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(appData.week()!.days[0].items).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
    const added = fixture.nativeElement.querySelector('[role="option"]') as HTMLElement;
    expect(added.getAttribute('aria-selected')).toBe('true');
  });

  it('adds a break instead after Ctrl+B, then goes back to entries', async () => {
    const fixture = await render();
    const field = open(fixture);
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true }));
    fixture.detectChanges();

    const editor = fixture.nativeElement.querySelector('[data-break-editor]') as HTMLElement;
    expect(editor).not.toBeNull();
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
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

  it('edits the text and note where they are, on a double-click', async () => {
    const fixture = await render();
    fixture.nativeElement
      .querySelector('[data-entry-text]')
      .dispatchEvent(new MouseEvent('dblclick'));
    fixture.detectChanges();
    const text = fixture.nativeElement.querySelector('[data-edit-text]') as HTMLTextAreaElement;
    expect(text.value).toBe('Fixed it\nthe header');

    text.value = 'Fixed the header\nit was the z-index';
    text.dispatchEvent(new Event('input'));
    text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();

    // Read as a new line would be, and laid over the entry.
    const request = http.expectOne(`${API_BASE}/parse`);
    expect(request.request.body).toEqual({ text: 'Fixed the header\nit was the z-index' });
    request.flush({ ...parsedTask, text: 'Fixed the header', note: 'it was the z-index' });
    await settle();
    fixture.detectChanges();
    expect(stored()).toMatchObject({
      text: 'Fixed the header',
      note: 'it was the z-index',
      category: 'T',
    });
    expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
  });

  it('takes a category written at the head of the text over the one it had', async () => {
    const fixture = await render();
    fixture.nativeElement
      .querySelector('[data-entry-text]')
      .dispatchEvent(new MouseEvent('dblclick'));
    fixture.detectChanges();
    const text = fixture.nativeElement.querySelector('[data-edit-text]') as HTMLTextAreaElement;
    text.value = '[M] Fixed it';
    text.dispatchEvent(new Event('input'));
    text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    http.expectOne(`${API_BASE}/parse`).flush({ ...parsedTask, category: 'M', note: 'the header' });
    await settle();
    fixture.detectChanges();
    expect(stored()).toMatchObject({ text: 'Fixed it', category: 'M' });
    // Saved, it is left selected, for the arrows to go on from.
    const option = fixture.nativeElement.querySelector('[role="option"]') as HTMLElement;
    expect(option.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(option);
  });

  it('stays open and says why when the line cannot be read', async () => {
    const fixture = await render();
    fixture.nativeElement
      .querySelector('[data-entry-text]')
      .dispatchEvent(new MouseEvent('dblclick'));
    fixture.detectChanges();
    const text = fixture.nativeElement.querySelector('[data-edit-text]') as HTMLTextAreaElement;
    text.value = '[Zz] Fixed it';
    text.dispatchEvent(new Event('input'));
    text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    http
      .expectOne(`${API_BASE}/parse`)
      .flush(
        { detail: 'There is no [Zz] category.' },
        { status: 422, statusText: 'Unprocessable' },
      );
    await settle();
    fixture.detectChanges();
    expect(stored().category).toBe('T');
    expect(fixture.nativeElement.querySelector('[data-edit-text]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
      'There is no [Zz] category.',
    );
  });

  it('changes the category from a menu on its tag, on a double-click', async () => {
    const fixture = await render();
    fixture.nativeElement
      .querySelector('.entry-tag')
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    fixture.detectChanges();
    await settle();

    const current = document.querySelector('[data-choose-category="T"]') as HTMLElement;
    expect(current.querySelector('[data-current]')).not.toBeNull();
    (document.querySelector('[data-choose-category="M"]') as HTMLElement).click();
    expect(stored().category).toBe('M');
  });

  it('offers no category in the right-click menu', async () => {
    const fixture = await render();
    fixture.nativeElement
      .querySelector('[role="option"]')
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    await settle();
    expect(document.querySelector('[data-delete-selected]')).not.toBeNull();
    expect(document.querySelector('[data-category-submenu]')).toBeNull();
  });

  it('ticks only from the checkbox itself, not the rest of the cell', async () => {
    const fixture = await render();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.entry-tag')!.click();
    fixture.detectChanges();
    expect(stored().done).toBe(false);
    (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('.entry-done')!.click();
    expect(stored().done).toBe(true);
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
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
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

  it('steps a time by quarter hours with the same control as a break', async () => {
    const fixture = await render({ arrival: '09:30:00', departure: '18:00:00' });
    fixture.nativeElement.querySelector('[data-arrival]').dispatchEvent(new MouseEvent('dblclick'));
    fixture.detectChanges();
    const field = fixture.nativeElement.querySelector('input[type="time"]') as HTMLInputElement;
    expect(field.closest('app-stepper')).not.toBeNull();
    (fixture.nativeElement.querySelector('[data-less]') as HTMLElement).click();
    (fixture.nativeElement.querySelector('[data-less]') as HTMLElement).click();
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    expect(appData.week()!.days[0].arrival).toBe('09:00:00');
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

  it('comes round through the row for a new entry, but not while extending', async () => {
    const fixture = await render();
    const add = fixture.nativeElement.querySelector('[data-add]') as HTMLElement;
    click(fixture, 3);
    key(fixture, 3, { key: 'ArrowDown', shiftKey: true });
    expect(selected(fixture)).toEqual([3]);

    key(fixture, 3, { key: 'ArrowDown' });
    expect(selected(fixture)).toEqual([]);
    expect(document.activeElement).toBe(add);

    add.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    fixture.detectChanges();
    expect(selected(fixture)).toEqual([0]);

    key(fixture, 0, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(add);
    add.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    fixture.detectChanges();
    expect(selected(fixture)).toEqual([3]);
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

  it('moves without selecting under Ctrl', async () => {
    const fixture = await render();
    click(fixture, 0);
    key(fixture, 0, { key: 'ArrowDown', ctrlKey: true });
    key(fixture, 1, { key: 'ArrowDown', ctrlKey: true });
    expect(selected(fixture)).toEqual([0]);
    expect(document.activeElement).toBe(options(fixture)[2]);
  });

  function done(): boolean[] {
    return appData
      .week()!
      .days[0].items.filter(item => item.kind === 'task')
      .map(item => (item as Entry).done);
  }

  it('ticks the selected entries on Space, then unticks them, breaks aside', async () => {
    const fixture = await render();
    click(fixture, 0);
    click(fixture, 2, { shiftKey: true });
    key(fixture, 2, { key: ' ' }, 'keyup');
    expect(done()).toEqual([true, true, false]);

    fixture.componentRef.setInput('day', appData.week()!.days[0]);
    fixture.detectChanges();
    key(fixture, 2, { key: ' ' }, 'keyup');
    expect(done()).toEqual([false, false, false]);
  });

  it('ticks the focused entry on Space when it is not selected', async () => {
    const fixture = await render();
    click(fixture, 0);
    key(fixture, 0, { key: 'ArrowDown', ctrlKey: true });
    key(fixture, 1, { key: 'ArrowDown', ctrlKey: true });
    key(fixture, 2, { key: ' ' }, 'keyup');
    expect(done()).toEqual([false, true, false]);
  });

  it('writes over a selected entry when typed at, Ctrl+Z bringing it back', async () => {
    const fixture = await render();
    click(fixture, 0);
    key(fixture, 0, { key: 'R' });
    const field = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    expect(field.value).toBe('R');

    field.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
    expect(field.value).toBe('One');
  });

  it('starts a new entry when typed at on the row for one', async () => {
    const fixture = await render();
    const add = fixture.nativeElement.querySelector('[data-add]') as HTMLElement;
    add.dispatchEvent(new KeyboardEvent('keydown', { key: '[', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    const field = fixture.nativeElement.querySelector(
      '[data-adding] textarea',
    ) as HTMLTextAreaElement;
    expect(field.value).toBe('[');
  });

  it('opens the focused item for editing on Enter', async () => {
    const fixture = await render();
    key(fixture, 0, { key: 'Enter' });
    expect(fixture.nativeElement.querySelector('textarea')?.value).toBe('One');
  });

  it('lets go of the selection once an item is open for editing', async () => {
    const fixture = await render();
    click(fixture, 0);
    click(fixture, 2, { shiftKey: true });
    key(fixture, 0, { key: 'Enter' });
    fixture.detectChanges();
    expect(selected(fixture)).toEqual([]);
  });

  it('lets go of the selection once a break is open for editing', async () => {
    const fixture = await render();
    click(fixture, 1);
    key(fixture, 1, { key: 'Enter' });
    fixture.detectChanges();
    expect(selected(fixture)).toEqual([]);
  });

  it('opens a focused break for editing on Enter', async () => {
    const fixture = await render();
    key(fixture, 1, { key: 'Enter' });
    expect(fixture.nativeElement.querySelector('[data-break-editor]')).not.toBeNull();
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

describe('Day dragging items', () => {
  it('makes each item draggable, and moves it where it is dropped', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const http = TestBed.inject(HttpTestingController);
    const appData = TestBed.inject(AppData);
    appData.week.set({
      week: '2026-02-09',
      days: [day([entry(null, { id: 1, text: 'One' }), entry(null, { id: 2, text: 'Two' })])],
    });
    const fixture = TestBed.createComponent(Day);
    fixture.componentRef.setInput('day', appData.week()!.days[0]);
    fixture.detectChanges();
    http.match(() => true).forEach(request => request.flush([]));
    await settle();
    fixture.detectChanges();

    expect(fixture.debugElement.queryAll(By.directive(CdkDrag))).toHaveLength(2);
    const list = fixture.debugElement.query(By.directive(CdkDropList));
    const here = list.injector.get(CdkDropList);
    list.triggerEventHandler('cdkDropListDropped', {
      previousContainer: here,
      container: here,
      previousIndex: 0,
      currentIndex: 1,
      item: fixture.debugElement.queryAll(By.directive(CdkDrag))[0].injector.get(CdkDrag),
    });
    expect(appData.week()!.days[0].items.map(item => item.id)).toEqual([2, 1]);
  });
});

describe('Day failed entries', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 1, 11, 9, 0)); // Wednesday 11 February
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function failed(date: string, over: Partial<Entry> = {}): Promise<boolean> {
    const fixture = TestBed.createComponent(Day);
    fixture.componentRef.setInput('day', { ...day([entry('T', over)]), date });
    fixture.detectChanges();
    http.match(() => true).forEach(request => request.flush([]));
    await settle();
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('[data-failed]') !== null;
  }

  it('marks an unfinished entry on a past day as failed', async () => {
    expect(await failed('2026-02-10', { done: false })).toBe(true);
  });

  it('does not fail what is still today, or ahead', async () => {
    expect(await failed('2026-02-11', { done: false })).toBe(false);
    expect(await failed('2026-02-12', { done: false })).toBe(false);
  });

  it('does not fail what was done, or what has no text', async () => {
    expect(await failed('2026-02-10', { done: true })).toBe(false);
    expect(await failed('2026-02-10', { done: false, text: '' })).toBe(false);
  });

  it('never fails an annotation', async () => {
    expect(await failed('2026-02-10', { kind: 'meta', category: null, text: '[On site]' })).toBe(
      false,
    );
  });
});

describe('Day dragging a selection', () => {
  let appData: AppData;

  async function render() {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const http = TestBed.inject(HttpTestingController);
    appData = TestBed.inject(AppData);
    appData.week.set({
      week: '2026-02-09',
      days: [
        day([
          entry(null, { id: 1, text: 'One' }),
          entry(null, { id: 2, text: 'Two' }),
          entry(null, { id: 3, text: 'Three' }),
          entry(null, { id: 4, text: 'Four' }),
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

  function texts() {
    return appData.week()!.days[0].items.map(item => (item as Entry).text);
  }

  function drop(fixture: Awaited<ReturnType<typeof render>>, from: number, to: number) {
    const list = fixture.debugElement.query(By.directive(CdkDropList));
    const here = list.injector.get(CdkDropList);
    const drags = fixture.debugElement.queryAll(By.directive(CdkDrag));
    list.triggerEventHandler('cdkDropListDropped', {
      previousContainer: here,
      container: here,
      previousIndex: from,
      currentIndex: to,
      item: drags[from].injector.get(CdkDrag),
    });
  }

  it('moves the whole selection when a selected item is dragged', async () => {
    const fixture = await render();
    const options = fixture.nativeElement.querySelectorAll('[role="option"]');
    options[0].click();
    options[2].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    fixture.detectChanges();

    // "One" dragged to the end, carrying "Three" with it.
    drop(fixture, 0, 3);
    expect(texts()).toEqual(['Two', 'Four', 'One', 'Three']);
  });

  it('moves only the dragged item when it is outside the selection', async () => {
    const fixture = await render();
    fixture.nativeElement.querySelectorAll('[role="option"]')[0].click();
    fixture.detectChanges();
    drop(fixture, 1, 3);
    expect(texts()).toEqual(['One', 'Three', 'Four', 'Two']);
  });
});

describe('Day drafts', () => {
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
      days: [day([entry('T', { id: 7, text: 'Fixed it', note: null })])],
    });
    const fixture = TestBed.createComponent(Day);
    fixture.componentRef.setInput('day', appData.week()!.days[0]);
    document.body.append(fixture.nativeElement);
    fixture.detectChanges();
    http.match(() => true).forEach(request => request.flush([]));
    await settle();
    fixture.detectChanges();
    return fixture;
  }

  function field(fixture: Awaited<ReturnType<typeof render>>, selector: string) {
    return fixture.nativeElement.querySelector(selector) as HTMLTextAreaElement;
  }

  function type(input: HTMLTextAreaElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  function press(input: HTMLTextAreaElement, key: string, ctrlKey = false) {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey, bubbles: true }));
  }

  function openEntry(fixture: Awaited<ReturnType<typeof render>>) {
    fixture.nativeElement
      .querySelector('[data-entry-text]')
      .dispatchEvent(new MouseEvent('dblclick'));
    fixture.detectChanges();
    return field(fixture, '[data-edit-text]');
  }

  it('keeps an entry being edited as a draft when it is closed, unsaved', async () => {
    const fixture = await render();
    const text = openEntry(fixture);
    type(text, 'Fixed it, nearly');
    press(text, 'Escape');
    fixture.detectChanges();

    expect((appData.week()!.days[0].items[0] as Entry).text).toBe('Fixed it');
    expect(openEntry(fixture).value).toBe('Fixed it, nearly');
  });

  it('keeps what was typed through a redraw, and resumes it', async () => {
    const fixture = await render();
    const text = openEntry(fixture);
    type(text, 'Fixed it, nearly');
    fixture.detectChanges();
    type(text, 'Fixed it, nearly\nNeeds a test');
    fixture.detectChanges();
    press(text, 'Escape');
    fixture.detectChanges();

    expect(openEntry(fixture).value).toBe('Fixed it, nearly\nNeeds a test');
  });

  it('goes back from a resumed draft to the entry as saved on Ctrl+Z', async () => {
    const fixture = await render();
    const text = openEntry(fixture);
    type(text, 'Fixed it, nearly');
    press(text, 'Escape');
    fixture.detectChanges();

    const reopened = openEntry(fixture);
    reopened.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
    expect(reopened.value).toBe('Fixed it');
  });

  it('forgets the draft once the entry is saved', async () => {
    const fixture = await render();
    let text = openEntry(fixture);
    type(text, 'Fixed it, nearly');
    press(text, 'Escape');
    fixture.detectChanges();
    text = openEntry(fixture);
    press(text, 'Enter');
    http.expectOne(`${API_BASE}/parse`).flush({ ...parsedTask, text: 'Fixed it, nearly' });
    await settle();
    fixture.componentRef.setInput('day', appData.week()!.days[0]);
    fixture.detectChanges();

    expect((appData.week()!.days[0].items[0] as Entry).text).toBe('Fixed it, nearly');
    expect(openEntry(fixture).value).toBe('Fixed it, nearly');
  });

  it('keeps a new line as a draft, and shows it in the row for adding', async () => {
    const fixture = await render();
    (fixture.nativeElement.querySelector('[data-add]') as HTMLElement).click();
    fixture.detectChanges();
    const line = field(fixture, '[data-edit-text]');
    type(line, '[T] Half a thought');
    line.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    fixture.detectChanges();

    const add = fixture.nativeElement.querySelector('[data-add]') as HTMLElement;
    expect(add.textContent).toContain('[T] Half a thought');
    add.click();
    fixture.detectChanges();
    expect(field(fixture, '[data-edit-text]').value).toBe('[T] Half a thought');
  });
});

describe('Day break drafts', () => {
  it('keeps a break being edited as a draft when it is closed, unsaved', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const http = TestBed.inject(HttpTestingController);
    const appData = TestBed.inject(AppData);
    appData.week.set({ week: '2026-02-09', days: [day([pause({ id: 4, minutes: 60 })])] });
    const fixture = TestBed.createComponent(Day);
    fixture.componentRef.setInput('day', appData.week()!.days[0]);
    fixture.detectChanges();
    http.match(() => true).forEach(request => request.flush([]));
    await settle();
    fixture.detectChanges();

    const open = () => {
      fixture.nativeElement.querySelector('[data-break]').dispatchEvent(new MouseEvent('dblclick'));
      fixture.detectChanges();
      return fixture.nativeElement.querySelector('[data-break-editor]') as HTMLElement;
    };
    let editor = open();
    (editor.querySelector('[data-more]') as HTMLElement).click();
    fixture.detectChanges();
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(appData.week()!.days[0].items[0]).toMatchObject({ minutes: 60 });
    editor = open();
    expect((editor.querySelector('[data-minutes]') as HTMLInputElement).value).toBe('75');
  });
});

describe('Day moving between entries from the keyboard', () => {
  let http: HttpTestingController;
  let appData: AppData;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    appData = TestBed.inject(AppData);
  });

  const monday = '2026-02-09';
  const tuesday = '2026-02-10';

  async function render() {
    appData.week.set({
      week: monday,
      days: [
        day([entry('T', { id: 1, text: 'One' }), entry('T', { id: 2, position: 1, text: 'Two' })]),
        { ...day([entry('M', { id: 3, text: 'Three' })]), date: tuesday },
      ],
    });
    const fixtures = appData.week()!.days.map((data, index, days) => {
      const fixture = TestBed.createComponent(Day);
      fixture.componentRef.setInput('day', data);
      // Coming round at either end, as the week hands them out.
      const at = (offset: number) => days[(index + offset + days.length) % days.length].date;
      fixture.componentRef.setInput('previousDate', at(-1));
      fixture.componentRef.setInput('nextDate', at(1));
      return fixture;
    });
    // Side by side, as in a week; TestBed takes each root out as it makes the next.
    for (const fixture of fixtures) {
      document.body.append(fixture.nativeElement);
      fixture.detectChanges();
    }
    http.match(() => true).forEach(request => request.flush([]));
    await settle();
    fixtures.forEach(fixture => fixture.detectChanges());
    return fixtures;
  }

  type Fixture = Awaited<ReturnType<typeof render>>[number];

  function editing(fixture: Fixture): string | null {
    const field = fixture.nativeElement.querySelector('[data-edit-text]') as HTMLTextAreaElement;
    return field?.value ?? null;
  }

  function press(fixture: Fixture, key: string, shiftKey = false) {
    const field = fixture.nativeElement.querySelector('[data-edit-text]') as HTMLTextAreaElement;
    field.dispatchEvent(
      new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
  }

  function open(fixture: Fixture, index: number) {
    fixture.nativeElement
      .querySelectorAll('[data-entry-text]')
      [index].dispatchEvent(new MouseEvent('dblclick'));
    fixture.detectChanges();
  }

  function option(fixture: Fixture, index: number): HTMLElement {
    return fixture.nativeElement.querySelectorAll('[role="option"]')[index];
  }

  it('leaves the entry selected and focused on Esc, for the arrows to go on from', async () => {
    const [mon] = await render();
    open(mon, 1);
    press(mon, 'Escape');
    expect(option(mon, 1).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(option(mon, 1));
  });

  it('selects the first entry of the next day on Tab, and the last of the day before on Shift+Tab', async () => {
    const [mon, tue] = await render();
    option(mon, 0).click();
    mon.detectChanges();
    option(mon, 0).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    mon.detectChanges();
    tue.detectChanges();
    expect(option(tue, 0).getAttribute('aria-selected')).toBe('true');
    expect(option(mon, 0).getAttribute('aria-selected')).toBe('false');
    expect(document.activeElement).toBe(option(tue, 0));

    option(tue, 0).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
    );
    mon.detectChanges();
    expect(document.activeElement).toBe(option(mon, 1));
  });

  it('comes round from the last day to the first on Tab, and back on Shift+Tab', async () => {
    const [mon, tue] = await render();
    option(tue, 0).click();
    tue.detectChanges();
    option(tue, 0).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    mon.detectChanges();
    expect(document.activeElement).toBe(option(mon, 0));

    option(mon, 0).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
    );
    tue.detectChanges();
    expect(document.activeElement).toBe(option(tue, 0));
  });

  it('keeps the checkboxes out of the way of Tab', async () => {
    const [mon] = await render();
    const boxes = [...mon.nativeElement.querySelectorAll('.entry-done')] as HTMLElement[];
    expect(boxes.map(box => box.tabIndex)).toEqual([-1, -1, -1]);
  });

  it('goes down to the next entry, keeping what was typed as a draft', async () => {
    const [mon] = await render();
    open(mon, 0);
    const field = mon.nativeElement.querySelector('[data-edit-text]') as HTMLTextAreaElement;
    field.value = 'One, nearly';
    field.dispatchEvent(new Event('input'));
    press(mon, 'ArrowDown');
    expect(editing(mon)).toBe('Two');

    press(mon, 'ArrowUp');
    expect(editing(mon)).toBe('One, nearly');
  });

  it('goes down from the last entry to the row for a new one, and back up', async () => {
    const [mon] = await render();
    open(mon, 1);
    press(mon, 'ArrowDown');
    expect(mon.nativeElement.querySelector('[data-adding] [data-edit-text]')).not.toBeNull();

    press(mon, 'ArrowUp');
    expect(editing(mon)).toBe('Two');
    expect(mon.nativeElement.querySelector('[data-adding]')).toBeNull();
  });

  it('comes round within the day, through the row for a new entry', async () => {
    const [mon] = await render();
    open(mon, 0);
    press(mon, 'ArrowUp');
    expect(mon.nativeElement.querySelector('[data-adding] [data-edit-text]')).not.toBeNull();
    press(mon, 'ArrowDown');
    expect(editing(mon)).toBe('One');
  });

  it('goes to the next day on Tab, and back to the last entry before on Shift+Tab', async () => {
    const [mon, tue] = await render();
    open(mon, 0);
    press(mon, 'Tab');
    tue.detectChanges();
    expect(editing(mon)).toBeNull();
    expect(editing(tue)).toBe('Three');

    press(tue, 'Tab', true);
    mon.detectChanges();
    expect(editing(tue)).toBeNull();
    expect(editing(mon)).toBe('Two');
  });
});
