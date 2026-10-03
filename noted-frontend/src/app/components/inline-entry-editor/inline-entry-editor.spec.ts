import { TestBed } from '@angular/core/testing';

import {
  EditorMove,
  EntryText,
  InlineEntryEditor,
} from 'app/components/inline-entry-editor/inline-entry-editor';

describe('InlineEntryEditor', () => {
  function render(
    value: EntryText,
    inputs: { original?: EntryText; adding?: boolean; enterAt?: 'start' | 'end' } = {},
  ) {
    const fixture = TestBed.createComponent(InlineEntryEditor);
    fixture.componentRef.setInput('value', value);
    for (const [name, input] of Object.entries(inputs)) fixture.componentRef.setInput(name, input);
    const saved: EntryText[] = [];
    const closed: EntryText[] = [];
    const moved: EditorMove[] = [];
    const switched: EntryText[] = [];
    fixture.componentInstance.saved.subscribe(text => saved.push(text));
    fixture.componentInstance.closed.subscribe(text => closed.push(text));
    fixture.componentInstance.moved.subscribe(move => moved.push(move));
    fixture.componentInstance.switchToBreak.subscribe(text => switched.push(text));
    document.body.append(fixture.nativeElement);
    fixture.detectChanges();
    const dom = fixture.nativeElement as HTMLElement;
    const field = dom.querySelector('[data-edit-text]') as HTMLTextAreaElement;
    return { fixture, dom, field, saved, closed, moved, switched };
  }

  function type(field: HTMLTextAreaElement, value: string) {
    field.value = value;
    field.dispatchEvent(new Event('input'));
  }

  function press(field: HTMLTextAreaElement, key: string, ctrlKey = false, shiftKey = false) {
    const event = new KeyboardEvent('keydown', {
      key,
      ctrlKey,
      shiftKey,
      cancelable: true,
      bubbles: true,
    });
    field.dispatchEvent(event);
    return event;
  }

  it('opens on the whole entry as one text, the note on the line under it', async () => {
    const { fixture, field } = render({ text: 'Fixed it', note: 'the header' });
    await fixture.whenStable();
    expect(field.value).toBe('Fixed it\nthe header');
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe('Fixed it'.length);
  });

  it('adds a new line on Ctrl+Enter, rather than saving', () => {
    // Typed through the browser's own editing, so Ctrl+Z takes it back; the
    // test browser has none of that to call.
    const insert = vi.fn();
    Object.defineProperty(document, 'execCommand', { value: insert, configurable: true });
    try {
      const { field, saved } = render({ text: 'Fixed it', note: null });
      expect(press(field, 'Enter', true).defaultPrevented).toBe(true);
      expect(insert).toHaveBeenCalledWith('insertText', false, '\n');
      expect(saved).toEqual([]);
    } finally {
      delete (document as { execCommand?: unknown }).execCommand;
    }
  });

  it('saves on Enter, the first line as the entry and the rest as the note', () => {
    const { field, saved } = render({ text: 'Fixed it', note: null });
    type(field, 'Fixed the header \nit was\nthe z-index');
    press(field, 'Enter');
    type(field, 'Fixed the header\n  ');
    press(field, 'Enter');
    expect(saved).toEqual([
      { text: 'Fixed the header', note: 'it was\nthe z-index' },
      { text: 'Fixed the header', note: null },
    ]);
  });

  it('closes on Esc without asking, handing back what was typed', () => {
    const { field, closed, saved } = render({ text: 'Fixed it', note: null });
    type(field, 'Fixed it, nearly');
    press(field, 'Escape');
    expect(closed).toEqual([{ text: 'Fixed it, nearly', note: null }]);
    expect(saved).toEqual([]);
  });

  it('closes the same way when focus goes elsewhere', () => {
    const { field, closed } = render({ text: 'Fixed it', note: 'the header' });
    field.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    expect(closed).toEqual([{ text: 'Fixed it', note: 'the header' }]);
  });

  it('says which keys do what, in a hint laid over what is below', () => {
    const { dom } = render({ text: 'Fixed it', note: null });
    expect(dom.querySelector('.editor-hint')?.textContent).toContain('Ctrl+Enter');
  });

  describe('opened on a draft', () => {
    const draft = { text: 'Fixed it, nearly', note: 'needs a test' };
    const original = { text: 'Fixed it', note: null };

    it('goes back to the entry as saved on Ctrl+Z, and to the draft on Ctrl+Y', () => {
      const { fixture, field } = render(draft, { original });
      expect(press(field, 'z', true).defaultPrevented).toBe(true);
      fixture.detectChanges();
      expect(field.value).toBe('Fixed it');

      expect(press(field, 'y', true).defaultPrevented).toBe(true);
      fixture.detectChanges();
      expect(field.value).toBe('Fixed it, nearly\nneeds a test');
    });

    it('leaves Ctrl+Z to the field once something has been typed', () => {
      const { fixture, field } = render(draft, { original });
      type(field, 'Fixed it, nearly there');
      fixture.detectChanges();
      expect(press(field, 'z', true).defaultPrevented).toBe(false);
    });

    it('leaves Ctrl+Z to the field when there was no draft', () => {
      const { field } = render(original);
      expect(press(field, 'z', true).defaultPrevented).toBe(false);
    });
  });

  it('turns to a break on Ctrl+B while adding, and leaves it alone otherwise', () => {
    const adding = render({ text: '', note: null }, { adding: true });
    type(adding.field, '[T] Half');
    expect(press(adding.field, 'b', true).defaultPrevented).toBe(true);
    expect(adding.switched).toEqual([{ text: '[T] Half', note: null }]);

    const editing = render({ text: 'Fixed it', note: null });
    expect(press(editing.field, 'b', true).defaultPrevented).toBe(false);
  });

  // The test DOM lays nothing out, so every caret is on a first and last line.
  describe('moving on', () => {
    it('goes to the entry above on Up, and below on Down, with what was typed', () => {
      const { field, moved } = render({ text: 'Fixed it', note: null });
      type(field, 'Fixed it, nearly');
      expect(press(field, 'ArrowUp').defaultPrevented).toBe(true);
      press(field, 'ArrowDown');
      expect(moved).toEqual([
        { to: 'up', typed: { text: 'Fixed it, nearly', note: null } },
        { to: 'down', typed: { text: 'Fixed it, nearly', note: null } },
      ]);
    });

    it('goes to the next day on Tab, and the one before on Shift+Tab', () => {
      const { field, moved } = render({ text: 'Fixed it', note: null });
      expect(press(field, 'Tab').defaultPrevented).toBe(true);
      press(field, 'Tab', false, true);
      expect(moved.map(move => move.to)).toEqual(['next-day', 'previous-day']);
    });

    it('leaves Shift and Ctrl arrows to the field', () => {
      const { field, moved } = render({ text: 'Fixed it', note: null });
      press(field, 'ArrowUp', false, true);
      press(field, 'ArrowDown', true);
      expect(moved).toEqual([]);
    });

    it('opens at the very start from above, and the very end from below', async () => {
      const above = render({ text: 'Fixed it', note: 'the header' }, { enterAt: 'start' });
      await above.fixture.whenStable();
      expect(above.field.selectionStart).toBe(0);

      const below = render({ text: 'Fixed it', note: 'the header' }, { enterAt: 'end' });
      await below.fixture.whenStable();
      expect(below.field.selectionStart).toBe(below.field.value.length);
    });
  });
});
