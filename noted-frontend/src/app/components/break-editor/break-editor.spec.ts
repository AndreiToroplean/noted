import { TestBed } from '@angular/core/testing';

import { BreakEditor } from 'app/components/break-editor/break-editor';
import { Break, BreakDraft } from 'app/services/api';

describe('BreakEditor', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 1, 9, 10, 7));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function render(initial: Break | null = null) {
    const fixture = TestBed.createComponent(BreakEditor);
    if (initial) fixture.componentRef.setInput('initial', initial);
    const submitted: BreakDraft[] = [];
    let cancelled = 0;
    let switched = 0;
    fixture.componentInstance.submitted.subscribe(draft => submitted.push(draft));
    fixture.componentInstance.cancelled.subscribe(() => cancelled++);
    fixture.componentInstance.switchToEntry.subscribe(() => switched++);
    fixture.detectChanges();
    const dom = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      dom,
      submitted,
      cancelled: () => cancelled,
      switched: () => switched,
      press(key: string, ctrlKey = false) {
        dom
          .querySelector('[data-break-editor]')!
          .dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey, bubbles: true }));
        fixture.detectChanges();
      },
      click(selector: string) {
        (dom.querySelector(selector) as HTMLElement).click();
        fixture.detectChanges();
      },
      input(selector: string): HTMLInputElement {
        return dom.querySelector(selector) as HTMLInputElement;
      },
    };
  }

  it('starts as a quarter of an hour', () => {
    const { press, submitted } = render();
    press('Enter', true);
    expect(submitted).toEqual([
      { kind: 'break', is_noon: false, description: null, start: null, end: null, minutes: 15 },
    ]);
  });

  it('steps the length by a quarter of an hour, and not below one', () => {
    const { click, press, submitted } = render();
    click('[data-more]');
    click('[data-more]');
    click('[data-less]');
    press('Enter', true);
    expect(submitted[0].minutes).toBe(30);

    const second = render();
    second.click('[data-less]');
    second.press('Enter', true);
    expect(second.submitted[0].minutes).toBe(15);
  });

  it('can be a span instead, from now to a quarter of an hour on', () => {
    const { click, input, press, submitted } = render();
    click('[data-mode-range]');
    expect(input('[data-start]').value).toBe('10:07');
    expect(input('[data-end]').value).toBe('10:22');
    press('Enter', true);
    expect(submitted[0]).toMatchObject({ start: '10:07:00', end: '10:22:00', minutes: null });
  });

  it('refuses a span that ends before it starts', () => {
    const { click, input, press, submitted, dom } = render();
    click('[data-mode-range]');
    const end = input('[data-end]');
    end.value = '09:00';
    end.dispatchEvent(new Event('input'));
    press('Enter', true);
    expect(submitted).toEqual([]);
    expect(dom.textContent).toContain('ends before it starts');
  });

  it('can be lunch, with a word about it', () => {
    const { click, input, press, submitted } = render();
    click('[data-noon]');
    const description = input('[data-description]');
    description.value = 'with the team';
    description.dispatchEvent(new Event('input'));
    press('Enter', true);
    expect(submitted[0]).toMatchObject({ is_noon: true, description: 'with the team' });
  });

  it('goes back to typing an entry on Ctrl+B', () => {
    const { press, switched } = render();
    press('b', true);
    expect(switched()).toBe(1);
  });

  it('closes without asking when nothing was changed', () => {
    const { press, cancelled } = render();
    press('Escape');
    expect(cancelled()).toBe(1);
  });

  it('opens on an existing break', () => {
    const { input, press, submitted } = render({
      id: 3,
      position: 2,
      kind: 'break',
      is_noon: true,
      description: null,
      start: '12:30:00',
      end: '13:30:00',
      minutes: null,
    });
    expect(input('[data-start]').value).toBe('12:30');
    press('Enter', true);
    expect(submitted[0]).toMatchObject({ is_noon: true, start: '12:30:00', end: '13:30:00' });
  });
});
