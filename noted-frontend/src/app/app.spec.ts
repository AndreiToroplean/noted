import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';

import { settle } from 'testing/settle';

import { API_BASE, Day, Entry } from 'app/services/api';
import { AppData } from 'app/services/app-data';
import { provideDateFormat } from 'app/services/dates';
import { Selection } from 'app/services/selection';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideDateFormat()],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('names the tab after the week being edited', async () => {
    // So a bookmark or a row of tabs says which week each one is.
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController)
      .match(`${API_BASE}/weeks`)
      .forEach(request => request.flush(['2026-02-09']));
    await settle();

    expect(TestBed.inject(Title).getTitle()).toBe('Noted – 09/02/2026');
  });

  describe('shortcuts', () => {
    const task: Entry = {
      id: 0,
      position: 0,
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
    const monday: Day = {
      date: '2026-02-09',
      status: 'working',
      arrival: null,
      departure: null,
      expected_minutes: 480,
      items: [],
    };

    function press(target: EventTarget, key: string, over: KeyboardEventInit = {}) {
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, ...over }),
      );
    }

    it('undoes on Ctrl+Z and redoes on Ctrl+Y or Ctrl+Shift+Z', () => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      const appData = TestBed.inject(AppData);
      const undo = vi.spyOn(appData, 'undo');
      const redo = vi.spyOn(appData, 'redo');

      press(document.body, 'z');
      press(document.body, 'y');
      press(document.body, 'Z', { shiftKey: true });
      expect(undo).toHaveBeenCalledTimes(1);
      expect(redo).toHaveBeenCalledTimes(2);
    });

    function withSelection() {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      const selection = TestBed.inject(Selection);
      selection.only('2026-02-09', 'entry-1');
      return selection;
    }

    it('clears the selection on Esc', () => {
      const selection = withSelection();
      press(document.body, 'Escape', { ctrlKey: false });
      expect(selection.size()).toBe(0);
    });

    it('clears the selection on a click outside any item', () => {
      const selection = withSelection();
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(selection.size()).toBe(0);
    });

    it('keeps the selection for a click in a menu or dialog', () => {
      const selection = withSelection();
      const overlay = document.createElement('div');
      overlay.className = 'cdk-overlay-container';
      const item = document.createElement('button');
      overlay.append(item);
      document.body.append(overlay);
      item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(selection.size()).toBe(1);
      overlay.remove();
    });

    it('deletes the selection on Delete, and Ctrl+Z brings it back', () => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      const appData = TestBed.inject(AppData);
      const items = [
        { ...task, id: 1, text: 'One' },
        { ...task, id: 2, text: 'Two' },
      ];
      appData.week.set({ week: '2026-02-09', days: [{ ...monday, items }] });
      TestBed.inject(Selection).only('2026-02-09', 'entry-1');

      press(document.body, 'Delete', { ctrlKey: false });
      expect(appData.week()!.days[0].items).toMatchObject([{ text: 'Two' }]);
      expect(TestBed.inject(Selection).size()).toBe(0);

      press(document.body, 'z');
      expect(appData.week()!.days[0].items).toHaveLength(2);
    });

    it('leaves Ctrl+Z to a field being typed in', () => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      const undo = vi.spyOn(TestBed.inject(AppData), 'undo');
      const field = document.createElement('textarea');
      document.body.append(field);

      press(field, 'z');
      expect(undo).not.toHaveBeenCalled();
      field.remove();
    });
  });
});
