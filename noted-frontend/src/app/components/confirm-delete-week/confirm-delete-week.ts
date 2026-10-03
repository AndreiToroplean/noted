import { DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';

import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';

import { IsoDate } from 'app/services/api';

/**
 * Deleting a week is the one deletion that can't be undone, so it always asks,
 * and Cancel is where focus starts. Closes with `true` to delete.
 */
@Component({
  selector: 'app-confirm-delete-week',
  imports: [DatePipe, MatButtonModule, MatDialogModule],
  templateUrl: './confirm-delete-week.html',
})
export class ConfirmDeleteWeek {
  protected readonly week = inject<IsoDate>(MAT_DIALOG_DATA);
}
