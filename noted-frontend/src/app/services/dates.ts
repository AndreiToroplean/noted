import { DATE_PIPE_DEFAULT_OPTIONS } from '@angular/common';
import { Provider } from '@angular/core';

/**
 * How every date in the app is written, French style. One place on purpose:
 * it is what a user preference will replace. Use `| date` with no format, or
 * an injected `DatePipe`, and this is what comes out.
 */
export const DATE_FORMAT = 'dd/MM/yyyy';

export function provideDateFormat(): Provider {
  return { provide: DATE_PIPE_DEFAULT_OPTIONS, useValue: { dateFormat: DATE_FORMAT } };
}
