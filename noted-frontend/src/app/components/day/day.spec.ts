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
