"""Read the original spreadsheet into Noted.

The format is specified in `docs/legacy-journal-format.md`; this reads it.

The import is **re-runnable on purpose**. Getting the legacy parsing right takes
several passes, so `--reset` wipes everything it previously wrote and starts
again rather than trying to reconcile. Nothing here is a one-way door.

    python importer.py "C:\\path\\to\\Journal.ods" --reset

What it does *not* yet do is hours: arrival, departure and breaks are still in
the bracket syntax and are not read, so imported days carry entries but no
times. Recomputing those and reconciling them against the hand-written totals is
the next pass, and the part the specification says must stop and ask.
"""

import argparse
import datetime as dt
import random
import re
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass

from sqlmodel import Session, delete, select

import db
from models import Break, Day, Entry, Project

NS = {
    "table": "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
    "text": "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
    "office": "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
}

#: Day columns, left to right. The checkbox sits one column left of each.
DAY_COLUMNS = [2, 5, 8, 11, 14, 17, 20]
#: Row 0 is the day name, row 1 the date; entries start below.
FIRST_ENTRY_ROW = 2

#: A leading `[Tag]`, then an optional `project:` prefix, then the text.
CATEGORY = re.compile(r"^\[([A-Za-z]{1,3})\]\s*")
PROJECT = re.compile(r"^([A-Za-z0-9+.]+):\s*")
#: Content made only of bracketed groups is an annotation, not work done.
META = re.compile(r"^(?:\[[^\][]*\]\s*)+$")


@dataclass
class ParsedEntry:
    kind: str
    category: str | None
    project: str | None
    declares: bool
    text: str
    note: str | None


def parse_entry(content: str) -> ParsedEntry:
    """Turn one cell into fields. See specification §3."""
    first, _, rest = content.partition("\n")
    note = rest.strip() or None

    if META.match(first.strip()):
        return ParsedEntry("meta", None, None, False, first.strip(), note)

    text = first
    category = None
    if match := CATEGORY.match(text):
        category, text = match.group(1), text[match.end() :]

    project = None
    declares = False
    if match := PROJECT.match(text):
        raw = match.group(1)
        # A `+` immediately before a segment declares that segment. It is a
        # marker, not part of the name, so it never reaches the database.
        declares = "+" in raw
        project = raw.replace("+", "")
        text = text[match.end() :]

    return ParsedEntry("task", category, project, declares, text.strip(), note)


def sheet_date(name: str) -> dt.date | None:
    """A sheet is named for its Monday, as `DDMMYY`. Templates are not weeks."""
    if not re.fullmatch(r"\d{6}", name):
        return None
    return dt.datetime.strptime(name, "%d%m%y").date()


def sample_colour() -> str:
    """A colour for a project, constrained so it reads against the dark surface.

    The spreadsheet hashed the three channels independently, which produced
    near-blacks and muddy near-duplicates; see specification §4. Sampling in HSL
    with lightness and saturation pinned avoids both.
    """
    hue = random.random()
    return hsl_to_hex(hue, 0.45, 0.45)


def hsl_to_hex(hue: float, saturation: float, lightness: float) -> str:
    def channel(n):
        k = (n + hue * 12) % 12
        a = saturation * min(lightness, 1 - lightness)
        return round(255 * (lightness - a * max(-1, min(k - 3, 9 - k, 1))))

    return "#{:02x}{:02x}{:02x}".format(channel(0), channel(8), channel(4))


def cell_values(row) -> list[str]:
    """One row as a flat list of column values, repeats expanded."""
    values = []
    for cell in row.findall("table:table-cell", NS):
        repeat = int(cell.get(f"{{{NS['table']}}}number-columns-repeated", 1))
        paragraphs = cell.findall("text:p", NS)
        text = "\n".join("".join(p.itertext()) for p in paragraphs)
        boolean = cell.get(f"{{{NS['office']}}}boolean-value")
        if boolean is not None:
            text = boolean
        values.extend([text] * min(repeat, 64))
    return values


def read_sheets(path: str):
    """Every week sheet, as `(monday, rows)`."""
    root = ET.fromstring(zipfile.ZipFile(path).read("content.xml"))
    for sheet in root.findall(".//table:table", NS):
        monday = sheet_date(sheet.get(f"{{{NS['table']}}}name", ""))
        if monday is None:
            continue
        yield monday, [cell_values(row) for row in sheet.findall("table:table-row", NS)]


def wipe(session: Session):
    """Remove everything a previous import wrote, so it can be run again."""
    session.exec(delete(Entry))
    session.exec(delete(Break))
    session.exec(delete(Day))
    session.exec(delete(Project))
    session.commit()


def run(path: str, session: Session, reset: bool = False):
    if reset:
        wipe(session)

    projects: dict[str, Project] = {
        project.path: project for project in session.exec(select(Project))
    }
    counts = {"weeks": 0, "days": 0, "entries": 0, "meta": 0}
    undeclared: set[str] = set()

    for monday, rows in read_sheets(path):
        counts["weeks"] += 1

        for offset, column in enumerate(DAY_COLUMNS):
            date = monday + dt.timedelta(days=offset)
            entries = []

            for row in rows[FIRST_ENTRY_ROW:]:
                if column >= len(row):
                    continue
                content = row[column].strip()
                if not content:
                    continue

                parsed = parse_entry(content)
                done = column - 1 < len(row) and row[column - 1] in ("1", "true")

                project_id = None
                if parsed.project:
                    project = projects.get(parsed.project)
                    if project is None:
                        # The spreadsheet only coloured an undeclared project
                        # red, so plenty exist without a `+`. Record it and note
                        # that it arrived undeclared.
                        if not parsed.declares:
                            undeclared.add(parsed.project)
                        project = Project(
                            path=parsed.project,
                            colour=sample_colour(),
                            declared_on=date,
                        )
                        session.add(project)
                        session.commit()
                        session.refresh(project)
                        projects[parsed.project] = project
                    project_id = project.id

                entries.append(
                    Entry(
                        date=date,
                        position=len(entries),
                        kind=parsed.kind,
                        done=done,
                        category=parsed.category,
                        project_id=project_id,
                        text=parsed.text,
                        note=parsed.note,
                    )
                )
                counts["meta" if parsed.kind == "meta" else "entries"] += 1

            if not entries:
                continue

            session.add(Day(date=date, expected_minutes=0))
            for entry in entries:
                session.add(entry)
            counts["days"] += 1

        session.commit()

    return counts, undeclared


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", help="path to the .ods file")
    parser.add_argument(
        "--reset",
        action="store_true",
        help="wipe what a previous import wrote before starting",
    )
    args = parser.parse_args()

    with Session(db.engine()) as session:
        counts, undeclared = run(args.workbook, session, reset=args.reset)

    print(
        f"{counts['weeks']} weeks, {counts['days']} days, "
        f"{counts['entries']} entries, {counts['meta']} annotations."
    )
    if undeclared:
        print(f"\n{len(undeclared)} projects were used before being declared:")
        for path in sorted(undeclared):
            print(f"  {path}")
        print("Look for near-duplicates here — that is what the `+` rule exists to prevent.")


if __name__ == "__main__":
    main()
