import { TestBed } from '@angular/core/testing';

import { EntryEditor } from 'app/components/entry-editor/entry-editor';

describe('EntryEditor', () => {
  function render(initial = '') {
    const fixture = TestBed.createComponent(EntryEditor);
    fixture.componentRef.setInput('initial', initial);
    const submitted: string[] = [];
    const closed: string[] = [];
    let switched = 0;
    fixture.componentInstance.submitted.subscribe(text => submitted.push(text));
    fixture.componentInstance.closed.subscribe(text => closed.push(text));
    fixture.componentInstance.switchToBreak.subscribe(() => switched++);
    document.body.append(fixture.nativeElement);
    fixture.detectChanges();
    const field = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    return { fixture, field, submitted, closed, switched: () => switched };
  }

  function type(field: HTMLTextAreaElement, text: string) {
    field.value = text;
    field.dispatchEvent(new Event('input'));
  }

  function press(field: HTMLTextAreaElement, key: string, ctrlKey = false) {
    const event = new KeyboardEvent('keydown', { key, ctrlKey, cancelable: true });
    field.dispatchEvent(event);
    return event;
  }

  it('is ready to type into as soon as it opens', async () => {
    const { fixture, field } = render();
    await fixture.whenStable();
    expect(document.activeElement).toBe(field);
  });

  it('opens on a draft left earlier', () => {
    expect(render('[T] Half a thought').field.value).toBe('[T] Half a thought');
  });

  it('starts a new line on Enter rather than finishing', () => {
    const { field, submitted } = render();
    type(field, '[T] Something');
    expect(press(field, 'Enter').defaultPrevented).toBe(false);
    expect(submitted).toEqual([]);
  });

  it('finishes on Ctrl+Enter with everything typed, note included', () => {
    const { field, submitted } = render();
    type(field, '[T] Something\nwith a note');
    press(field, 'Enter', true);
    expect(submitted).toEqual(['[T] Something\nwith a note']);
  });

  it('closes on Esc without asking, handing back what was typed', () => {
    const { field, closed } = render();
    type(field, '[T] Something');
    press(field, 'Escape');
    expect(closed).toEqual(['[T] Something']);
    expect(document.querySelector('mat-dialog-container')).toBeNull();
  });

  it('closes the same way when focus goes elsewhere', () => {
    const { field, closed } = render();
    type(field, '[T] Something');
    field.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    expect(closed).toEqual(['[T] Something']);
  });

  it('turns into a break on Ctrl+B without asking', () => {
    const { field, switched } = render();
    type(field, '[T] Something');
    expect(press(field, 'b', true).defaultPrevented).toBe(true);
    expect(switched()).toBe(1);
  });

  it('keeps its focus while a line is being read', () => {
    const { fixture, field } = render();
    fixture.componentRef.setInput('busy', true);
    fixture.detectChanges();
    expect(field.disabled).toBe(false);
    expect(field.readOnly).toBe(true);
  });

  it('shows why the last attempt was refused', () => {
    const { fixture } = render();
    fixture.componentRef.setInput('error', 'There is no [Zz] category.');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('There is no [Zz] category.');
  });
});
