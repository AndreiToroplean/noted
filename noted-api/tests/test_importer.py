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


def test_a_reset_rebuilds_the_tables_it_owns(tmp_path):
    # A database written before a column existed must not survive a `--reset`:
    # emptying the rows leaves the old shape behind, and the next insert fails.
    from sqlalchemy import inspect
    from sqlmodel import Session, SQLModel, create_engine

    import models

    engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    stale = list(SQLModel.metadata.tables["day"].columns.keys())[-1]
    SQLModel.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.exec_driver_sql(f"ALTER TABLE day DROP COLUMN {stale}")

    with Session(engine) as session:
        importer.wipe(session)

    assert stale in {column["name"] for column in inspect(engine).get_columns("day")}


def test_a_reset_keeps_what_the_importer_does_not_own(tmp_path):
    # Settings and categories are the owner's, not the spreadsheet's.
    from sqlmodel import Session, SQLModel, create_engine, select

    import models
    import seed

    engine = create_engine(f"sqlite:///{tmp_path / 'db.db'}")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        seed.seed(session)
        kept = session.exec(select(models.Category)).all()
        assert kept, "the seed should have put categories there"
        importer.wipe(session)
        assert [row.name for row in session.exec(select(models.Category))] == [
            row.name for row in kept
        ]


def rows_of(*cells):
    """A sheet's rows, with the given cells down one day's column."""
    width = importer.DAY_COLUMNS[0] + 1
    header = [[""] * width for _ in range(importer.FIRST_ENTRY_ROW)]
    return header + [[""] * (width - 1) + [cell] for cell in cells]


def column_of(*cells):
    return importer.read_column(rows_of(*cells), importer.DAY_COLUMNS[0])


def test_a_gap_between_entries_is_read_as_a_marker():
    entries, _, _ = column_of("[T] Morning.", "", "[T] Afternoon.")
    assert [entry.kind for entry in entries] == ["task", importer.GAP, "task"]


def test_the_empty_rows_around_a_day_are_not_gaps():
    # A column is mostly empty: the rows below the last entry, and above the
    # first on a day that starts late, are spreadsheet rather than lunch.
    entries, _, _ = column_of("", "[T] Work.", "", "")
    assert [entry.kind for entry in entries] == ["task"]


def test_several_blank_rows_in_a_row_are_one_gap():
    entries, _, _ = column_of("[T] Morning.", "", "", "[T] Afternoon.")
    assert [entry.kind for entry in entries] == ["task", importer.GAP, "task"]
