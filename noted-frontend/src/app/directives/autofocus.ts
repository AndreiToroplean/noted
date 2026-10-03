import { Directive, ElementRef, afterNextRender, inject } from '@angular/core';

/** Focus the element once it is on the page — for fields that open where they are needed. */
@Directive({ selector: '[appAutofocus]' })
export class Autofocus {
  constructor() {
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => element.focus());
  }
}
