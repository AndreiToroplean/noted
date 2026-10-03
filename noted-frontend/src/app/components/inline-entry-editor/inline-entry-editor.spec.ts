import { TestBed } from '@angular/core/testing';

import {
  EntryText,
  InlineEntryEditor,
} from 'app/components/inline-entry-editor/inline-entry-editor';

describe('InlineEntryEditor', () => {
  function render(value: EntryText, original: EntryText | null = null) {
    const fixture = TestBed.createComponent(InlineEntryEditor);
    fixture.componentRef.setInput('value', value);
    fixture.componentRef.setInput('original', original);
    const saved: EntryText[] = [];
    const closed: EntryText[] = [];
    fixture.componentInstance.saved.subscribe(text => saved.push(text));
    fixture.componentInstance.closed.subscribe(text => closed.push(text));
    document.body.append(fixture.nativeElement);
    fixture.detectChanges();
    const dom = fixture.nativeElement as HTMLElement;
    const text = () => dom.querySelector('[data-edit-text]') as HTMLTextAreaElement;
    const note = () => dom.querySelector('[data-edit-note]') as HTMLTextAreaElement | null;
    return { fixture, dom, text, note, saved, closed };
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

  it('opens on the text and the note, each in its own field, the text focused', async () => {
    const { fixture, text, note } = render({ text: 'Fixed it', note: 'the header' });
    await fixture.whenStable();
    expect(text().value).toBe('Fixed it');
    expect(note()?.value).toBe('the header');
    expect(document.activeElement).toBe(text());
  });

  it('has no note field while there is no note, so nothing moves', () => {
    const { note } = render({ text: 'Fixed it', note: null });
    expect(note()).toBeNull();
  });

  it('goes down to the note on Enter, opening one if there was none', async () => {
    const { fixture, text, note } = render({ text: 'Fixed it', note: null });
    expect(press(text(), 'Enter').defaultPrevented).toBe(true);
    await fixture.whenStable();
    expect(note()).not.toBeNull();
    expect(document.activeElement).toBe(note());
  });

  it('saves both on Ctrl+Enter, an empty note as none', () => {
    const { text, saved } = render({ text: 'Fixed it', note: 'the header' });
    type(text(), 'Fixed the header');
    const note = text().parentElement!.querySelector('[data-edit-note]') as HTMLTextAreaElement;
    type(note, '  ');
    press(text(), 'Enter', true);
    expect(saved).toEqual([{ text: 'Fixed the header', note: null }]);
  });

  it('closes on Esc without asking, handing back what was typed', () => {
    const { text, closed, saved } = render({ text: 'Fixed it', note: null });
    type(text(), 'Fixed it, nearly');
    press(text(), 'Escape');
    expect(closed).toEqual([{ text: 'Fixed it, nearly', note: null }]);
    expect(saved).toEqual([]);
    expect(document.querySelector('mat-dialog-container')).toBeNull();
  });

  it('closes the same way when focus goes elsewhere, but not between its own fields', () => {
    const { text, note, closed } = render({ text: 'Fixed it', note: 'the header' });
    text().dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: note() }));
    expect(closed).toEqual([]);
    text().dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    expect(closed).toEqual([{ text: 'Fixed it', note: 'the header' }]);
  });

  it('says which keys do what, in a hint laid over what is below', () => {
    const { dom } = render({ text: 'Fixed it', note: null });
    const hint = dom.querySelector('.editor-hint');
    expect(hint?.textContent).toContain('Ctrl+Enter');
    expect(hint?.getAttribute('aria-hidden')).toBeNull();
  });

  describe('opened on a draft', () => {
    const draft = { text: 'Fixed it, nearly', note: 'needs a test' };
    const original = { text: 'Fixed it', note: null };

    it('goes back to the entry as saved on Ctrl+Z', () => {
      const { fixture, text, note } = render(draft, original);
      expect(press(text(), 'z', true).defaultPrevented).toBe(true);
      fixture.detectChanges();
      expect(text().value).toBe('Fixed it');
      expect(note()).toBeNull();
    });

    it('brings the draft back on Ctrl+Y or Ctrl+Shift+Z', () => {
      const { fixture, text, note } = render(draft, original);
      press(text(), 'z', true);
      fixture.detectChanges();
      expect(press(text(), 'y', true).defaultPrevented).toBe(true);
      fixture.detectChanges();
      expect(text().value).toBe('Fixed it, nearly');
      expect(note()?.value).toBe('needs a test');

      press(text(), 'z', true);
      fixture.detectChanges();
      press(text(), 'Z', true, true);
      fixture.detectChanges();
      expect(text().value).toBe('Fixed it, nearly');
    });

    it('leaves Ctrl+Z to the field once something has been typed', () => {
      const { fixture, text } = render(draft, original);
      type(text(), 'Fixed it, nearly there');
      fixture.detectChanges();
      expect(press(text(), 'z', true).defaultPrevented).toBe(false);
    });

    it('leaves Ctrl+Z to the field when there was no draft', () => {
      const { text } = render(original);
      expect(press(text(), 'z', true).defaultPrevented).toBe(false);
    });
  });

  it('turns to a break on Ctrl+B while adding, keeping what was typed', () => {
    const fixture = TestBed.createComponent(InlineEntryEditor);
    fixture.componentRef.setInput('value', { text: '', note: null });
    fixture.componentRef.setInput('adding', true);
    const switched: EntryText[] = [];
    fixture.componentInstance.switchToBreak.subscribe(text => switched.push(text));
    fixture.detectChanges();
    const text = fixture.nativeElement.querySelector('[data-edit-text]') as HTMLTextAreaElement;
    type(text, '[T] Half');
    expect(press(text, 'b', true).defaultPrevented).toBe(true);
    expect(switched).toEqual([{ text: '[T] Half', note: null }]);
  });

  it('leaves Ctrl+B alone while editing an entry', () => {
    const { text } = render({ text: 'Fixed it', note: null });
    expect(press(text(), 'b', true).defaultPrevented).toBe(false);
  });
});
