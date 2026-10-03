import { Time } from 'app/services/api';

/** `HH:mm` from a wire time — what is shown, and what a time input reads and writes. */
export function clock(time: Time): string {
  return time.slice(0, 5);
}

/** An `HH:mm` moved by some minutes, round the clock either way. */
export function shiftClock(at: string, minutes: number): string {
  const [hours, rest] = at.split(':').map(Number);
  const total = (((hours * 60 + rest + minutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** The time now, plus some minutes, as `HH:mm`. */
export function now(plus = 0): string {
  const at = new Date(Date.now() + plus * 60_000);
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function pad(value: number): string {
  return `${value}`.padStart(2, '0');
}

/** A length the way the journal writes it: `45m`, `1h`, `1h30`. */
export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h${`${rest}`.padStart(2, '0')}` : `${hours}h`;
}
