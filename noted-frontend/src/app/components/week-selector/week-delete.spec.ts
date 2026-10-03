import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { settle } from 'testing/settle';

import { WeekSelector } from 'app/components/week-selector/week-selector';
import { API_BASE } from 'app/services/api';
import { AppData } from 'app/services/app-data';
import { provideDateFormat } from 'app/services/dates';

describe('WeekSelector deleting a week', () => {
  let appData: AppData;

  async function render() {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideDateFormat()],
    });
    appData = TestBed.inject(AppData);
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(WeekSelector);
    fixture.detectChanges();
    http.expectOne(`${API_BASE}/weeks`).flush(['2026-02-09', '2026-02-02']);
    await settle();
    fixture.detectChanges();
    return fixture;
  }

  function tab(fixture: Awaited<ReturnType<typeof render>>, index: number): HTMLElement {
    return fixture.nativeElement.querySelectorAll('[role="tab"]')[index];
  }

  async function confirm() {
    await settle();
    const dialog = document.querySelector('[data-confirm-delete-week]') as HTMLElement;
    expect(dialog.textContent).toContain('02/02/2026');
    expect(dialog.textContent).toContain('cannot be undone');
    (dialog.querySelector('[data-delete]') as HTMLElement).click();
  }

  it('asks, then deletes the focused week on Delete', async () => {
    const fixture = await render();
    const remove = vi.spyOn(appData, 'deleteWeek').mockResolvedValue();
    tab(fixture, 1).dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await confirm();
    await vi.waitFor(() => expect(remove).toHaveBeenCalledWith('2026-02-02'));
  });

  it('offers to delete a week from its right-click menu', async () => {
    const fixture = await render();
    const remove = vi.spyOn(appData, 'deleteWeek').mockResolvedValue();
    tab(fixture, 1).dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
    await settle();
    (document.querySelector('[data-delete-week]') as HTMLElement).click();
    await confirm();
    await vi.waitFor(() => expect(remove).toHaveBeenCalledWith('2026-02-02'));
  });

  it('does nothing when the question is declined', async () => {
    const fixture = await render();
    const remove = vi.spyOn(appData, 'deleteWeek').mockResolvedValue();
    tab(fixture, 1).dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await settle();
    (document.querySelector('[data-keep]') as HTMLElement).click();
    await settle();
    expect(remove).not.toHaveBeenCalled();
  });
});
