import { shiftClock } from 'app/services/time';

describe('shiftClock', () => {
  it('moves a time by minutes, round the clock either way', () => {
    expect(shiftClock('09:30', 15)).toBe('09:45');
    expect(shiftClock('09:00', -15)).toBe('08:45');
    expect(shiftClock('23:50', 15)).toBe('00:05');
    expect(shiftClock('00:05', -15)).toBe('23:50');
  });
});
