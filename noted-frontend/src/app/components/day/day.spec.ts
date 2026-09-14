import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { settle } from 'testing/settle';

import { Day } from 'app/components/day/day';
import { API_BASE, Day as DayData, Entry } from 'app/services/api';

function entry(category: string | null): Entry {
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
  };
}

function day(entries: Entry[]): DayData {
  return {
    date: '2026-02-09',
    status: 'working',
    arrival: null,
    departure: null,
    expected_minutes: 480,
    entries,
    breaks: [],
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

  it('shows a break given as a range', async () => {
    const dom = await render(
      withHours({
        breaks: [
          {
            id: 1,
            position: 0,
            is_noon: true,
            description: null,
            start: '13:00:00',
            end: '14:00:00',
            minutes: null,
          },
        ],
      }),
    );
    expect(dom.querySelector('[data-break]')?.textContent).toContain('13:00–14:00');
  });

  it('shows a break given as a duration', async () => {
    const dom = await render(
      withHours({
        breaks: [
          {
            id: 1,
            position: 0,
            is_noon: false,
            description: null,
            start: null,
            end: null,
            minutes: 90,
          },
        ],
      }),
    );
    expect(dom.querySelector('[data-break]')?.textContent).toContain('1h30');
  });

  it('shows a non-working day by its status instead of its hours', async () => {
    const dom = await render(withHours({ status: 'paid_holiday', arrival: '09:30:00' }));
    expect(dom.textContent).toContain('paid holiday');
    expect(dom.querySelector('[data-arrival]')).toBeNull();
  });
});
