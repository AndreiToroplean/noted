"""Noted's API.

One local user, one SQLite file. A week is the unit of writing: the client sends
the whole week back and it replaces what was stored, which is why there are no
per-entry endpoints.
"""

from datetime import date, timedelta

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, col, delete, select

import db
from models import Break, Category, Day, DayStatus, Entry, OvertimeBaseline, Project, Settings
from schemas import (
    BreakOut,
    CategoryIn,
    DayOut,
    EntryOut,
    OvertimeIn,
    OvertimeOut,
    ProjectIn,
    ProjectPatch,
    SettingsIn,
    WeekIn,
    WeekOut,
)

app = FastAPI(title="Noted")

# The frontend is served from the Angular dev server during development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def monday(week: str) -> date:
    try:
        day = date.fromisoformat(week)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid week format. Use YYYY-MM-DD.")
    if day.weekday() != 0:
        raise HTTPException(status_code=400, detail="Week must be a Monday (YYYY-MM-DD).")
    return day


def week_dates(start: date) -> list[date]:
    return [start + timedelta(days=offset) for offset in range(7)]


# --- The journal ------------------------------------------------------------


@app.get("/weeks", response_model=list[date])
def list_weeks(session: Session = Depends(db.session)):
    """The Mondays that have anything stored, newest first.

    There is no week table — a week is a date range — so this is a query over
    the days. The current week is always included, so the app has somewhere to
    start on a fresh database.
    """
    mondays = {
        day - timedelta(days=day.weekday()) for day in session.exec(select(col(Day.date))).all()
    }
    today = date.today()
    mondays.add(today - timedelta(days=today.weekday()))
    return sorted(mondays, reverse=True)


@app.get("/journal/{week}", response_model=WeekOut)
def read_week(week: str, session: Session = Depends(db.session)):
    """The seven days of a week.

    Days with nothing stored are still returned, seeded from the weekday
    defaults, so the client always gets a full week to render.
    """
    start = monday(week)
    dates = week_dates(start)

    stored = {day.date: day for day in session.exec(select(Day).where(col(Day.date).in_(dates)))}
    entries = session.exec(
        select(Entry).where(col(Entry.date).in_(dates)).order_by(col(Entry.position))
    ).all()
    breaks = session.exec(
        select(Break).where(col(Break.date).in_(dates)).order_by(col(Break.position))
    ).all()
    defaults = {row.weekday: row for row in session.exec(select(Settings))}

    days = []
    for day_date in dates:
        day = stored.get(day_date)
        default = defaults.get(day_date.weekday())
        days.append(
            DayOut(
                date=day_date,
                status=day.status if day else DayStatus.WORKING,
                arrival=day.arrival if day else (default.arrival if default else None),
                departure=day.departure if day else (default.departure if default else None),
                expected_minutes=(
                    day.expected_minutes if day else (default.expected_minutes if default else 0)
                ),
                entries=[
                    EntryOut.model_validate(entry, from_attributes=True)
                    for entry in entries
                    if entry.date == day_date
                ],
                breaks=[
                    BreakOut.model_validate(pause, from_attributes=True)
                    for pause in breaks
                    if pause.date == day_date
                ],
            )
        )
    return WeekOut(week=start, days=days)


@app.put("/journal/{week}", response_model=WeekOut)
def replace_week(week: str, payload: WeekIn, session: Session = Depends(db.session)):
    """Replace a whole week with what the client sends."""
    start = monday(week)
    dates = set(week_dates(start))

    known_projects = set(session.exec(select(col(Project.id))).all())
    known_categories = set(session.exec(select(col(Category.name))).all())
    defaults = {row.weekday: row.expected_minutes for row in session.exec(select(Settings))}

    for day in payload.days:
        if day.date not in dates:
            raise HTTPException(status_code=400, detail=f"{day.date} is not in the week of {start}.")
        for entry in day.entries:
            # Stricter than the spreadsheet, which merely coloured the row red.
            # Two projects diverging on a typo is the failure being prevented.
            if entry.project_id is not None and entry.project_id not in known_projects:
                raise HTTPException(
                    status_code=400, detail=f"Project {entry.project_id} has not been declared."
                )
            if entry.category is not None and entry.category not in known_categories:
                raise HTTPException(status_code=400, detail=f"Unknown category {entry.category!r}.")

    session.exec(delete(Entry).where(col(Entry.date).in_(dates)))
    session.exec(delete(Break).where(col(Break.date).in_(dates)))
    session.exec(delete(Day).where(col(Day.date).in_(dates)))

    for day in payload.days:
        session.add(
            Day(
                date=day.date,
                status=day.status,
                arrival=day.arrival,
                departure=day.departure,
                expected_minutes=(
                    day.expected_minutes
                    if day.expected_minutes is not None
                    else defaults.get(day.date.weekday(), 0)
                ),
            )
        )
        for position, entry in enumerate(day.entries):
            session.add(Entry(date=day.date, position=position, **entry.model_dump()))
        for position, pause in enumerate(day.breaks):
            session.add(Break(date=day.date, position=position, **pause.model_dump()))

    session.commit()
    return read_week(week, session)


# --- Projects ---------------------------------------------------------------


@app.get("/projects", response_model=list[Project])
def list_projects(session: Session = Depends(db.session)):
    return session.exec(select(Project).order_by(col(Project.path))).all()


@app.post("/projects", response_model=Project, status_code=201)
def declare_project(payload: ProjectIn, session: Session = Depends(db.session)):
    """Declare a project.

    A path is not unique on purpose: declaring the same name again begins a
    second, unrelated project. Identity is the declaration.
    """
    project = Project(**payload.model_dump(), declared_on=date.today())
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


@app.patch("/projects/{project_id}", response_model=Project)
def update_project(project_id: int, payload: ProjectPatch, session: Session = Depends(db.session)):
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="No such project.")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(project, field, value)
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


# --- Categories -------------------------------------------------------------


@app.get("/categories", response_model=list[Category])
def list_categories(session: Session = Depends(db.session)):
    return session.exec(select(Category).order_by(col(Category.name))).all()


@app.put("/categories/{name}", response_model=Category)
def upsert_category(name: str, payload: CategoryIn, session: Session = Depends(db.session)):
    category = session.get(Category, name) or Category(name=name, colour=payload.colour)
    category.meaning = payload.meaning
    category.colour = payload.colour
    session.add(category)
    session.commit()
    session.refresh(category)
    return category


# --- Settings ---------------------------------------------------------------


@app.get("/settings", response_model=list[Settings])
def read_settings(session: Session = Depends(db.session)):
    return session.exec(select(Settings).order_by(col(Settings.weekday))).all()


@app.put("/settings/{weekday}", response_model=Settings)
def update_settings(weekday: int, payload: SettingsIn, session: Session = Depends(db.session)):
    if not 0 <= weekday <= 6:
        raise HTTPException(status_code=400, detail="Weekday must be 0 (Monday) to 6.")
    row = session.get(Settings, weekday) or Settings(weekday=weekday)
    for field, value in payload.model_dump().items():
        setattr(row, field, value)
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


# --- Overtime ---------------------------------------------------------------


@app.get("/overtime", response_model=OvertimeOut)
def read_overtime(session: Session = Depends(db.session)):
    """Where the running total counts from."""
    return session.get(OvertimeBaseline, OvertimeBaseline.ROW_ID) or OvertimeBaseline()


@app.put("/overtime", response_model=OvertimeOut)
def reset_overtime(payload: OvertimeIn, session: Session = Depends(db.session)):
    row = session.get(OvertimeBaseline, OvertimeBaseline.ROW_ID) or OvertimeBaseline()
    row.since = payload.since
    row.minutes = payload.minutes
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
