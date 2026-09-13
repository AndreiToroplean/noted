/**
 * The shapes the API speaks, and where it lives.
 *
 * These mirror `noted-api/schemas.py`. A week is read and written whole, so
 * entries and breaks carry no id on the way out — their order in the list is
 * their position.
 */

export const API_BASE = 'http://127.0.0.1:8000';

export type DayStatus = 'working' | 'paid_holiday' | 'holiday' | 'unpaid' | 'sick' | 'off';
export type EntryKind = 'task' | 'meta';

/** `HH:mm:ss`. */
export type Time = string;
/** `yyyy-MM-dd`. */
export type IsoDate = string;

export interface Entry {
  id: number;
  position: number;
  kind: EntryKind;
  done: boolean;
  category: string | null;
  project_id: number | null;
  text: string;
  note: string | null;
  explicit_minutes: number | null;
  explicit_start: Time | null;
  explicit_end: Time | null;
  approx_weight: number | null;
}

export interface Break {
  id: number;
  position: number;
  is_noon: boolean;
  description: string | null;
  start: Time | null;
  end: Time | null;
  minutes: number | null;
}

export interface Day {
  date: IsoDate;
  status: DayStatus;
  arrival: Time | null;
  departure: Time | null;
  expected_minutes: number;
  entries: Entry[];
  breaks: Break[];
}

export interface Week {
  week: IsoDate;
  days: Day[];
}

export interface Category {
  name: string;
  meaning: string;
  colour: string;
}

export interface Project {
  id: number;
  path: string;
  colour: string;
  description: string;
  declared_on: IsoDate;
}

/** What the API accepts back: everything except the ids it assigns. */
export interface WeekWrite {
  days: (Omit<Day, 'entries' | 'breaks'> & {
    entries: Omit<Entry, 'id' | 'position'>[];
    breaks: Omit<Break, 'id' | 'position'>[];
  })[];
}

export function toWrite(week: Week): WeekWrite {
  return {
    days: week.days.map(day => ({
      ...day,
      entries: day.entries.map(({ id: _id, position: _position, ...entry }) => entry),
      breaks: day.breaks.map(({ id: _id, position: _position, ...pause }) => pause),
    })),
  };
}

/** `yyyy-MM-dd` in local time — `toISOString` would shift the date across midnight. */
export function isoDate(date: Date): IsoDate {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
