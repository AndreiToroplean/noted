import datetime as dt

import pytest
from sqlmodel import Session, SQLModel, create_engine, select

import seed
from models import Category, OvertimeBaseline, Settings


@pytest.fixture
def session(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'noted.db'}")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        yield s


def test_seeding_fills_an_empty_database(session):
    content = seed.load()
    seed.seed(session)
    assert len(session.exec(select(Settings)).all()) == len(content.settings)
    assert len(session.exec(select(Category)).all()) == len(content.categories)
    # A new user owes nothing and is owed nothing.
    assert session.exec(select(OvertimeBaseline)).one().minutes == 0


def test_seeding_twice_changes_nothing(session):
    content = seed.load()
    seed.seed(session)
    seed.seed(session)
    assert len(session.exec(select(Settings)).all()) == len(content.settings)
    assert len(session.exec(select(Category)).all()) == len(content.categories)
    assert len(session.exec(select(OvertimeBaseline)).all()) == 1


def test_seeding_leaves_edits_alone(session):
    seed.seed(session)
    friday = session.get(Settings, 4)
    edited = friday.expected_minutes + 30
    friday.expected_minutes = edited
    session.add(friday)
    session.commit()

    seed.seed(session)
    assert session.get(Settings, 4).expected_minutes == edited


def test_seeding_gives_a_category_left_without_a_meaning_its_own(session):
    # Databases seeded before the meanings were written down have them blank.
    session.add(Category(name="T", colour="#7f6000", meaning=""))
    session.add(Category(name="M", colour="#351c75", meaning="Calls"))
    session.commit()

    seed.seed(session)
    assert session.get(Category, "T").meaning == "Ticket"
    assert session.get(Category, "M").meaning == "Calls"


def test_the_shipped_seed_covers_every_weekday(session):
    assert [row.weekday for row in seed.load().settings] == list(range(7))


def test_a_local_seed_is_read_instead_of_the_shipped_one(session, tmp_path, monkeypatch):
    local = tmp_path / "seed-local.toml"
    local.write_text(
        """
        [settings.0]
        arrival = 08:15:00
        departure = 19:45:00
        expected_minutes = 570

        [[categories]]
        name = "W"
        colour = "#123456"
        meaning = "Whatever"
        """,
        encoding="utf-8",
    )
    monkeypatch.setattr(seed, "LOCAL_PATH", local)
    seed.seed(session)

    monday = session.get(Settings, 0)
    assert monday.arrival == dt.time(8, 15)
    assert monday.departure == dt.time(19, 45)
    assert monday.expected_minutes == 570
    # Instead of, not as well as: it is the whole seed, not a list of exceptions.
    assert session.exec(select(Settings)).all() == [monday]
    assert [row.name for row in session.exec(select(Category))] == ["W"]
