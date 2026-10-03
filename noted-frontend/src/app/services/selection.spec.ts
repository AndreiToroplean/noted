import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { AppData } from 'app/services/app-data';
import { Selection } from 'app/services/selection';

const MONDAY = '2026-02-09';
const TUESDAY = '2026-02-10';
const ORDER = ['entry-1', 'break-1', 'entry-2', 'entry-3', 'entry-4'];

describe('Selection', () => {
  let selection: Selection;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    selection = TestBed.inject(Selection);
  });

  function click(key: string, mods: { ctrl?: boolean; shift?: boolean } = {}, date = MONDAY) {
    selection.click(date, key, ORDER, { ctrl: false, shift: false, ...mods });
  }

  function selected() {
    return [...selection.keys()].sort();
  }

  it('selects just what was clicked', () => {
    click('entry-1');
    click('entry-2');
    expect(selected()).toEqual(['entry-2']);
    expect(selection.date()).toBe(MONDAY);
  });

  it('adds and removes one at a time with Ctrl', () => {
    click('entry-1');
    click('entry-3', { ctrl: true });
    expect(selected()).toEqual(['entry-1', 'entry-3']);
    click('entry-1', { ctrl: true });
    expect(selected()).toEqual(['entry-3']);
  });

  it('selects everything between with Shift, breaks included, either way round', () => {
    click('entry-3');
    click('entry-1', { shift: true });
    expect(selected()).toEqual(['break-1', 'entry-1', 'entry-2', 'entry-3']);
  });

  it('moves the end of a Shift range rather than adding to it', () => {
    click('entry-1');
    click('entry-4', { shift: true });
    click('break-1', { shift: true });
    expect(selected()).toEqual(['break-1', 'entry-1']);
  });

  it('adds a range to what is already selected with Ctrl+Shift', () => {
    click('entry-1');
    click('entry-3', { ctrl: true });
    click('entry-4', { ctrl: true, shift: true });
    expect(selected()).toEqual(['entry-1', 'entry-3', 'entry-4']);
  });

  it('keeps to one day: a click in another starts over there', () => {
    click('entry-1');
    click('entry-2', { ctrl: true }, TUESDAY);
    expect(selection.date()).toBe(TUESDAY);
    expect(selected()).toEqual(['entry-2']);
  });

  it('clears', () => {
    click('entry-1');
    selection.clear();
    expect(selected()).toEqual([]);
    expect(selection.has(MONDAY, 'entry-1')).toBe(false);
  });

  it('starts empty on another week', () => {
    click('entry-1');
    TestBed.inject(AppData).selectedWeek.set('2026-02-02');
    expect(selected()).toEqual([]);
  });
});
