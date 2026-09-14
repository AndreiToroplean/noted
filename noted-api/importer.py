"""Read the original spreadsheet into Noted.

The format is specified in `docs/legacy-journal-format.md`; this reads it.

The import is **re-runnable on purpose**. Getting the legacy parsing right takes
several passes, so `--reset` wipes everything it previously wrote and starts
again rather than trying to reconcile. Nothing here is a one-way door.

    python importer.py "C:\\path\\to\\Journal.ods" --reset

Judgement calls live in `importer-rules.toml` next to this file, which is **not**
committed: it is one person's reading of their own history, not part of the app.
It is optional, and looks like this:

    # Two spellings of one project. The left one is folded into the right.
    [merge]
    refactr = "refactor"

    # Paths that were genuinely new even though they were written without a `+`.
    declare = ["atlas.2"]

Where a day carries an explicit `=> +1h` overtime and the recomputed figure
disagrees, the run records it in `data/import-report.txt` rather than stopping.
Reading that report and fixing the parsing is what the next pass is for.
"""

import argparse
import datetime as dt
import tomllib
from pathlib import Path
import random
import re
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass, field

from sqlmodel import Session, delete, select

import db
from models import Break, Day, DayStatus, Entry, Project, Settings

RULES_PATH = "importer-rules.toml"
REPORT_PATH = "data/import-report.txt"

NS = {
    "table": "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
    "text": "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
    "office": "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
}

#: Day columns, left to right. The checkbox sits one column left of each.
DAY_COLUMNS = [2, 5, 8, 11, 14, 17, 20]
#: Row 0 is the day name, row 1 the date; entries start below.
FIRST_ENTRY_ROW = 2
#: A weekday the owner did not annotate still had lunch.
DEFAULT_LUNCH = 60

#: A leading `[Tag]`, then an optional `project:` prefix, then the text.
CATEGORY = re.compile(r"^\[([A-Za-z]{1,3})\]\s*")
PROJECT = re.compile(r"^([A-Za-z0-9+.]+):\s*")
#: Content made only of bracketed groups is an annotation, not work done.
META = re.compile(r"^(?:\[[^\][]*\]\s*)+$")

# --- Time markers -----------------------------------------------------------
#
# A bracketed annotation that is *about the clock* rather than about the day.
# The grammar is specified in `docs/legacy-journal-format.md` §5; the authority
# for what each one means is the owner's own `parse_work_hours.py`.

DURATION = r"\d+h\d+m?|\d+h|\d+m"
CLOCK = r"\d{1,2}:\d{2}"
RANGE = re.compile(rf"^({CLOCK})\s*->\s*({CLOCK})")
NOON_RANGE = re.compile(rf"^#\s*({CLOCK})\s*->\s*({CLOCK})")
NOON = re.compile(r"^#\s*(.*)$")
ARROW = re.compile(rf"^->\s*({CLOCK})")
BARE_DURATION = re.compile(rf"^({DURATION})$")
OVERRIDE = re.compile(rf"=>\s*([+-]?)({DURATION}|0m)")
FIRST_DURATION = re.compile(rf"({DURATION})")

#: A day made of nothing but one of these is not a working day.
STATUSES = [
    ("UNPAID", "unpaid"),
    ("PAID HOLIDAY", "paid_holiday"),
    ("HOLIDAY", "holiday"),
    ("SICK", "sick"),
    ("OFF", "off"),
]


@dataclass
class ParsedBreak:
    is_noon: bool
    start: dt.time | None = None
    end: dt.time | None = None
    minutes: int | None = None


@dataclass
class ParsedDay:
    """A day's entries with its clock markers lifted out of them."""

    entries: list = field(default_factory=list)
    breaks: list[ParsedBreak] = field(default_factory=list)
    arrival: dt.time | None = None
    departure: dt.time | None = None
    status: str = "working"
    #: Where the day was filed with an explicit `=> ±duration` override.
    explicit_overtime: int | None = None


@dataclass
class ParsedEntry:
    kind: str
    category: str | None
    project: str | None
    declares: bool
    text: str
    note: str | None
    #: Filled in from the checkbox beside the cell.
    done: bool = False


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


def parse_duration(text: str) -> int | None:
    """`1h30`, `1h`, `45m` in minutes."""
    if match := re.fullmatch(r"(\d+)h(\d+)m?", text):
        return int(match.group(1)) * 60 + int(match.group(2))
    if match := re.fullmatch(r"(\d+)h", text):
        return int(match.group(1)) * 60
    if match := re.fullmatch(r"(\d+)m", text):
        return int(match.group(1))
    return None


def parse_clock(text: str) -> dt.time | None:
    try:
        hour, minute = (int(part) for part in text.split(":"))
        return dt.time(hour % 24, minute)
    except ValueError:
        return None


def read_markers(entries: list[ParsedEntry]) -> ParsedDay:
    """Lift a day's clock markers out of its entries.

    A bracketed annotation is either about the clock — arrival, departure, a
    break — or about the day, like `[On site]`. The first kind is consumed here
    and becomes the day's hours; the second stays an entry.
    """
    day = ParsedDay()
    kept = []

    for entry in entries:
        if entry.kind != "meta":
            kept.append(entry)
            continue

        inner = entry.text.strip()[1:-1].strip()
        if not consume_marker(inner, day, first=not kept and not day.breaks):
            kept.append(entry)

    day.entries = kept

    # A day made of nothing but a status word is not a working day. The word
    # only counts when it is the whole day: `[Off to the dentist]` in a normal
    # day is an annotation, not a declaration.
    if len(kept) == 1 and not day.breaks and kept[0].kind == "meta":
        word = kept[0].text.strip()[1:-1].strip().upper()
        for needle, status in STATUSES:
            if needle in word:
                day.status = status
                break

    return day


def consume_marker(inner: str, day: ParsedDay, first: bool) -> bool:
    """Read one bracketed annotation as a clock marker. False if it is not one."""
    # An explicit `=> ±duration` files the whole day's overtime by hand. The
    # departure time in the same marker is still real, so unlike the legacy
    # parser we read both rather than stopping at the arrow.
    if match := OVERRIDE.search(inner):
        minutes = parse_duration(match.group(2)) or 0
        day.explicit_overtime = -minutes if match.group(1) == "-" else minutes
        if arrow := ARROW.match(inner):
            day.departure = parse_clock(arrow.group(1))
        return True

    if match := NOON_RANGE.match(inner):
        day.breaks.append(
            ParsedBreak(True, parse_clock(match.group(1)), parse_clock(match.group(2)))
        )
        return True

    if match := RANGE.match(inner):
        day.breaks.append(
            ParsedBreak(False, parse_clock(match.group(1)), parse_clock(match.group(2)))
        )
        return True

    if match := ARROW.match(inner):
        clock = parse_clock(match.group(1))
        # The same marker says both, and only its position tells them apart.
        if first and day.arrival is None:
            day.arrival = clock
        else:
            day.departure = clock
        return True

    if match := NOON.match(inner):
        rest = match.group(1).strip()
        found = FIRST_DURATION.search(rest)
        day.breaks.append(
            ParsedBreak(True, minutes=parse_duration(found.group(1)) if found else DEFAULT_LUNCH)
        )
        return True

    if match := BARE_DURATION.match(inner):
        day.breaks.append(ParsedBreak(False, minutes=parse_duration(match.group(1))))
        return True

    return False


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


@dataclass
class Rules:
    """One person's reading of their own history. Never committed."""

    #: Alias path -> the path it is really the same project as.
    merge: dict[str, str] = field(default_factory=dict)
    #: Paths that were new despite being written without a `+`.
    declare: set[str] = field(default_factory=set)

    def canonical(self, path: str) -> str:
        return self.merge.get(path, path)


def load_rules(path: str = RULES_PATH) -> Rules:
    try:
        with open(path, "rb") as handle:
            raw = tomllib.load(handle)
    except FileNotFoundError:
        return Rules()
    return Rules(merge=raw.get("merge", {}), declare=set(raw.get("declare", [])))


def worked_minutes(day: ParsedDay, arrival: dt.time, departure: dt.time) -> int:
    """Time present, less every break. See specification §6.3."""
    present = minutes_of(departure) - minutes_of(arrival)
    if present < 0:
        present += 24 * 60  # worked past midnight
    for pause in day.breaks:
        if pause.minutes is not None:
            present -= pause.minutes
        elif pause.start and pause.end:
            present -= minutes_of(pause.end) - minutes_of(pause.start)
    return present


def minutes_of(clock: dt.time) -> int:
    return clock.hour * 60 + clock.minute


def wipe(session: Session):
    """Remove everything a previous import wrote, so it can be run again."""
    session.exec(delete(Entry))
    session.exec(delete(Break))
    session.exec(delete(Day))
    session.exec(delete(Project))
    session.commit()


def run(path: str, session: Session, reset: bool = False, rules: Rules | None = None):
    if reset:
        wipe(session)
    rules = rules or load_rules()

    projects: dict[str, Project] = {
        project.path: project for project in session.exec(select(Project))
    }
    defaults = {row.weekday: row for row in session.exec(select(Settings))}
    counts = {"weeks": 0, "days": 0, "entries": 0, "meta": 0, "breaks": 0}
    undeclared: set[str] = set()
    disagreements: list[str] = []

    for monday, rows in read_sheets(path):
        counts["weeks"] += 1

        for offset, column in enumerate(DAY_COLUMNS):
            date = monday + dt.timedelta(days=offset)
            parsed_entries = []
            done_flags = []

            for row in rows[FIRST_ENTRY_ROW:]:
                if column >= len(row):
                    continue
                content = row[column].strip()
                if not content:
                    continue
                parsed_entries.append(parse_entry(content))
                done_flags.append(column - 1 < len(row) and row[column - 1] in ("1", "true"))

            if not parsed_entries:
                continue

            # Keep each entry's checkbox with it through the marker pass, which
            # removes some of them.
            for parsed, done in zip(parsed_entries, done_flags):
                parsed.done = done

            day = read_markers(parsed_entries)
            if not day.entries and not day.breaks and day.status == "working":
                continue

            default = defaults.get(date.weekday())
            arrival = day.arrival or (default.arrival if default else None)
            departure = day.departure or (default.departure if default else None)
            expected = default.expected_minutes if default else 0
            if day.status != "working":
                expected = 0

            session.add(
                Day(
                    date=date,
                    status=DayStatus(day.status),
                    arrival=arrival,
                    departure=departure,
                    expected_minutes=expected,
                )
            )

            # A weekday with no `#` marker still had lunch — that is what made
            # the owner's own totals come out right.
            breaks = list(day.breaks)
            if (
                day.status == "working"
                and date.weekday() < 5
                and not any(pause.is_noon for pause in breaks)
            ):
                breaks.append(ParsedBreak(True, minutes=DEFAULT_LUNCH))

            for position, pause in enumerate(breaks):
                session.add(
                    Break(
                        date=date,
                        position=position,
                        is_noon=pause.is_noon,
                        start=pause.start,
                        end=pause.end,
                        minutes=pause.minutes,
                    )
                )
            counts["breaks"] += len(breaks)

            for position, parsed in enumerate(day.entries):
                project_id = None
                if parsed.project:
                    path_name = rules.canonical(parsed.project)
                    project = projects.get(path_name)
                    if project is None:
                        # The spreadsheet only coloured an undeclared project
                        # red, so plenty exist without a `+`.
                        if not parsed.declares and path_name not in rules.declare:
                            undeclared.add(path_name)
                        project = Project(
                            path=path_name, colour=sample_colour(), declared_on=date
                        )
                        session.add(project)
                        session.commit()
                        session.refresh(project)
                        projects[path_name] = project
                    project_id = project.id

                session.add(
                    Entry(
                        date=date,
                        position=position,
                        kind=parsed.kind,
                        done=getattr(parsed, "done", False),
                        category=parsed.category,
                        project_id=project_id,
                        text=parsed.text,
                        note=parsed.note,
                    )
                )
                counts["meta" if parsed.kind == "meta" else "entries"] += 1

            counts["days"] += 1

            # Where the day was filed by hand, check the recomputation agrees.
            if day.explicit_overtime is not None and arrival and departure:
                day_breaks = ParsedDay(breaks=breaks)
                computed = worked_minutes(day_breaks, arrival, departure) - expected
                if computed != day.explicit_overtime:
                    disagreements.append(
                        f"{date}  written {day.explicit_overtime:+d}m, "
                        f"recomputed {computed:+d}m  "
                        f"({arrival:%H:%M}-{departure:%H:%M}, expected {expected}m)"
                    )

        session.commit()

    return counts, undeclared, disagreements


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", help="path to the .ods file")
    parser.add_argument(
        "--reset",
        action="store_true",
        help="wipe what a previous import wrote before starting",
    )
    parser.add_argument("--rules", default=RULES_PATH, help=f"default: {RULES_PATH}")
    args = parser.parse_args()

    rules = load_rules(args.rules)
    with Session(db.engine()) as session:
        counts, undeclared, disagreements = run(
            args.workbook, session, reset=args.reset, rules=rules
        )

    print(
        f"{counts['weeks']} weeks, {counts['days']} days, {counts['entries']} entries, "
        f"{counts['meta']} annotations, {counts['breaks']} breaks."
    )
    if rules.merge or rules.declare:
        print(f"Applied {len(rules.merge)} merges and {len(rules.declare)} declarations.")
    else:
        print(f"No {args.rules} found: every judgement call left as the spreadsheet had it.")

    if undeclared:
        print(f"\n{len(undeclared)} projects were used before being declared:")
        for path in sorted(undeclared):
            print(f"  {path}")
        print("Near-duplicates here are what the `+` rule exists to prevent; a [merge]")
        print(f"line in {args.rules} folds one into another.")

    if disagreements:
        Path(REPORT_PATH).parent.mkdir(parents=True, exist_ok=True)
        Path(REPORT_PATH).write_text(
            "Days whose hand-written overtime disagrees with the recomputation.\n"
            "Either the original slipped or the parser has a gap, and the second\n"
            "is worth fixing before importing again.\n\n"
            + "\n".join(disagreements)
            + "\n",
            encoding="utf-8",
        )
        print(f"\n{len(disagreements)} days disagree with their written total.")
        print(f"See {REPORT_PATH}.")


if __name__ == "__main__":
    main()
