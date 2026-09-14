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

Run in a terminal, it **asks** rather than guesses. Two things it cannot decide
alone: whether a project used without a `+` is new or a second spelling of one
that exists, and which figure to keep where a day's hand-written `=> +1h`
disagrees with the recomputation. For the second it prints the day — hours,
breaks, entries — so the choice can be made by looking at it.

Answers go to `importer-decisions.toml` and are not asked again, so a re-run
after fixing the parsing only stops at what is genuinely new. Delete that file
to start the questions over. `--batch` never asks and leaves every conflict as
the spreadsheet had it.
"""

import argparse
import datetime as dt
import tomllib
from pathlib import Path
import random
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass, field

from sqlmodel import Session, SQLModel, select

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
    description: str | None = None


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
    #: Annotations that look like clock markers but matched no rule. Never drop
    #: these quietly: breaks went missing that way once.
    unread: list[str] = field(default_factory=list)


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
            if TIME_ISH.search(inner):
                day.unread.append(entry.text.strip())
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
        # `[# 45m out for a coffee]` — a length, a note, or both. What is left
        # after the length is worth keeping: it is often who it was with.
        rest = match.group(1).strip()
        found = FIRST_DURATION.search(rest)
        minutes = parse_duration(found.group(1)) if found else DEFAULT_LUNCH
        said = (rest[: found.start()] + rest[found.end() :] if found else rest).strip()
        day.breaks.append(ParsedBreak(True, minutes=minutes, description=said or None))
        return True

    if match := BARE_DURATION.match(inner):
        day.breaks.append(ParsedBreak(False, minutes=parse_duration(match.group(1))))
        return True

    # Last, because the others are more specific: an annotation that ends in a
    # parenthesised deduction is a break, and whatever precedes it says why.
    if match := DEDUCTION.match(inner):
        said = match.group(1).strip()
        day.breaks.append(
            ParsedBreak(False, minutes=parse_duration(match.group(2)), description=said or None)
        )
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


NEW = "*new*"
WRITTEN = "written"
RECOMPUTED = "recomputed"

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
    overtime: dict[str, str] = field(default_factory=dict)

    @classmethod
    def load(cls, path=DECISIONS_PATH) -> "Decisions":
        try:
            with open(path, "rb") as handle:
                raw = tomllib.load(handle)
        except FileNotFoundError:
            return cls()
        return cls(projects=raw.get("projects", {}), overtime=raw.get("overtime", {}))

    def save(self, path=DECISIONS_PATH):
        lines = [
            "# Written by importer.py as questions get answered. Safe to delete:",
            "# deleting it only means being asked again.",
            "",
            "[projects]",
        ]
        for name, answer in sorted(self.projects.items()):
            lines.append(f"{quote_key(name)} = {quote_key(answer)}")
        lines += ["", "[overtime]"]
        for date, answer in sorted(self.overtime.items()):
            lines.append(f"{quote_key(date)} = {quote_key(answer)}")
        Path(path).write_text("\n".join(lines) + "\n", encoding="utf-8")


class Resolver:
    """Answers the questions an import raises, asking a person when it must.

    `ask` is a callable taking the question, the options and the context to
    show. Passing None makes the run non-interactive: nothing is invented, the
    spreadsheet's own reading stands, and `unresolved` counts what was left.
    """

    def __init__(self, decisions: Decisions, ask=None, rules: Rules | None = None):
        self.decisions = decisions
        self.ask = ask
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
            answer = self.ask(
                question=f"Project {path!r} was used without being declared.",
                options=[(NEW, f"a new project called {path}")]
                + [(name, f"the same as {name}") for name in known],
                context=[f"First seen {date}." if date else ""],
            )
            self.decisions.projects[path] = answer
            self.asked += 1

        self.settled.add(path)
        return path if answer == NEW else answer

    def overtime(self, date: str, written: int, recomputed: int, lines: list[str]) -> int | None:
        """The figure to record as an override, or None to let the day compute."""
        answer = self.decisions.overtime.get(date)
        if answer is None:
            if self.ask is None:
                self.unresolved += 1
                return None
            answer = self.ask(
                question=f"{date}: written {written:+d}m, recomputed {recomputed:+d}m.",
                options=[
                    (WRITTEN, f"keep what was written, {written:+d}m"),
                    (RECOMPUTED, f"keep the recomputation, {recomputed:+d}m"),
                ],
                context=lines,
            )
            self.decisions.overtime[date] = answer
            self.asked += 1

        return written if answer == WRITTEN else None


def describe_day(date, day: ParsedDay, arrival, departure, breaks, expected) -> list[str]:
    """The day, readably, so a choice can be made by looking at it."""
    lines = [f"{date:%A %d %B %Y}", ""]
    lines.append(f"  arrived {arrival:%H:%M}" if arrival else "  arrival not recorded")
    for pause in breaks:
        if pause.start and pause.end:
            span = f"{pause.start:%H:%M}-{pause.end:%H:%M}"
        elif pause.minutes is not None:
            span = f"{pause.minutes}m"
        else:
            span = "open"
        lines.append(f"  {'lunch' if pause.is_noon else 'break'} {span}")
    lines.append(f"  left {departure:%H:%M}" if departure else "  departure not recorded")
    lines.append("")
    for entry in day.entries:
        mark = "x" if getattr(entry, "done", False) else " "
        label = f"[{entry.category}] " if entry.category else ""
        lines.append(f"  [{mark}] {label}{entry.text}"[:100])
    lines.append("")
    lines.append(f"  expected {expected}m")
    return lines


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
            reply = input("choose [1]: ").strip()
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
            present -= minutes_of(pause.end) - minutes_of(pause.start)
    return present


def minutes_of(clock: dt.time) -> int:
    return clock.hour * 60 + clock.minute


# What the spreadsheet owns. Settings, categories and the overtime baseline are
# the owner's own and survive a reset.
IMPORTED = [SQLModel.metadata.tables[model.__name__.lower()] for model in (Entry, Break, Day, Project)]


def wipe(session: Session):
    """Drop and rebuild the tables the import writes, so it can be run again.

    Dropping rather than deleting because the models move while the parsing is
    still being got right: a database written before a column existed would keep
    its old shape forever, and the next insert would fail on the missing column.
    """
    session.commit()
    engine = session.get_bind()
    SQLModel.metadata.drop_all(engine, tables=IMPORTED)
    SQLModel.metadata.create_all(engine, tables=IMPORTED)


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
    disagreements: list[str] = []
    unread: list[str] = []

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
            unread += [f"{date}  {text}" for text in day.unread]
            if not day.entries and not day.breaks and day.status == "working":
                continue

            default = defaults.get(date.weekday())
            arrival = day.arrival or (default.arrival if default else None)
            departure = day.departure or (default.departure if default else None)
            expected = default.expected_minutes if default else 0
            if day.status != "working":
                expected = 0

            # A weekday with no `#` marker still had lunch — that is what made
            # the owner's own totals come out right.
            breaks = list(day.breaks)
            if (
                day.status == "working"
                and date.weekday() < 5
                and not any(pause.is_noon for pause in breaks)
            ):
                breaks.append(ParsedBreak(True, minutes=DEFAULT_LUNCH))

            # Where the day was filed by hand, check the recomputation agrees,
            # and where it does not, let the person looking at it decide.
            override = None
            if day.explicit_overtime is not None and arrival and departure:
                computed = worked_minutes(ParsedDay(breaks=breaks), arrival, departure) - expected
                if computed != day.explicit_overtime:
                    disagreements.append(
                        f"{date}  written {day.explicit_overtime:+d}m, "
                        f"recomputed {computed:+d}m  "
                        f"({arrival:%H:%M}-{departure:%H:%M}, expected {expected}m)"
                    )
                    override = resolver.overtime(
                        date.isoformat(),
                        written=day.explicit_overtime,
                        recomputed=computed,
                        lines=describe_day(date, day, arrival, departure, breaks, expected),
                    )

            session.add(
                Day(
                    date=date,
                    status=DayStatus(day.status),
                    arrival=arrival,
                    departure=departure,
                    expected_minutes=expected,
                    overtime_override=override,
                )
            )

            for position, pause in enumerate(breaks):
                session.add(
                    Break(
                        date=date,
                        position=position,
                        is_noon=pause.is_noon,
                        description=pause.description,
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

    return counts, undeclared, disagreements, unread


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

    rules = load_rules(args.rules)
    decisions = Decisions.load(args.decisions)
    interactive = not args.batch and sys.stdin.isatty()
    resolver = Resolver(decisions, ask=ask_on_terminal if interactive else None, rules=rules)

    try:
        with Session(db.engine()) as session:
            counts, undeclared, disagreements, unread = run(
                args.workbook, session, reset=args.reset, rules=rules, resolver=resolver
            )
    finally:
        # Save even on a Ctrl-C, so a long session of answers is never lost.
        if resolver.asked:
            decisions.save(args.decisions)
            print(f"\nSaved {resolver.asked} answers to {args.decisions}.")

    print(
        f"\n{counts['weeks']} weeks, {counts['days']} days, {counts['entries']} entries, "
        f"{counts['meta']} annotations, {counts['breaks']} breaks."
    )

    if undeclared:
        print(f"\n{len(undeclared)} projects were used before being declared:")
        for path in sorted(undeclared):
            print(f"  {path}")

    if disagreements:
        Path(REPORT_PATH).parent.mkdir(parents=True, exist_ok=True)
        Path(REPORT_PATH).write_text(
            "Days whose hand-written overtime disagrees with the recomputation.\n\n"
            + "\n".join(disagreements)
            + "\n",
            encoding="utf-8",
        )
        print(f"\n{len(disagreements)} days disagreed with their written total.")
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
    main()
