"""What crosses the wire.

Deliberately not the table classes: a week is written back whole, so entries and
breaks arrive without ids — their order in the list *is* their position — and
come back with ids on read.
"""

import datetime as dt

from pydantic import BaseModel, model_validator

from models import DayStatus, EntryKind


class EntryIn(BaseModel):
    kind: EntryKind = EntryKind.TASK
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
    overtime_override: int | None = None


class DayIn(DayBase):
    #: Left unset, the weekday's default is snapshot onto the day as it is stored.
    expected_minutes: int | None = None
    entries: list[EntryIn] = []
    breaks: list[BreakIn] = []


class DayOut(DayBase):
    expected_minutes: int
    entries: list[EntryOut] = []
    breaks: list[BreakOut] = []


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
