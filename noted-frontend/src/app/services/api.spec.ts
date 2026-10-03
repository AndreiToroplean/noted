import { addWeeks, mondayOf } from 'app/services/api';

describe('week arithmetic', () => {
  it('finds the Monday of any day, Sunday included', () => {
    expect(mondayOf(new Date(2026, 1, 11))).toBe('2026-02-09');
    expect(mondayOf(new Date(2026, 1, 15))).toBe('2026-02-09');
    expect(mondayOf(new Date(2026, 1, 9))).toBe('2026-02-09');
  });

  it('moves by whole weeks across months and years', () => {
    expect(addWeeks('2026-12-28', 1)).toBe('2027-01-04');
    expect(addWeeks('2026-03-02', -1)).toBe('2026-02-23');
  });
});
