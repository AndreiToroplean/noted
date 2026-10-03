import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { settle } from 'testing/settle';

import { NewWeek } from 'app/components/new-week/new-week';
import { API_BASE } from 'app/services/api';
import { AppData } from 'app/services/app-data';
import { provideDateFormat } from 'app/services/dates';

describe('NewWeek', () => {
  let appData: AppData;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 1, 11, 9, 0));
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideDateFormat()],
    });
    appData = TestBed.inject(AppData);
    const http = TestBed.inject(HttpTestingController);
    TestBed.tick();
    http.expectOne(`${API_BASE}/weeks`).flush(['2026-02-09']);
    await settle();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function render() {
    const fixture = TestBed.createComponent(NewWeek);
    fixture.detectChanges();
    return fixture;
  }

  async function open(fixture: ReturnType<typeof render>) {
    (fixture.nativeElement.querySelector('[data-new-week]') as HTMLElement).click();
    fixture.detectChanges();
    // Not whenStable: the selected week's request stays open, and that counts as pending.
    await settle();
    return document.querySelector('[data-pick-week]') as HTMLElement;
  }

  it('asks which week, starting on next week, so that one is a click and Enter', async () => {
    const picker = await open(render());
    expect(picker.querySelector('[data-week]')?.textContent?.trim()).toBe('16/02/2026');
    picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await vi.waitFor(() => expect(appData.selectedWeek()).toBe('2026-02-16'));
    expect(appData.weekList()).toContain('2026-02-16');
  });

  it('starts any other week a few arrow keys away', async () => {
    const picker = await open(render());
    picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await vi.waitFor(() => expect(appData.selectedWeek()).toBe('2026-02-02'));
  });
});
