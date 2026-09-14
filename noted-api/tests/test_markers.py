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


def test_a_signed_duration_is_a_break():
    # `[-15m]` is how most breaks are written: the sign is the direction of its
    # effect on the day's overtime, not part of the length.
    day = markers("[-15m]")
    assert day.breaks[0].is_noon is False
    assert day.breaks[0].minutes == 15


def test_a_signed_hour_break_is_read_whole():
    assert markers("[-1h15]").breaks[0].minutes == 75
    assert markers("[-1h]").breaks[0].minutes == 60
    assert markers("[-2h30]").breaks[0].minutes == 150


def test_a_day_adds_up_the_way_it_was_written():
    # A day filed as -30m:
    #   lunch 1h30 is 30m more than the standard hour   -30
    #   a 15m break                                     -15
    #   leaving 15m later than the usual time            +15
    day = markers("[T] Work.", "[# 1h30 (-30m)]", "[-15m]", "[-> 18:45 (+15m => -30m)]")
    assert day.departure == dt.time(18, 45)
    assert day.explicit_overtime == -30
    assert [(p.is_noon, p.minutes) for p in day.breaks] == [(True, 90), (False, 15)]


def test_a_break_keeps_what_was_written_about_it():
    day = markers("[# Lunch w/ the team]")
    assert day.breaks[0].is_noon is True
    assert day.breaks[0].description == "Lunch w/ the team"
    # No length was given, so it was the usual hour.
    assert day.breaks[0].minutes == 60


def test_a_break_with_both_a_length_and_a_note_keeps_both():
    day = markers("[# 45m out for a coffee]")
    assert day.breaks[0].minutes == 45
    assert day.breaks[0].description == "out for a coffee"


def test_an_override_survives_a_space_after_its_sign():
    assert markers("[T] Work.", "[-> 22:45 (+ 2h15 => + 2h)]").explicit_overtime == 120


def test_an_unsigned_daytime_break_still_subtracts():
    # The sign is meaningful — `-30m` removes overtime. Small daytime breaks
    # were sometimes written without it, and they are never additive, so both
    # spellings mean the same thing.
    assert markers("[30m]").breaks[0].minutes == markers("[-30m]").breaks[0].minutes


def test_a_time_marker_that_cannot_be_read_is_reported_not_dropped():
    # A silently ignored marker is how breaks went missing once already.
    day = markers("[T] Work.", "[+45m]")
    assert day.unread == ["[+45m]"]


def test_an_annotation_with_no_time_in_it_is_not_reported_as_unread():
    assert markers("[On site]").unread == []


def test_a_described_deduction_is_a_break_that_says_why():
    day = markers("[Errand in town (-1h45)]")
    assert day.breaks[0].minutes == 105
    assert day.breaks[0].is_noon is False
    assert day.breaks[0].description == "Errand in town"


def test_a_deduction_with_no_description_is_still_a_break():
    day = markers("[(-30m)]")
    assert day.breaks[0].minutes == 30
    assert day.breaks[0].description is None


def test_a_described_deduction_leaves_nothing_unread():
    assert markers("[Tidy the desk (-30m)]").unread == []


def test_a_markers_parenthesised_figure_is_not_a_description():
    # `(+30m)` is what the marker did to the day, not a note about the break.
    day = markers("[# 30m (+30m)]")
    assert day.breaks[0].minutes == 30
    assert day.breaks[0].description is None


def test_each_marker_records_what_it_was_read_as():
    # The conflict prompt shows the column as written; to choose, the owner has
    # to see what each line was taken to mean.
    day = markers("[-> 9:45]", "[T] Work.", "[# 1h30]", "[-> 18:45 (+15m => -30m)]")
    assert day.reading == [
        ("[-> 9:45]", "arrived 09:45"),
        ("[# 1h30]", "lunch, 1h30"),
        ("[-> 18:45 (+15m => -30m)]", "day filed as -30m, left 18:45, written as +15m"),
    ]


def test_a_marker_that_was_not_read_says_so():
    day = markers("[T] Work.", "[+45m]")
    assert day.reading == [("[+45m]", "not read")]


def test_a_marker_reports_the_figure_it_was_written_with():
    # The written contributions should add up to the day's `=>`. Showing each
    # one is what makes a disagreement decidable.
    day = markers("[# 1h15 (-15m)]")
    assert day.reading == [("[# 1h15 (-15m)]", "lunch, 1h15, written as -15m")]


def test_the_figures_written_on_the_markers_are_added_up():
    # Here the parts say -15m while the day was filed as +1h. Showing the
    # sum is what explains a disagreement.
    day = markers("[-> 9:45 (-15m)]", "[# 30m (+30m)]", "[-1h]", "[-> 19:00 (+30m => +1h)]")
    assert day.stated == [-15, 30, 30]
    assert day.explicit_overtime == 60


def test_arrival_is_still_arrival_after_a_plain_annotation():
    # A day opening with `[Back from a week away]`
    # before the clock. What makes a marker the arrival is that no work has been
    # done yet, not that nothing at all has been written.
    day = markers(
        "[Back from a week away]",
        "[-> 9:45]",
        "[C] Catch up on email.",
        "[-> 18:45]",
    )
    assert day.arrival == dt.time(9, 45)
    assert day.departure == dt.time(18, 45)


def test_arrival_can_follow_several_annotations():
    day = markers("[On site]", "[In the other office]", "[-> 10:15]", "[T] Work.")
    assert day.arrival == dt.time(10, 15)


def test_an_arrow_after_the_first_task_is_a_departure():
    # The rule has to still close: once work has started, a clock is the end of
    # the day, however many annotations follow it.
    day = markers("[T] Work.", "[-> 18:45]", "[Back home]")
    assert day.arrival is None
    assert day.departure == dt.time(18, 45)


def test_a_ranged_break_can_state_its_own_length():
    # `[19:30 -> 23:15 (-3h45)]` — the way an evening away from the desk should
    # be written, rather than closing the day and reopening it with a second
    # arrival. The bounds are the truth; the figure is the owner checking them.
    day = markers("[T] Work.", "[19:30 -> 23:15 (-3h45)]", "[T] Night work.")
    assert len(day.breaks) == 1
    pause = day.breaks[0]
    assert pause.is_noon is False
    assert (pause.start, pause.end) == (dt.time(19, 30), dt.time(23, 15))
    assert day.stated == [-225]
    assert day.unread == []


def test_a_ranged_break_is_its_span_long():
    # 09:45 to 02:45 is 17h present, less the 3h45 away.
    day = markers("[T] Work.", "[19:30 -> 23:15 (-3h45)]")
    assert importer.worked_minutes(day, dt.time(9, 45), dt.time(2, 45)) == 13 * 60 + 15


def test_a_break_running_past_midnight_is_still_time_away():
    # The day already knows it can end after midnight, and so can a break in it.
    # Subtracting a negative span would have handed back four hours of work.
    day = markers("[T] Work.", "[23:30 -> 0:30]")
    assert importer.worked_minutes(day, dt.time(9, 30), dt.time(3, 30)) == 17 * 60
