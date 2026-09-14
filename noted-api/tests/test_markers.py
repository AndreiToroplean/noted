import datetime as dt

import importer


def markers(*texts):
    """Read a day whose entries are the given bracketed annotations."""
    return importer.read_markers([importer.parse_entry(t) for t in texts])


def test_the_first_arrow_marker_is_the_arrival():
    assert markers("[-> 9:45]").arrival == dt.time(9, 45)


def test_a_later_arrow_marker_is_the_departure():
    day = markers("[-> 9:45]", "[T] Work.", "[-> 18:45]")
    assert day.arrival == dt.time(9, 45)
    assert day.departure == dt.time(18, 45)


def test_a_lone_arrow_marker_after_work_is_a_departure_not_an_arrival():
    day = markers("[T] Work.", "[-> 18:45]")
    assert day.arrival is None
    assert day.departure == dt.time(18, 45)


def test_a_hash_marker_is_the_noon_break():
    day = markers("[# 45m]")
    assert len(day.breaks) == 1
    assert day.breaks[0].is_noon is True
    assert day.breaks[0].minutes == 45


def test_a_noon_break_can_be_given_as_a_range():
    day = markers("[# 13:00 -> 14:15]")
    assert day.breaks[0].is_noon is True
    assert day.breaks[0].start == dt.time(13, 0)
    assert day.breaks[0].end == dt.time(14, 15)
    assert day.breaks[0].minutes is None


def test_a_bare_duration_is_an_ordinary_break():
    day = markers("[30m]")
    assert day.breaks[0].is_noon is False
    assert day.breaks[0].minutes == 30


def test_a_bare_range_is_an_ordinary_break():
    day = markers("[15:00 -> 15:20]")
    assert day.breaks[0].is_noon is False
    assert day.breaks[0].start == dt.time(15, 0)


def test_a_skipped_noon_break_is_recorded_as_zero():
    # Written `[# 0m (+1h)]` — the hour back is the consequence, not a second
    # instruction, so only the zero is read.
    day = markers("[# 0m (+1h)]")
    assert day.breaks[0].is_noon is True
    assert day.breaks[0].minutes == 0


def test_an_explicit_overtime_override_is_captured_with_its_departure():
    # The legacy parser stopped at the `=>` and lost the departure time. Noted
    # keeps both: the time is real, and the override is what the day was filed as.
    day = markers("[T] Work.", "[-> 19:30 (+1h => +15m)]")
    assert day.departure == dt.time(19, 30)
    assert day.explicit_overtime == 15


def test_a_negative_override_is_negative():
    day = markers("[T] Work.", "[-> 17:30 (-15m => -15m)]")
    assert day.explicit_overtime == -15


def test_an_annotation_that_is_not_about_time_is_left_as_an_entry():
    day = markers("[On site]")
    assert day.breaks == []
    assert day.arrival is None
    assert [e.text for e in day.entries] == ["[On site]"]


def test_time_markers_are_consumed_rather_than_kept_as_entries():
    day = markers("[-> 9:30]", "[T] Work.", "[# 1h]", "[-> 18:30]")
    assert [e.text for e in day.entries] == ["Work."]


def test_a_day_of_only_a_status_marker_takes_that_status():
    assert markers("[PAID HOLIDAY]").status == "paid_holiday"
    assert markers("[SICK DAY]").status == "sick"
    assert markers("[HOLIDAY]").status == "holiday"
    assert markers("[UNPAID OFF]").status == "unpaid"
    assert markers("[OFF]").status == "off"


def test_an_ordinary_day_is_working():
    assert markers("[T] Work.").status == "working"


def test_a_status_word_inside_a_working_day_does_not_change_it():
    # The marker only declares the day when it is the whole day.
    assert markers("[T] Work.", "[Off to the dentist]").status == "working"
