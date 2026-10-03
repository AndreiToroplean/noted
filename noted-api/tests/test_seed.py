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
    seed.seed(session)
    assert len(session.exec(select(Settings)).all()) == len(seed.SETTINGS)
    assert len(session.exec(select(Category)).all()) == len(seed.CATEGORIES)
    # A new user owes nothing and is owed nothing.
    assert session.exec(select(OvertimeBaseline)).one().minutes == 0


def test_seeding_twice_changes_nothing(session):
    seed.seed(session)
    seed.seed(session)
    assert len(session.exec(select(Settings)).all()) == len(seed.SETTINGS)
    assert len(session.exec(select(Category)).all()) == len(seed.CATEGORIES)
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
