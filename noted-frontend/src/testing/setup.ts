/**
 * Every test runs on the same day: the Sunday of the week the specs are written
 * in, so that week is where the journal opens and the days before today are
 * past, whatever the real date. A test that needs another moment sets its own.
 */
beforeEach(() => {
  vi.setSystemTime(new Date('2026-02-15T12:00'));
});

afterEach(() => {
  vi.useRealTimers();
});
