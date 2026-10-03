import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Stepper } from 'app/components/stepper/stepper';

@Component({
  imports: [Stepper],
  template: `<app-stepper (stepped)="steps.push($event)"><input data-field /></app-stepper>`,
})
class Host {
  readonly steps: number[] = [];
}

describe('Stepper', () => {
  function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const dom = fixture.nativeElement as HTMLElement;
    const button = (which: string) => dom.querySelector(`[data-${which}]`) as HTMLButtonElement;
    return { fixture, dom, button };
  }

  it('wraps the field between a step back and a step on, a quarter hour each', () => {
    const { fixture, dom, button } = render();
    expect(dom.querySelector('app-stepper [data-field]')).not.toBeNull();
    button('less').click();
    button('more').click();
    expect(fixture.componentInstance.steps).toEqual([-15, 15]);
  });

  it('leaves the focus in the field when a step is clicked', () => {
    const { button } = render();
    const press = new MouseEvent('mousedown', { cancelable: true });
    button('more').dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    expect(button('more').tabIndex).toBe(-1);
  });
});
