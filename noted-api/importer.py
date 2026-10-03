"""Read the original spreadsheet into Noted.

The format is specified in `docs/legacy-journal-format.md`; this reads it.

The import is **re-runnable on purpose**. Getting the legacy parsing right takes
several passes, so `--reset` wipes the whole database back to the seed and
starts again rather than trying to reconcile.
Nothing here is a one-way door.

    python importer.py "C:\\path\\to\\Journal.ods" --reset

Judgement calls live in `importer-rules.toml` next to this file, which is **not**
committed: it is one person's reading of their own history, not part of the app.
It is optional, and looks like this:

    # Two spellings of one project. The left one is folded into the right.
    [merge]
    refactr = "refactor"

    # Paths that were genuinely new even though they were written without a `+`.
    declare = ["atlas.2"]

Run in a terminal, it **asks** rather than guesses the one thing it cannot decide
alone: whether a project used without a `+` is new or a second spelling of one
that exists. A day's overtime is never asked about, because it is always what the
day's hours add up to; where a hand-written `=> +1h` disagrees, the day is written
to the report as it stands — hours, breaks, entries — for the hours to be
corrected by hand.

Answers go to `importer-decisions.toml` and are not asked again, so a re-run
after fixing the parsing only stops at what is genuinely new. Delete that file
to start the questions over. `--batch` never asks and leaves every conflict as
the spreadsheet had it.
"""

import argparse
import datetime as dt
import io
import tomllib
from pathlib import Path
import random
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass, field

from sqlalchemy.exc import OperationalError
from sqlmodel import Session, SQLModel, select

import db
from models import Break, Day, DayStatus, Entry, Project, Settings
from seed import seed

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
#: How long lunch was when it was not written down.
DEFAULT_LUNCH = 60
#: A blank cell between two entries. The owner wrote most lunches as `[# 1h]`
#: but sometimes just left a gap in the column where he stepped away, and the
#: gap says the same thing. It is a marker, not an empty row, so it survives
#: the walk down the column instead of being skipped with the rest.
GAP = "gap"
#: How a gap is named where a day is printed out for the owner to read.
BLANK_ROW = "(a blank row)"

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
#: A break, written `[-15m]`. The sign is real — it is overtime being given up —
#: but it is not part of the length. Small daytime breaks were sometimes written
#: without it; they are never additive, so `[15m]` means the same as `[-15m]`.
#: A `+` form would be the opposite, added time rather than a break, and there
#: is no such marker in the history — so it stays unread rather than guessed at.
BARE_DURATION = re.compile(rf"^-?({DURATION})$")
#: `[Errand in town (-1h45)]` — time given up, with the reason kept.
DEDUCTION = re.compile(rf"^(.*?)\(\s*-\s*({DURATION})\s*\)$")
#: Anything holding a duration or a clock is making a claim about time.
TIME_ISH = re.compile(rf"{DURATION}|{CLOCK}|=>")
OVERRIDE = re.compile(rf"=>\s*([+-]?)\s*({DURATION})")
FIRST_DURATION = re.compile(rf"({DURATION})")
#: What a marker says it did to the day's overtime, as in `[# 1h15 (-15m)]`. The
#: written figures should add up to the day's `=>`.
STATED = re.compile(rf"\(\s*([+-])\s*({DURATION})\s*(?:=>|\))")

#: A day made of nothing but one of these is not a working day. Whether it was
#: paid is not the day's status, so an unpaid day of any kind is simply off, and
#: a paid holiday a holiday; the first needle found wins.
STATUSES = [
    ("UNPAID", "off"),
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
    description: str | None = None


@dataclass
class ParsedDay:
    """A day's entries with its clock markers lifted out of them.

    One list, in the order the column was written: a break is not a separate
    kind of day, it is a thing that happened between two entries, and where it
    happened is as much a fact as how long it was.
    """

    items: list = field(default_factory=list)
    arrival: dt.time | None = None
    departure: dt.time | None = None
    status: str = "working"
    #: Where the day was filed with an explicit `=> ±duration`. Read to check the
    #: recomputation against, never stored: the day's overtime is its hours.
    explicit_overtime: int | None = None
    #: Annotations that look like clock markers but matched no rule. Never drop
    #: these quietly: breaks went missing that way once.
    unread: list[str] = field(default_factory=list)
    #: The figures written on the markers themselves, as in `[# 1h15 (-15m)]`.
    #: They should add up to the day's `=>`; where they do not, the day is worth
    #: looking at by hand.
    stated: list[int] = field(default_factory=list)
    #: Every annotation, paired with what it was taken to mean, in the order it
    #: was written. Shown where a day's hours and its filed figure disagree.
    reading: list[tuple[str, str]] = field(default_factory=list)

    @property
    def entries(self) -> list["ParsedEntry"]:
        return [item for item in self.items if isinstance(item, ParsedEntry)]

    @property
    def breaks(self) -> list["ParsedBreak"]:
        return [item for item in self.items if isinstance(item, ParsedBreak)]


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


def gap_entry() -> ParsedEntry:
    """The blank cell between two entries, as something the day can read."""
    return ParsedEntry(GAP, None, None, False, "", None)


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
    #: Whether any work has been recorded yet. A day often opens with a plain
    #: annotation or two — `[Back from a week away]`, `[On
    #: site]` — before the clock, and a marker among those is still the arrival.
    #: What ends the opening is the first task, not the first thing written.
    started = False

    for entry in entries:
        if entry.kind == GAP:
            day.items.append(ParsedBreak(True, minutes=DEFAULT_LUNCH))
            day.reading.append((BLANK_ROW, describe_break(day.breaks[-1])))
            continue

        if entry.kind != "meta":
            day.items.append(entry)
            started = True
            continue

        inner = entry.text.strip()[1:-1].strip()
        before = (day.arrival, day.departure, len(day.breaks), day.explicit_overtime)
        if consume_marker(inner, day, first=not started and not day.breaks):
            read = effect_of(before, day)
            if stated := STATED.search(inner):
                minutes = parse_duration(stated.group(2)) or 0
                day.stated.append(-minutes if stated.group(1) == "-" else minutes)
                read += f", written as {stated.group(1)}{stated.group(2)}"
            day.reading.append((entry.text.strip(), read))
        else:
            if TIME_ISH.search(inner):
                day.unread.append(entry.text.strip())
                day.reading.append((entry.text.strip(), "not read"))
            day.items.append(entry)

    # A day made of nothing but a status word is not a working day. The word
    # only counts when it is the whole day: `[Off to the dentist]` in a normal
    # day is an annotation, not a declaration.
    if len(day.items) == 1 and day.entries and day.entries[0].kind == "meta":
        word = day.entries[0].text.strip()[1:-1].strip().upper()
        for needle, status in STATUSES:
            if needle in word:
                day.status = status
                break

    return day


def assume_lunch(day: ParsedDay, date: dt.date) -> bool:
    """Give a working weekday the hour nobody wrote down. True if it needed it.

    Where lunch was is not recoverable — the column says nothing — so it goes at
    the end of the day rather than somewhere invented in the middle. The length
    is what the day's hours turn on and that much is known; the placement is the
    part that is not, and the end is where it reads as unplaced.
    """
    if day.status != "working" or date.weekday() >= 5:
        return False
    # A day of nothing but annotations is a day no work was done on, so there
    # was no lunch to have written down either way.
    if not any(entry.kind == "task" for entry in day.entries):
        return False
    if any(pause.is_noon for pause in day.breaks):
        return False

    day.items.append(ParsedBreak(True, minutes=DEFAULT_LUNCH))
    return True


def describe_break(pause: ParsedBreak) -> str:
    """One break, the way it reads: a span, a length, or a length and a reason."""
    if pause.start and pause.end:
        span = f"{pause.start:%H:%M} to {pause.end:%H:%M}"
    elif pause.minutes is not None:
        span = f"{pause.minutes // 60}h{pause.minutes % 60:02d}" if pause.minutes >= 60             else f"{pause.minutes}m"
    else:
        span = "no length given"
    said = f" ({pause.description})" if pause.description else ""
    return f"{'lunch' if pause.is_noon else 'break'}, {span}{said}"


def effect_of(before, day: ParsedDay) -> str:
    """What one marker did to the day, for showing beside the marker itself."""
    arrival, departure, breaks, filed = before
    said = []
    if day.explicit_overtime != filed:
        said.append(f"day filed as {day.explicit_overtime:+d}m")
    if day.arrival != arrival:
        said.append(f"arrived {day.arrival:%H:%M}")
    if day.departure != departure:
        said.append(f"left {day.departure:%H:%M}")
    for pause in day.breaks[breaks:]:
        said.append(describe_break(pause))
    return ", ".join(said) or "read, but said nothing"


def consume_marker(inner: str, day: ParsedDay, first: bool) -> bool:
    """Read one bracketed annotation as a clock marker. False if it is not one."""
    # An explicit `=> ±duration` files the whole day's overtime by hand. It is
    # written on the day's last time marker, which is usually the departure but
    # in the early weeks was whatever came last — `[-15m => +30m]` is a fifteen
    # minute break that also files the day at +30m. So take the arrow off and
    # read what is left as a marker in its own right, rather than stopping here
    # and losing it.
    if match := OVERRIDE.search(inner):
        minutes = parse_duration(match.group(2)) or 0
        day.explicit_overtime = -minutes if match.group(1) == "-" else minutes
        rest = (inner[: match.start()] + inner[match.end() :]).strip()
        if rest:
            consume_marker(rest, day, first)
        return True

    if match := NOON_RANGE.match(inner):
        day.items.append(
            ParsedBreak(True, parse_clock(match.group(1)), parse_clock(match.group(2)))
        )
        return True

    if match := RANGE.match(inner):
        day.items.append(
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
        # `[# 45m out for a coffee]` — a length, a note, or both. What is left
        # after the length is worth keeping: it is often who it was with.
        rest = match.group(1).strip()
        found = FIRST_DURATION.search(rest)
        minutes = parse_duration(found.group(1)) if found else DEFAULT_LUNCH
        said = (rest[: found.start()] + rest[found.end() :] if found else rest).strip()
        said = STATED.sub("", said).strip()
        day.items.append(ParsedBreak(True, minutes=minutes, description=said or None))
        return True

    if match := BARE_DURATION.match(inner):
        day.items.append(ParsedBreak(False, minutes=parse_duration(match.group(1))))
        return True

    # Last, because the others are more specific: an annotation that ends in a
    # parenthesised deduction is a break, and whatever precedes it says why.
    if match := DEDUCTION.match(inner):
        said = match.group(1).strip()
        day.items.append(
            ParsedBreak(False, minutes=parse_duration(match.group(2)), description=said or None)
        )
        return True

    return False


def read_column(rows, column: int):
    """One day's column, as parsed entries, their checkboxes, and the raw text.

    Blank cells are mostly just spreadsheet — a column is far taller than the
    day written in it. A blank *between* two entries is not: that is the gap
    the owner left where he went to lunch, and it is kept as a marker.
    """
    entries, done_flags, raw = [], [], []
    gap = False

    for row in rows[FIRST_ENTRY_ROW:]:
        content = row[column].strip() if column < len(row) else ""
        if not content:
            gap = gap or bool(entries)
            continue

        if gap:
            entries.append(gap_entry())
            done_flags.append(False)
            raw.append(("", False))
            gap = False

        entries.append(parse_entry(content))
        done_flags.append(column - 1 < len(row) and row[column - 1] in ("1", "true"))
        raw.append((content, done_flags[-1]))

    return entries, done_flags, raw


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


NEW = "*new*"

DECISIONS_PATH = "importer-decisions.toml"


def quote_key(key: str) -> str:
    """A TOML bare key cannot hold a dot; `atlas.2` is a name, not a nesting."""
    return '"' + key.replace('"', '\\"') + '"'


@dataclass
class Decisions:
    """What the person answered last time, so they are asked once and not again.

    Written by the importer rather than by hand — `importer-rules.toml` is the
    hand-written half. Both are gitignored: they are one person's reading of
    their own history.
    """

    projects: dict[str, str] = field(default_factory=dict)

    @classmethod
    def load(cls, path=DECISIONS_PATH) -> "Decisions":
        try:
            with open(path, "rb") as handle:
                raw = tomllib.load(handle)
        except FileNotFoundError:
            return cls()
        return cls(projects=raw.get("projects", {}))

    def save(self, path=DECISIONS_PATH):
        lines = [
            "# Written by importer.py as questions get answered. Safe to delete:",
            "# deleting it only means being asked again.",
            "",
            "[projects]",
        ]
        for name, answer in sorted(self.projects.items()):
            lines.append(f"{quote_key(name)} = {quote_key(answer)}")
        Path(path).write_text("\n".join(lines) + "\n", encoding="utf-8")


class Resolver:
    """Answers the questions an import raises, asking a person when it must.

    `ask` is a callable taking the question, the options and the context to
    show. Passing None makes the run non-interactive: nothing is invented, the
    spreadsheet's own reading stands, and `unresolved` counts what was left.

    `release` is called either side of a question, to put what is settled on
    disk and let go of the database. A question waits on a person, and a person
    is slow — one left open overnight, or orphaned when its terminal closed,
    would otherwise hold a write lock nothing can take back.
    """

    def __init__(
        self, decisions: Decisions, ask=None, rules: Rules | None = None, release=None
    ):
        self.decisions = decisions
        self.ask = ask
        self.release = release or (lambda: None)
        self.rules = rules or Rules()
        self.unresolved = 0
        self.asked = 0
        #: Paths somebody has actually ruled on, by rule, by memory, or just now.
        self.settled: set[str] = set()

    def project(self, path: str, known: list[str], date) -> str:
        if path in self.rules.merge:
            self.settled.add(path)
            return self.rules.merge[path]
        if path in self.rules.declare:
            self.settled.add(path)
            return path

        answer = self.decisions.projects.get(path)
        if answer is None:
            if self.ask is None:
                self.unresolved += 1
                return path
            self.release()
            answer = self.ask(
                question=f"Project {path!r} was used without being declared.",
                options=[(NEW, f"a new project called {path}")]
                + [(name, f"the same as {name}") for name in known],
                context=[f"First seen {date}." if date else ""],
            )
            self.decisions.projects[path] = answer
            self.asked += 1
            self.release()

        self.settled.add(path)
        return path if answer == NEW else answer

def hours(minutes: int) -> str:
    sign = "-" if minutes < 0 else ""
    minutes = abs(minutes)
    return f"{sign}{minutes // 60}h{minutes % 60:02d}" if minutes >= 60 else f"{sign}{minutes}m"


def describe_day(date, day: ParsedDay, raw, arrival, departure, expected, computed):
    """The day as it was written, then as it was read, so a choice can be made.

    The column comes first and verbatim. Nothing here is reconstructed from the
    parse: deciding between the written figure and the recomputation means
    looking at what is actually in the spreadsheet.
    """
    lines = [f"{date:%A %d %B %Y}", "", "  the column, as written"]
    for content, done in raw:
        if not content:
            lines.append(f"    [ ]   {BLANK_ROW}")
            continue
        mark = "x" if done else " "
        for index, piece in enumerate(content.splitlines()):
            lines.append(f"    [{mark}] {piece}" if index == 0 else f"        {piece}")

    if day.reading:
        lines += ["", "  each time marker, and what it was read as"]
        width = max(len(text) for text, _ in day.reading)
        for text, meaning in day.reading:
            lines.append(f"    {text:<{width}}   {meaning}")

    lines += ["", "  the day that makes"]
    assumed = " (assumed, none written)"
    lines.append(f"    arrived {arrival:%H:%M}" + ("" if day.arrival else assumed))
    lines.append(f"    left    {departure:%H:%M}" + ("" if day.departure else assumed))
    for pause in day.breaks:
        lines.append(f"    {describe_break(pause)}")
    worked = computed + expected
    lines.append(f"    worked {hours(worked)} against {hours(expected)} expected")
    if day.stated:
        parts = " ".join(f"{figure:+d}" for figure in day.stated)
        lines.append(f"    the figures written by hand add up to {sum(day.stated):+d}m  ({parts})")
        # Say what is missing from that sum rather than guessing at it: a marker
        # with no figure of its own still moved the day.
        silent = [text for text, read in day.reading if "written as" not in read]
        if silent:
            lines.append(f"    and no figure was written on {', '.join(silent)}")
    return lines


def column_of(day: ParsedDay, raw) -> list[str]:
    """A day's column as written, with the lines that said where lunch was
    picked out in the gutter. Scanning twenty lines for the two that collided
    is the work the report exists to save."""
    lunches = {text for text, meaning in day.reading if meaning.startswith("lunch")}
    lines = []
    for content, _ in raw:
        first = content.splitlines()[0] if content else BLANK_ROW
        lines.append(f"  {'>' if first in lunches else ' '}  {first}")
    return lines


def section(title: str, blurb: str, days: list[list[str]]) -> str:
    """One kind of problem, its days under it, headed so it can be skipped."""
    rule = "=" * 78
    counted = f"{len(days)} day" + ("" if len(days) == 1 else "s")
    lines = [rule, f"  {title} — {counted}", rule, "", blurb, ""]
    for day in days:
        lines += day + [""]
    return "\n".join(lines).rstrip()


def ask_on_terminal(question: str, options, context) -> str:
    """Show the day, then the choices, and wait."""
    print()
    print("-" * 72)
    for line in context:
        print(line)
    print()
    print(question)
    for index, (_, label) in enumerate(options, start=1):
        print(f"  {index}) {label}")

    while True:
        try:
            reply = input("choose [1], ctrl-c to stop: ").strip()
        except EOFError:
            return options[0][0]
        if not reply:
            return options[0][0]
        if reply.isdigit() and 1 <= int(reply) <= len(options):
            return options[int(reply) - 1][0]
        print(f"  enter 1 to {len(options)}.")


def worked_minutes(day: ParsedDay, arrival: dt.time, departure: dt.time) -> int:
    """Time present, less every break. See specification §6.3."""
    present = minutes_of(departure) - minutes_of(arrival)
    if present < 0:
        present += 24 * 60  # worked past midnight
    for pause in day.breaks:
        if pause.minutes is not None:
            present -= pause.minutes
        elif pause.start and pause.end:
            away = minutes_of(pause.end) - minutes_of(pause.start)
            if away < 0:
                away += 24 * 60  # a break running past midnight, like the day itself
            present -= away
    return present


def minutes_of(clock: dt.time) -> int:
    return clock.hour * 60 + clock.minute


def wipe(session: Session):
    """Drop and rebuild every table, then seed them, so the import can be run again.

    Nothing survives: settings, categories and the overtime baseline start over
    from the seed, as for a new user.

    Dropping rather than deleting because the models move while the parsing is
    still being got right: a database written before a column existed would keep
    its old shape forever, and the next insert would fail on the missing column.
    """
    session.commit()
    engine = session.get_bind()
    SQLModel.metadata.drop_all(engine)
    SQLModel.metadata.create_all(engine)
    seed(session)


def run(
    path: str,
    session: Session,
    reset: bool = False,
    rules: Rules | None = None,
    resolver: Resolver | None = None,
):
    if reset:
        wipe(session)
    rules = rules or load_rules()
    resolver = resolver or Resolver(Decisions(), ask=None, rules=rules)

    projects: dict[str, Project] = {
        project.path: project for project in session.exec(select(Project))
    }
    defaults = {row.weekday: row for row in session.exec(select(Settings))}
    counts = {"weeks": 0, "days": 0, "entries": 0, "meta": 0, "breaks": 0}
    undeclared: set[str] = set()
    disagreements: list[list[str]] = []
    unread: list[str] = []
    lunchless: list[list[str]] = []
    many_lunches: list[list[str]] = []

    for monday, rows in read_sheets(path):
        counts["weeks"] += 1

        for offset, column in enumerate(DAY_COLUMNS):
            date = monday + dt.timedelta(days=offset)
            parsed_entries, done_flags, raw = read_column(rows, column)

            if not parsed_entries:
                continue

            # Keep each entry's checkbox with it through the marker pass, which
            # removes some of them.
            for parsed, done in zip(parsed_entries, done_flags):
                parsed.done = done

            day = read_markers(parsed_entries)
            unread += [f"{date}  {text}" for text in day.unread]
            if not day.entries and not day.breaks and day.status == "working":
                continue

            default = defaults.get(date.weekday())
            arrival = day.arrival or (default.arrival if default else None)
            departure = day.departure or (default.departure if default else None)
            expected = default.expected_minutes if default else 0
            if day.status != "working":
                expected = 0

            # Every working weekday says where lunch was, with a `#` marker or
            # with a blank row. One that says it twice is a mistake in the
            # column; one that says it not at all gets the usual hour, at the
            # end of the day, because where it was is not recoverable.
            if len([pause for pause in day.breaks if pause.is_noon]) > 1:
                said = " and ".join(
                    describe_break(pause) for pause in day.breaks if pause.is_noon
                )
                many_lunches.append([f"{date:%A %d %B %Y}   {said}"] + column_of(day, raw))
            elif assume_lunch(day, date):
                lunchless.append([f"{date:%A %d %B %Y}"] + column_of(day, raw))

            # A day's overtime is always what its hours add up to, so the figure
            # filed by hand is not kept. Where the two differ the day is written
            # out as it stands, for the owner to correct the hours themselves.
            if day.explicit_overtime is not None and arrival and departure:
                computed = worked_minutes(day, arrival, departure) - expected
                if computed != day.explicit_overtime:
                    disagreements.append(
                        describe_day(date, day, raw, arrival, departure, expected, computed)
                    )

            session.add(
                Day(
                    date=date,
                    status=DayStatus(day.status),
                    arrival=arrival,
                    departure=departure,
                    expected_minutes=expected,
                )
            )

            # Entries and breaks share one sequence, because the day is one
            # list: lunch sits between the morning's work and the afternoon's,
            # and that is where it has to come back out.
            for position, item in enumerate(day.items):
                if isinstance(item, ParsedBreak):
                    session.add(
                        Break(
                            date=date,
                            position=position,
                            is_noon=item.is_noon,
                            description=item.description,
                            start=item.start,
                            end=item.end,
                            minutes=item.minutes,
                        )
                    )
                    counts["breaks"] += 1
                    continue

                parsed = item
                project_id = None
                if parsed.project:
                    path_name = rules.canonical(parsed.project)
                    project = projects.get(path_name)
                    if project is None:
                        # The spreadsheet only coloured an undeclared project
                        # red, so plenty exist without a `+`. Whether this is a
                        # new project or a second spelling of an old one is a
                        # judgement only the owner can make.
                        if not parsed.declares:
                            path_name = resolver.project(
                                path_name, known=sorted(projects), date=date
                            )
                            project = projects.get(path_name)
                            if parsed.project not in resolver.settled:
                                undeclared.add(path_name)
                    if project is None:
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

        session.commit()

    return counts, undeclared, disagreements, unread, lunchless, many_lunches


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", help="path to the .ods file")
    parser.add_argument(
        "--reset",
        action="store_true",
        help="wipe what a previous import wrote before starting",
    )
    parser.add_argument("--rules", default=RULES_PATH, help=f"default: {RULES_PATH}")
    parser.add_argument("--decisions", default=DECISIONS_PATH, help=f"default: {DECISIONS_PATH}")
    parser.add_argument(
        "--batch",
        action="store_true",
        help="never ask; leave every conflict as the spreadsheet had it",
    )
    args = parser.parse_args()

    # The journal has accented names in it, and a Windows console is not UTF-8
    # by default: without this the first `é` ends the run. Only a real stream
    # can be reconfigured; piped into something else it is already someone's
    # problem to have chosen the encoding.
    if isinstance(sys.stdout, io.TextIOWrapper):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    rules = load_rules(args.rules)
    decisions = Decisions.load(args.decisions)
    interactive = not args.batch and sys.stdin.isatty()

    def keep_answers():
        """Save what was decided. Also on a Ctrl-C: a sitting is work."""
        if resolver.asked:
            decisions.save(args.decisions)
            answers = "answer" if resolver.asked == 1 else "answers"
            print(f"\n\nSaved {resolver.asked} {answers} to {args.decisions}.")

    try:
        with Session(db.engine()) as session:

            def release():
                """Put everything settled on disk and let go of the database.

                Called either side of every question. What has been read so far
                is good work and a question is slow, so rather than sit on an
                open write lock until the person answers, the run commits and
                takes a fresh transaction afterwards.
                """
                session.commit()
                if resolver.asked:
                    decisions.save(args.decisions)

            resolver = Resolver(
                decisions,
                ask=ask_on_terminal if interactive else None,
                rules=rules,
                release=release,
            )
            counts, undeclared, disagreements, unread, lunchless, many_lunches = run(
                args.workbook, session, reset=args.reset, rules=rules, resolver=resolver
            )
    except KeyboardInterrupt:
        # Expected, and often: deciding a long run by hand is done in sittings.
        keep_answers()
        print("\nStopped before the end, so this import is half-written: everything")
        print("read up to the last question is in the database, and nothing after it.")
        print("The answers above are kept and will not be asked again, so running")
        print("the same command with --reset carries on from where this stopped.")
        return 130
    except OperationalError as error:
        if "database is locked" not in str(error):
            raise
        # Almost always another import still sitting at a question, sometimes
        # one whose terminal is long gone. Nothing here can free it, so say
        # where to look rather than printing the whole stack.
        print(f"\n{db.DATABASE_PATH} is locked by something else.")
        print("\nUsually another importer waiting at a question. Find it with:")
        print("  Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" |")
        print('    Where-Object { $_.CommandLine -match "importer" }')
        print("\nAnswer it, or stop it with Stop-Process -Id <id>, then run this again.")
        return 1

    keep_answers()

    print(
        f"\n{counts['weeks']} weeks, {counts['days']} days, {counts['entries']} entries, "
        f"{counts['meta']} annotations, {counts['breaks']} breaks."
    )

    if undeclared:
        print(f"\n{len(undeclared)} projects were used before being declared:")
        for path in sorted(undeclared):
            print(f"  {path}")

    sections = []

    if many_lunches:
        sections.append(
            section(
                "LUNCH WRITTEN TWICE",
                "A day says where lunch was once: a `[# ...]` marker, or a blank row left\n"
                "in the column. These say it twice, so an extra break was taken off each.\n"
                "The two are named beside the date and marked with `>` in the column.",
                many_lunches,
            )
        )
        print(f"\n{len(many_lunches)} days say where lunch was more than once.")

    if lunchless:
        sections.append(
            section(
                "LUNCH NOT WRITTEN",
                "Working weekdays with no `[# ...]` marker and no blank row either.\n"
                "Each was given the usual hour, at the end of the day, since where it\n"
                "actually fell is not in the column. Write it in to place it properly.",
                lunchless,
            )
        )
        print(f"\n{len(lunchless)} working weekdays say nothing about lunch.")

    if disagreements:
        sections.append(
            section(
                "HOURS DISAGREE WITH THE FILED TOTAL",
                "The recomputation is what was stored. These are the days whose arrival,\n"
                "departure or breaks need correcting for the two to meet.",
                disagreements,
            )
        )
        said = "day disagreed with its" if len(disagreements) == 1 else "days disagreed with their"
        print(f"\n{len(disagreements)} {said} written total.")

    if sections:
        Path(REPORT_PATH).parent.mkdir(parents=True, exist_ok=True)
        Path(REPORT_PATH).write_text("\n\n\n".join(sections) + "\n", encoding="utf-8")
        print(f"All of them are listed in {REPORT_PATH}.")

    if unread:
        print(f"\n{len(unread)} annotations look like clock markers but were not read:")
        for line in unread[:10]:
            print(f"  {line}")
        if len(unread) > 10:
            print(f"  ... and {len(unread) - 10} more")
        print("Each one is time the day does not know about. Worth a rule.")

    if resolver.unresolved:
        print(
            f"\n{resolver.unresolved} conflicts were left as the spreadsheet had them. "
            "Run without --batch, in a terminal, to decide them."
        )


if __name__ == "__main__":
    sys.exit(main() or 0)
