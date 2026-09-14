"""The stored shape of a journal.

Mirrors §2 of `docs/specification.md`; read that first, it explains *why* the model
looks like this. The short version: there is no week table because a week is a date
range, projects carry a surrogate id because two projects may share a path, and no
entry stores a duration because durations are solved for on read.
"""

import datetime as dt
from enum import StrEnum
from typing import ClassVar

from sqlmodel import Field, SQLModel


class DayStatus(StrEnum):
    WORKING = "working"
    PAID_HOLIDAY = "paid_holiday"
    HOLIDAY = "holiday"
    UNPAID = "unpaid"
    SICK = "sick"
    OFF = "off"


class EntryKind(StrEnum):
    TASK = "task"
    #: A bracketed annotation about the day rather than about work done, like
    #: `[On site]`. Keeps its place in the flow but is excluded from time maths.
    META = "meta"


class Settings(SQLModel, table=True):
    """Default hours, one row per weekday. Friday is short, hence per-weekday.

    These are snapshot onto a day as it is created, never read live, so editing
    them cannot rewrite days already recorded.
    """

    weekday: int = Field(primary_key=True, ge=0, le=6)
    arrival: dt.time | None = None
    break_start: dt.time | None = None
    break_end: dt.time | None = None
    departure: dt.time | None = None
    expected_minutes: int = 0


class Category(SQLModel, table=True):
    """A closed, curated vocabulary. Colours are chosen by hand, not sampled."""

    name: str = Field(primary_key=True)
    meaning: str = ""
    colour: str


class Project(SQLModel, table=True):
    """What an entry was *for*.

    `path` is dot-separated and nests (`refactor.A`). It is deliberately *not*
    unique: a project's identity is its declaration, so declaring the same name
    twice begins a second, unrelated project.
    """

    id: int | None = Field(default=None, primary_key=True)
    path: str = Field(index=True)
    colour: str
    description: str = ""
    declared_on: dt.date


class Day(SQLModel, table=True):
    date: dt.date = Field(primary_key=True)
    status: DayStatus = DayStatus.WORKING
    arrival: dt.time | None = None
    departure: dt.time | None = None
    expected_minutes: int = 0


class Entry(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    date: dt.date = Field(foreign_key="day.date", index=True)
    position: int
    kind: EntryKind = EntryKind.TASK
    done: bool = False
    category: str | None = Field(default=None, foreign_key="category.name")
    project_id: int | None = Field(default=None, foreign_key="project.id")
    text: str = ""
    note: str | None = None

    # The only timing an entry ever stores. Everything else about how long it
    # took is solved for against the day's total — see specification §6.4.
    explicit_minutes: int | None = None
    explicit_start: dt.time | None = None
    explicit_end: dt.time | None = None
    #: Set when the entry said something vague like `[Several hours]`: a weight
    #: in the even split, not a duration. Unset means a weight of 1.
    approx_weight: float | None = None


class Break(SQLModel, table=True):
    """Either a start/end pair or a bare duration, never both.

    An open break — a start with no end — is a normal state, not an error: the
    user marks leaving and completes it on return.
    """

    id: int | None = Field(default=None, primary_key=True)
    date: dt.date = Field(foreign_key="day.date", index=True)
    position: int
    #: What distinguishes lunch from an ad-hoc pause.
    is_noon: bool = False
    description: str | None = None
    start: dt.time | None = None
    end: dt.time | None = None
    minutes: int | None = None


class OvertimeBaseline(SQLModel, table=True):
    """Where the running overtime total counts from.

    One row. A total accumulated over years is only useful if a bad day can be
    corrected out of it, so the user can declare "as of this date I was `minutes`
    ahead" and have everything before it stop counting.
    """

    ROW_ID: ClassVar[int] = 1

    id: int = Field(default=ROW_ID, primary_key=True)
    #: Count days from here. Unset means from the very first day recorded.
    since: dt.date | None = None
    #: The balance already carried at that point.
    minutes: int = 0
