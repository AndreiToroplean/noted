import { Component, input, output } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';

/**
 * A field between a step back and a step on, for lengths and times of day,
 * which the journal counts in quarter hours. The field is whatever is put
 * inside; the steps only say which way, and by how much.
 *
 * Clicking a step leaves the focus in the field, so an editor that closes when
 * its field loses focus stays open. The keyboard has the field's own arrows.
 */
@Component({
  selector: 'app-stepper',
  imports: [MatIconModule],
  templateUrl: './stepper.html',
  host: { class: 'inline-flex items-center gap-1' },
})
export class Stepper {
  /** Minutes one step moves by. */
  readonly by = input(15);

  readonly stepped = output<number>();
}
