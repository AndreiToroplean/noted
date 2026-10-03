import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';

import { settle } from 'testing/settle';

import { API_BASE } from 'app/services/api';
import { AppData } from 'app/services/app-data';
import { provideDateFormat } from 'app/services/dates';
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
