import datetime as dt

import importer


def parse(text):
    return importer.parse_entry(text)


def test_a_plain_entry_is_a_task():
    entry = parse("[T] Work on caching.")
    assert entry.kind == "task"
    assert entry.category == "T"
    assert entry.text == "Work on caching."
    assert entry.project is None


def test_an_entry_can_have_no_category():
    entry = parse("Tidy the desk.")
    assert entry.category is None
    assert entry.text == "Tidy the desk."


def test_a_project_prefix_is_lifted_out_of_the_text():
    entry = parse("[T] webApp: Fix the header.")
    assert entry.project == "webApp"
    assert entry.text == "Fix the header."


def test_a_declaration_marks_the_project_new_and_drops_the_plus():
    entry = parse("[T] +webApp: Start the rewrite.")
    assert entry.project == "webApp"
    assert entry.declares is True


def test_a_subproject_declares_only_its_last_segment():
    entry = parse("[T] refactor.+A: Split the module.")
    assert entry.project == "refactor.A"
    assert entry.declares is True


def test_an_existing_subproject_is_not_a_declaration():
    entry = parse("[T] refactor.A: Keep going.")
    assert entry.project == "refactor.A"
    assert entry.declares is False


def test_a_bracket_only_entry_is_meta():
    assert parse("[On site]").kind == "meta"
    assert parse("[9:30]").kind == "meta"
    assert parse("[T] Real work.").kind == "task"


def test_a_second_line_becomes_the_note():
    entry = parse("[M] Standup.\nWent long, we argued about caching.")
    assert entry.text == "Standup."
    assert entry.note == "Went long, we argued about caching."


def test_a_colon_in_prose_is_not_a_project():
    entry = parse("[T] Note to self: this is not a project.")
    assert entry.project is None
    assert entry.text == "Note to self: this is not a project."


def test_sheet_names_are_read_as_the_weeks_monday():
    assert importer.sheet_date("070926") == dt.date(2026, 9, 7)
    assert importer.sheet_date("310826") == dt.date(2026, 8, 31)


def test_a_template_sheet_is_not_a_week():
    assert importer.sheet_date("TEMPLATE") is None
    assert importer.sheet_date("TEMPLATE_SIMPLE_WE") is None
