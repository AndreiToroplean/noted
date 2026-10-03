import { TestBed } from '@angular/core/testing';

import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { PickWeek, PickWeekData } from 'app/components/pick-week/pick-week';
import { provideDateFormat } from 'app/services/dates';

describe('PickWeek', () => {
  function render(data: PickWeekData) {
    const closed: unknown[] = [];
    TestBed.configureTestingModule({
      providers: [
        provideDateFormat(),
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close: (value: unknown) => closed.push(value) } },
      ],
    });
    const fixture = TestBed.createComponent(PickWeek);
    fixture.detectChanges();
    const dom = fixture.nativeElement as HTMLElement;
    const press = (key: string) => {
      dom.querySelector('[data-pick-week]')!.dispatchEvent(new KeyboardEvent('keydown', { key }));
      fixture.detectChanges();
    };
    return { dom, press, closed, fixture };
  }

  it('opens on the week it was given, named by its Monday', () => {
    const { dom } = render({ start: '2026-02-16', existing: [] });
    expect(dom.querySelector('[data-week]')?.textContent?.trim()).toBe('16/02/2026');
  });

  it('moves a week at a time with the arrow keys and takes it on Enter', () => {
    const { press, closed } = render({ start: '2026-02-16', existing: [] });
    press('ArrowRight');
    press('ArrowRight');
    press('ArrowLeft');
    press('Enter');
    expect(closed).toEqual(['2026-02-23']);
  });

  it('moves with the buttons too', () => {
    const { dom, fixture, press, closed } = render({ start: '2026-02-16', existing: [] });
    (dom.querySelector('[data-earlier]') as HTMLElement).click();
    fixture.detectChanges();
    press('Enter');
    expect(closed).toEqual(['2026-02-09']);
  });

  it('says when the week is already in the journal', () => {
    const { dom, press } = render({ start: '2026-02-16', existing: ['2026-02-09'] });
    expect(dom.textContent).not.toContain('already');
    press('ArrowLeft');
    expect(dom.textContent).toContain('already');
  });
});
