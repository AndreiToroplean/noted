"""The database a new user starts from.

Some of Noted's data is not the user's work but the ground it stands on: the
default hours for each weekday, the category vocabulary, and the point the
overtime total counts from. That content belongs in version control, while the
database holding the actual journal never does — `data/` is gitignored.

So it lives as data, in `seed.toml` beside this file, and this reads it.
`seed()` runs automatically the first time the app opens the database, and can
be run by hand to build a fresh one:

    python seed.py

It only ever fills in what is missing. Anything the user has edited is left
exactly as it is, so running it again is safe and never overwrites real data.

A gitignored `seed-local.toml` beside the database is read *instead* of
`seed.toml`, whole: a replacement rather than a list of exceptions, so there is
nothing to merge and no second format to learn.
"""

import sys
import tomllib
from pathlib import Path
from typing import NamedTuple

from sqlmodel import Session, select

from models import Category, OvertimeBaseline, Settings


def shipped_path() -> Path:
    """`seed.toml`, which travels inside the exe once packaged."""
    bundle = getattr(sys, "_MEIPASS", None)
    return Path(bundle) / "seed.toml" if bundle else Path(__file__).with_name("seed.toml")


def local_path() -> Path:
    """A replacement seed, beside the exe as the database is. Gitignored."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent / "seed-local.toml"
    return Path(__file__).with_name("seed-local.toml")


SHIPPED_PATH = shipped_path()
LOCAL_PATH = local_path()


class Content(NamedTuple):
    """What a new database is filled with."""

    settings: list[Settings]
    categories: list[Category]


def load() -> Content:
    """Read the seed: the local replacement if there is one, else the shipped one."""
    path = LOCAL_PATH if LOCAL_PATH.exists() else SHIPPED_PATH
    with path.open("rb") as handle:
        raw = tomllib.load(handle)
    return Content(
        settings=[
            Settings(weekday=int(weekday), **row)
            for weekday, row in sorted(raw["settings"].items())
        ],
        categories=[Category(**row) for row in raw["categories"]],
    )


def seed(session: Session):
    """Fill in everything a new database needs, leaving edits untouched."""
    content = load()

    known_weekdays = set(session.exec(select(Settings.weekday)).all())
    for row in content.settings:
        if row.weekday not in known_weekdays:
            session.add(Settings.model_validate(row))

    known_categories = {row.name: row for row in session.exec(select(Category))}
    for row in content.categories:
        known = known_categories.get(row.name)
        if known is None:
            session.add(Category.model_validate(row))
        elif not known.meaning:
            # Seeded before the meanings were written down: blank is missing, not an edit.
            known.meaning = row.meaning
            session.add(known)

    # A new user owes nothing and is owed nothing.
    if session.get(OvertimeBaseline, OvertimeBaseline.ROW_ID) is None:
        session.add(OvertimeBaseline())

    session.commit()


if __name__ == "__main__":
    import db

    with Session(db.engine()) as opened:
        seed(opened)
    print(f"Seeded {db.DATABASE_PATH}.")
