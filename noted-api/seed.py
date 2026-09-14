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

#: The category vocabulary.
#:
#: Colours are the ones the spreadsheet's conditional formatting used. The
#: meanings it never recorded — these are the owner's, reconstructed from the
#: entries actually filed under each tag, and they are what the letters are for.
CATEGORIES = [
    # The feature work itself, but only in response to a tracked issue.
    Category(name="T", colour="#7f6000", meaning="Ticket"),
    Category(name="M", colour="#351c75", meaning="Meeting"),
    # Written communication, as against the spoken kind that is a meeting:
    # emails, telling the team something, sending a release out.
    Category(name="C", colour="#104769", meaning="Communication"),
    # Writing things down — logging issues, organising TODOs, admin.
    Category(name="L", colour="#2e3f49", meaning="Logging"),
    # Learning and looking into things.
    Category(name="K", colour="#002f35", meaning="Knowledge"),
    # Writing and preparing one's own pull requests.
    Category(name="R", colour="#40701c", meaning="Resolved"),
    Category(name="CR", colour="#974845", meaning="Code review"),
    # Coding outside a tracked issue: tooling and setup, the work that makes
    # the rest of the work easier.
    Category(name="Co", colour="#9c894d", meaning="Code"),
    # Used, but never given a colour of its own, so it takes the plain surface.
    Category(name="Tr", colour="#2c2115", meaning="Travel"),
    # Blocked by a machine that would not cooperate. What the letter originally
    # stood for is lost; what it marked is not.
    Category(name="D", colour="#000000", meaning="Blocked"),
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
