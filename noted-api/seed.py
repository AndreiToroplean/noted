"""The database a new user starts from.

Some of Noted's data is not the user's work but the ground it stands on: the
default hours for each weekday, the category vocabulary, and the point the
overtime total counts from. That content belongs in version control, while the
database holding the actual journal never does — `data/` is gitignored.

So it lives here as code. `seed()` runs automatically the first time the app
opens the database, and can be run by hand to build a fresh one:

    python seed.py

It only ever fills in what is missing. Anything the user has edited is left
exactly as it is, so running it again is safe and never overwrites real data.
"""

import datetime as dt

from sqlmodel import Session, select

from models import Category, OvertimeBaseline, Settings

#: Nine to five, Friday ending at four, the weekend non-working.
SETTINGS = [
    Settings(
        weekday=weekday,
        arrival=dt.time(9, 0),
        break_start=dt.time(12, 0),
        break_end=dt.time(13, 0),
        departure=dt.time(16, 0) if weekday == 4 else dt.time(17, 0),
        expected_minutes=6 * 60 if weekday == 4 else 7 * 60,
    )
    for weekday in range(5)
] + [Settings(weekday=weekday) for weekday in (5, 6)]

#: The vocabulary the spreadsheet used, with the colours its conditional
#: formatting gave each tag. The meanings lived in the owner's head, so they
#: start empty and are his to fill in. `Tr` was used but never coloured, so it
#: takes the plain checkbox surface.
CATEGORIES = [
    Category(name="T", colour="#7f6000"),
    Category(name="M", colour="#351c75"),
    Category(name="C", colour="#104769"),
    Category(name="L", colour="#2e3f49"),
    Category(name="K", colour="#002f35"),
    Category(name="R", colour="#40701c"),
    Category(name="CR", colour="#974845"),
    Category(name="Co", colour="#9c894d"),
    Category(name="S", colour="#6fb373"),
    Category(name="D", colour="#000000"),
    Category(name="Tr", colour="#2c2115"),
]


def seed(session: Session):
    """Fill in everything a new database needs, leaving edits untouched."""
    known_weekdays = set(session.exec(select(Settings.weekday)).all())
    for row in SETTINGS:
        if row.weekday not in known_weekdays:
            session.add(Settings.model_validate(row))

    known_categories = set(session.exec(select(Category.name)).all())
    for row in CATEGORIES:
        if row.name not in known_categories:
            session.add(Category.model_validate(row))

    # A new user owes nothing and is owed nothing.
    if session.get(OvertimeBaseline, OvertimeBaseline.ROW_ID) is None:
        session.add(OvertimeBaseline())

    session.commit()


if __name__ == "__main__":
    import db

    with Session(db.engine()) as opened:
        seed(opened)
    print(f"Seeded {db.DATABASE_PATH}.")
