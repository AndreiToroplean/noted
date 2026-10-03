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
      .map(row => (row.hasAttribute('data-break') ? 'break' : row.textContent?.trim()));
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
