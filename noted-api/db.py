"""The database: one local SQLite file, created on first run."""

from datetime import time
from pathlib import Path

from sqlmodel import Session, SQLModel, create_engine, select

from models import Settings

DATABASE_PATH = Path("data") / "noted.db"

_engine = None


def engine():
    """The process-wide engine, created on first use.

    Lazy so that tests can point `DATABASE_PATH` at a `tmp_path` before anything
    touches the disk.
    """
    global _engine
    if _engine is None:
        DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
        _engine = create_engine(f"sqlite:///{DATABASE_PATH}")
        SQLModel.metadata.create_all(_engine)
        with Session(_engine) as session:
            seed_settings(session)
    return _engine


def reset():
    """Forget the engine so the next call rebuilds it. For tests."""
    global _engine
    _engine = None


def session():
    with Session(engine()) as s:
        yield s


#: Nine to five, Friday ending at four, the weekend non-working.
DEFAULT_SETTINGS = [
    Settings(
        weekday=weekday,
        arrival=time(9, 0),
        break_start=time(12, 0),
        break_end=time(13, 0),
        departure=time(16, 0) if weekday == 4 else time(17, 0),
        expected_minutes=6 * 60 if weekday == 4 else 7 * 60,
    )
    for weekday in range(5)
] + [Settings(weekday=weekday) for weekday in (5, 6)]


def seed_settings(session: Session):
    """Fill in the default hours, once, leaving any the user has edited alone."""
    known = set(session.exec(select(Settings.weekday)).all())
    for row in DEFAULT_SETTINGS:
        if row.weekday not in known:
            session.add(Settings.model_validate(row))
    session.commit()
