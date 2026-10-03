"""The database: one local SQLite file, created and seeded on first run."""

import threading
from pathlib import Path

from sqlmodel import Session, SQLModel, create_engine

from seed import seed


DATABASE_PATH = Path("data") / "noted.db"

_engine = None
_engine_lock = threading.Lock()


def engine():
    """The process-wide engine, created on first use.

    Lazy so that tests can point `DATABASE_PATH` at a `tmp_path` before anything
    touches the disk.
    """
    global _engine
    # Requests arrive together on a fresh database; only one may create it.
    with _engine_lock:
        if _engine is None:
            DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
            _engine = create_engine(f"sqlite:///{DATABASE_PATH}")
            SQLModel.metadata.create_all(_engine)
            with Session(_engine) as session:
                seed(session)
    return _engine


def reset():
    """Forget the engine so the next call rebuilds it. For tests."""
    global _engine
    _engine = None


def session():
    with Session(engine()) as s:
        yield s
