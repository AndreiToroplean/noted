import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { Day as DayColumn } from 'app/components/day/day';
import { Week } from 'app/components/week/week';
import { Day, Week as WeekData } from 'app/services/api';

function day(date: string, entries = 0): Day {
  return {
    date,
    status: 'working',
    arrival: null,
    departure: null,
    expected_minutes: 480,
    items: Array.from({ length: entries }, (_, position) => ({
      id: position,
      position,
      kind: 'task' as const,
      done: false,
      category: null,
      project_id: null,
      text: 'Something',
      note: null,
      explicit_minutes: null,
      explicit_start: null,
      explicit_end: null,
      approx_weight: null,
    })),
  };
}

function week(saturdayEntries = 0, sundayEntries = 0): WeekData {
  return {
    week: '2026-02-09',
    days: [
      day('2026-02-09'),
      day('2026-02-10'),
      day('2026-02-11'),
      day('2026-02-12'),
      day('2026-02-13'),
      day('2026-02-14', saturdayEntries),
      day('2026-02-15', sundayEntries),
    ],
  };
}

function columnsFor(data: WeekData): number {
  const fixture = TestBed.createComponent(Week);
  fixture.componentRef.setInput('week', data);
  fixture.detectChanges();
  return fixture.nativeElement.querySelectorAll('app-day').length;
}

describe('Week', () => {
  it('shows five columns for an ordinary week', () => {
    expect(columnsFor(week())).toBe(5);
  });

  it('shows Saturday once it has something in it', () => {
    expect(columnsFor(week(1))).toBe(6);
  });

  it('shows the whole weekend when both days have content', () => {
    expect(columnsFor(week(1, 2))).toBe(7);
  });

  it('hands each day its neighbours for Tab, coming round at either end', () => {
    const fixture = TestBed.createComponent(Week);
    fixture.componentRef.setInput('week', week(0, 1));
    fixture.detectChanges();
    const days = fixture.debugElement
      .queryAll(By.directive(DayColumn))
      .map(column => column.componentInstance as DayColumn);
    expect(days[0].previousDate()).toBe('2026-02-15');
    expect(days[0].nextDate()).toBe('2026-02-10');
    expect(days.at(-1)!.nextDate()).toBe('2026-02-09');
  });
});
