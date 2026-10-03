import { Component } from '@angular/core';

import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';

/** Closes with `true` to throw the draft away; anything else keeps editing. */
@Component({
  selector: 'app-confirm-discard',
  imports: [MatButtonModule, MatDialogModule],
  templateUrl: './confirm-discard.html',
})
export class ConfirmDiscard {}
