import { TestBed } from '@angular/core/testing';

import { EntryEditor } from 'app/components/entry-editor/entry-editor';

describe('EntryEditor', () => {
  function render() {
    const fixture = TestBed.createComponent(EntryEditor);
    const submitted: string[] = [];
    let cancelled = 0;
    fixture.componentInstance.submitted.subscribe(text => submitted.push(text));
    fixture.componentInstance.cancelled.subscribe(() => cancelled++);
    fixture.detectChanges();
    const field = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    return { fixture, field, submitted, cancelled: () => cancelled };
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

  it('closes without asking when nothing was typed', () => {
    const { field, cancelled } = render();
    press(field, 'Escape');
    expect(cancelled()).toBe(1);
  });

  it('asks before throwing away what was typed', async () => {
    const { fixture, field, cancelled } = render();
    type(field, '[T] Something');
    press(field, 'Escape');
    await fixture.whenStable();
    expect(cancelled()).toBe(0);

    const discard = document.querySelector('[data-discard]') as HTMLButtonElement;
    expect(discard).not.toBeNull();
    discard.click();
    // The dialog reports its answer once it has finished closing.
    await vi.waitFor(() => expect(cancelled()).toBe(1));
  });

  it('shows why the last attempt was refused', () => {
    const { fixture } = render();
    fixture.componentRef.setInput('error', 'There is no [Zz] category.');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('There is no [Zz] category.');
  });
});
