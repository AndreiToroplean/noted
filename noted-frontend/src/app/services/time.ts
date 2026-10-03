import { Time } from 'app/services/api';

/** `HH:mm` from a wire time — what is shown, and what a time input reads and writes. */
export function clock(time: Time): string {
  return time.slice(0, 5);
}

/** A length the way the journal writes it: `45m`, `1h`, `1h30`. */
export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h${`${rest}`.padStart(2, '0')}` : `${hours}h`;
}
