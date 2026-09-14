"""What crosses the wire.

Deliberately not the table classes: a week is written back whole, so a day's
items arrive without ids — their order in the list *is* their position — and
come back with ids on read. Entries and breaks share that one list, because a
break happened somewhere in the day and not underneath it.
"""

import datetime as dt
from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator

from models import DayStatus, EntryKind


class EntryIn(BaseModel):
    #: Spelt out rather than left as the enum so that it can tell an entry
    #: from a break in a day's one list of items.
    kind: Literal[EntryKind.TASK, EntryKind.META] = EntryKind.TASK
    done: bool = False
    category: str | None = None
    project_id: int | None = None
    text: str = ""
    note: str | None = None
    explicit_minutes: int | None = None
    explicit_start: dt.time | None = None
    explicit_end: dt.time | None = None
    approx_weight: float | None = None


class EntryOut(EntryIn):
    id: int
    position: int


class BreakIn(BaseModel):
    #: Not stored — a break is its own table. It is here so that a day's items
    #: can arrive as one list and still be told apart.
    kind: Literal["break"] = "break"
    is_noon: bool = False
    description: str | None = None
    start: dt.time | None = None
    end: dt.time | None = None
    minutes: int | None = None

    @model_validator(mode="after")
    def one_way_of_saying_it(self):
        if self.minutes is not None and (self.start or self.end):
            raise ValueError("A break has either a start/end pair or a duration, not both.")
        if self.end and not self.start:
            raise ValueError("A break cannot end without starting.")
        return self


class BreakOut(BreakIn):
    id: int
    position: int


class DayBase(BaseModel):
    """What a day is either way. The two directions differ in three fields, and
    narrowing them by inheriting would be an override rather than a schema."""

    date: dt.date
    status: DayStatus = DayStatus.WORKING
    arrival: dt.time | None = None
    departure: dt.time | None = None


#: A day is one ordered list, not a list of entries and a list of breaks: lunch
#: happened between the morning's work and the afternoon's, and the list is where
#: that is recorded. `kind` tells the two apart.
DayItemIn = Annotated[EntryIn | BreakIn, Field(discriminator="kind")]
DayItemOut = Annotated[EntryOut | BreakOut, Field(discriminator="kind")]


class DayIn(DayBase):
    #: Left unset, the weekday's default is snapshot onto the day as it is stored.
    expected_minutes: int | None = None
    items: list[DayItemIn] = []


class DayOut(DayBase):
    expected_minutes: int
    items: list[DayItemOut] = []


class WeekIn(BaseModel):
    days: list[DayIn] = []


class WeekOut(BaseModel):
    week: dt.date
    days: list[DayOut] = []


class ProjectIn(BaseModel):
    path: str
    colour: str
    description: str = ""


class ProjectPatch(BaseModel):
    colour: str | None = None
    description: str | None = None


class CategoryIn(BaseModel):
    meaning: str = ""
    colour: str


class SettingsIn(BaseModel):
    arrival: dt.time | None = None
    break_start: dt.time | None = None
    break_end: dt.time | None = None
    departure: dt.time | None = None
    expected_minutes: int = 0


class OvertimeIn(BaseModel):
    since: dt.date | None = None
    minutes: int = 0


class OvertimeOut(OvertimeIn):
    pass
