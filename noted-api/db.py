"""The database: one local SQLite file, created and seeded on first run."""

import sys
import threading
from pathlib import Path

from sqlmodel import Session, SQLModel, create_engine

from seed import seed


def default_path() -> Path:
    """Next to the exe once packaged, so the app is one folder you can carry.

    In development it stays in the gitignored `data/`, beside the code.
    """
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent / "noted.db"
    return Path("data") / "noted.db"


DATABASE_PATH = default_path()

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
