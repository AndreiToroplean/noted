import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

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

  describe('the week in the address', () => {
    async function render() {
      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting(), provideDateFormat()],
      });
      const fixture = TestBed.createComponent(WeekSelector);
      fixture.detectChanges();
      const http = TestBed.inject(HttpTestingController);
      http.expectOne(`${API_BASE}/weeks`).flush(['2026-02-09', '2026-02-02']);
      await settle();
      fixture.detectChanges();
      const tab = (index: number) =>
        fixture.nativeElement.querySelectorAll('[role="tab"]')[index] as HTMLElement;
      return { fixture, tab };
    }

    it('is left alone while the week is only the default', async () => {
      await render();
      expect(TestBed.inject(Router).url).toBe('/');
    });

    it('names a week once it is clicked, the open one too', async () => {
      const { tab } = await render();
      tab(0).click();
      await settle();
      expect(TestBed.inject(Router).url).toBe('/?week=2026-02-09');

      tab(1).click();
      await settle();
      expect(TestBed.inject(Router).url).toBe('/?week=2026-02-02');
      expect(TestBed.inject(AppData).selectedWeek()).toBe('2026-02-02');
    });

    it('names a week chosen from the keyboard', async () => {
      const { tab } = await render();
      tab(1).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await settle();
      expect(TestBed.inject(Router).url).toBe('/?week=2026-02-02');
    });
  });

  describe('the weekend', () => {
    async function render(sundayItems = 0, sundayArrival: string | null = null) {
      // A weekday, since this week opened on the weekend shows it from the start.
      vi.setSystemTime(new Date('2026-02-13T12:00'));
      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting(), provideDateFormat()],
      });
      const appData = TestBed.inject(AppData);
      const http = TestBed.inject(HttpTestingController);
      const fixture = TestBed.createComponent(WeekSelector);
      document.body.append(fixture.nativeElement);
      fixture.detectChanges();
      http.expectOne(`${API_BASE}/weeks`).flush(['2026-02-09', '2026-02-02']);
      await settle();
      fixture.detectChanges();
      const days = ['09', '10', '11', '12', '13', '14', '15'].map(day => ({
        date: `2026-02-${day}`,
        status: 'working',
        arrival: null as string | null,
        departure: null,
        expected_minutes: 480,
        items: [],
      }));
      days[6].items = Array.from({ length: sundayItems }) as never[];
      days[6].arrival = sundayArrival;
      appData.week.set({ week: '2026-02-09', days } as never);
      return { appData, fixture };
    }

    async function openMenu(fixture: Awaited<ReturnType<typeof render>>['fixture'], tab = 0) {
      const tabs = fixture.nativeElement.querySelectorAll('[role="tab"]');
      tabs[tab].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      fixture.detectChanges();
      await settle();
      return document.querySelector('[data-toggle-weekend]') as HTMLButtonElement | null;
    }

    it('is shown from the menu of the current week, and hidden again while empty', async () => {
      const { appData, fixture } = await render();
      const toggle = await openMenu(fixture);
      expect(toggle?.textContent).toContain('Show weekend');
      toggle!.click();
      expect(appData.weekendShown()).toBe(true);

      const again = await openMenu(fixture);
      expect(again?.textContent).toContain('Hide weekend');
      again!.click();
      expect(appData.weekendShown()).toBe(false);
    });

    it('cannot be hidden while it has something in it', async () => {
      const { fixture } = await render(1);
      const toggle = await openMenu(fixture);
      expect(toggle?.textContent).toContain('Hide weekend');
      expect(toggle?.disabled).toBe(true);
    });

    it('cannot be hidden while it has hours in it', async () => {
      const { fixture } = await render(0, '10:00:00');
      expect((await openMenu(fixture))?.disabled).toBe(true);
    });

    it('is not offered for a week other than the one open', async () => {
      const { fixture } = await render();
      expect(await openMenu(fixture, 1)).toBeNull();
    });
  });
});
