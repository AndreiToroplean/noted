/**
 * The shapes the API speaks, and where it lives.
 *
 * These mirror `noted-api/schemas.py`. A week is read and written whole, so a
 * day's items carry no id on the way out — their order in the list is their
 * position.
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
  /** Not stored. It is what tells a break from an entry in a day's item list. */
  kind: 'break';
  is_noon: boolean;
  description: string | null;
  start: Time | null;
  end: Time | null;
  minutes: number | null;
}

/** A break as an editor hands it over: everything but the ids the server assigns. */
export type BreakDraft = Omit<Break, 'id' | 'position'>;

/**
 * One thing in a day, in the order it happened. Lunch sits between the
 * morning's work and the afternoon's, so entries and breaks share one list.
 */
export type DayItem = Entry | Break;

export function isBreak(item: DayItem): item is Break {
  return item.kind === 'break';
}

/**
 * An arrow, `[-> 9:15]`, as the API reads it. Whether it is the arrival or the
 * departure depends on where in the day it was written, so the client decides.
 */
export interface Clock {
  kind: 'clock';
  time: Time;
}

/** What `POST /parse` makes of a typed line. */
export type ParsedItem = Omit<Entry, 'id' | 'position'> | Omit<Break, 'id' | 'position'> | Clock;

export interface Day {
  date: IsoDate;
  status: DayStatus;
  arrival: Time | null;
  departure: Time | null;
  expected_minutes: number;
  items: DayItem[];
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
  days: (Omit<Day, 'items'> & {
    items: (Omit<Entry, 'id' | 'position'> | Omit<Break, 'id' | 'position'>)[];
  })[];
}

export function toWrite(week: Week): WeekWrite {
  return {
    days: week.days.map(day => ({
      ...day,
      items: day.items.map(({ id: _id, position: _position, ...item }) => item),
    })),
  };
}

/** `yyyy-MM-dd` in local time — `toISOString` would shift the date across midnight. */
export function isoDate(date: Date): IsoDate {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
