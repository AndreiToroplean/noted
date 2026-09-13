import sys
from pathlib import Path

# Ensure the api directory is importable when tests are run from the repo root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient

import db
from app import app

WEEK = "2026-02-09"  # a Monday
TUESDAY = "2026-02-10"


@pytest.fixture
def client(tmp_path):
    # Point the database at a temporary file so tests never touch real data.
    db.reset()
    db.DATABASE_PATH = tmp_path / "noted.db"
    yield TestClient(app)
    db.reset()


@pytest.fixture
def project(client):
    return client.post("/projects", json={"path": "webApp", "colour": "#6fb373"}).json()


def test_empty_week_still_returns_seven_days(client):
    r = client.get(f"/journal/{WEEK}")
    assert r.status_code == 200
    days = r.json()["days"]
    assert len(days) == 7
    assert all(day["entries"] == [] for day in days)


def test_unsaved_days_are_seeded_from_the_weekday_defaults(client):
    days = client.get(f"/journal/{WEEK}").json()["days"]
    monday, friday, saturday = days[0], days[4], days[5]
    assert monday["departure"] == "17:00:00"
    assert monday["expected_minutes"] == 420
    # Friday is short, which is the whole reason defaults are per weekday.
    assert friday["departure"] == "16:00:00"
    assert friday["expected_minutes"] == 360
    assert saturday["expected_minutes"] == 0


@pytest.mark.parametrize("path", ["not-a-date", TUESDAY])
def test_invalid_week_paths_return_400(client, path):
    assert client.get(f"/journal/{path}").status_code == 400


def test_a_week_round_trips(client, project):
    payload = {
        "days": [
            {
                "date": WEEK,
                "arrival": "09:30:00",
                "departure": "18:30:00",
                "entries": [
                    {"text": "Wrote the importer", "project_id": project["id"], "done": True},
                    {"kind": "meta", "text": "On site"},
                ],
                "breaks": [{"is_noon": True, "start": "13:00:00", "end": "14:00:00"}],
            }
        ]
    }
    r = client.put(f"/journal/{WEEK}", json=payload)
    assert r.status_code == 200

    monday = client.get(f"/journal/{WEEK}").json()["days"][0]
    assert [entry["text"] for entry in monday["entries"]] == ["Wrote the importer", "On site"]
    assert [entry["position"] for entry in monday["entries"]] == [0, 1]
    assert monday["entries"][1]["kind"] == "meta"
    assert monday["breaks"][0]["is_noon"] is True


def test_a_week_write_replaces_what_was_there(client):
    first = {"days": [{"date": WEEK, "entries": [{"text": "Old"}, {"text": "Older"}]}]}
    client.put(f"/journal/{WEEK}", json=first)

    second = {"days": [{"date": WEEK, "entries": [{"text": "New"}]}]}
    client.put(f"/journal/{WEEK}", json=second)

    monday = client.get(f"/journal/{WEEK}").json()["days"][0]
    assert [entry["text"] for entry in monday["entries"]] == ["New"]


def test_a_day_outside_the_week_is_rejected(client):
    r = client.put(f"/journal/{WEEK}", json={"days": [{"date": "2026-03-02", "entries": []}]})
    assert r.status_code == 400


def test_an_undeclared_project_is_refused(client):
    payload = {"days": [{"date": WEEK, "entries": [{"text": "x", "project_id": 999}]}]}
    r = client.put(f"/journal/{WEEK}", json=payload)
    assert r.status_code == 400
    assert "has not been declared" in r.text


def test_an_unsaved_day_takes_the_default_expected_minutes(client):
    client.put(f"/journal/{WEEK}", json={"days": [{"date": WEEK, "entries": []}]})
    assert client.get(f"/journal/{WEEK}").json()["days"][0]["expected_minutes"] == 420


def test_declaring_a_project_twice_makes_two_projects(client):
    # Identity is the declaration, not the path: same name, different projects.
    first = client.post("/projects", json={"path": "refactor", "colour": "#40701c"}).json()
    second = client.post("/projects", json={"path": "refactor", "colour": "#104769"}).json()
    assert first["id"] != second["id"]
    assert len(client.get("/projects").json()) == 2


def test_a_project_colour_can_be_overruled(client, project):
    r = client.patch(f"/projects/{project['id']}", json={"colour": "#974845"})
    assert r.status_code == 200
    assert r.json()["colour"] == "#974845"
    assert r.json()["path"] == "webApp"


def test_an_unknown_category_is_refused(client):
    payload = {"days": [{"date": WEEK, "entries": [{"text": "x", "category": "Z"}]}]}
    assert client.put(f"/journal/{WEEK}", json=payload).status_code == 400


def test_a_declared_category_is_accepted(client):
    client.put("/categories/M", json={"meaning": "Meeting", "colour": "#351c75"})
    payload = {"days": [{"date": WEEK, "entries": [{"text": "Standup", "category": "M"}]}]}
    assert client.put(f"/journal/{WEEK}", json=payload).status_code == 200


def test_a_break_cannot_state_both_a_range_and_a_duration(client):
    payload = {
        "days": [{"date": WEEK, "breaks": [{"start": "13:00:00", "minutes": 60}], "entries": []}]
    }
    assert client.put(f"/journal/{WEEK}", json=payload).status_code == 422


def test_an_open_break_is_allowed(client):
    # Leaving is recorded before returning; that is a normal state, not an error.
    payload = {"days": [{"date": WEEK, "breaks": [{"start": "13:00:00"}], "entries": []}]}
    assert client.put(f"/journal/{WEEK}", json=payload).status_code == 200


def test_settings_are_editable_per_weekday(client):
    r = client.put("/settings/4", json={"departure": "17:00:00", "expected_minutes": 390})
    assert r.status_code == 200
    friday = next(row for row in client.get("/settings").json() if row["weekday"] == 4)
    assert friday["expected_minutes"] == 390


def test_editing_settings_does_not_rewrite_a_day_already_recorded(client):
    client.put(f"/journal/{WEEK}", json={"days": [{"date": WEEK, "entries": []}]})
    client.put("/settings/0", json={"departure": "20:00:00", "expected_minutes": 600})
    monday = client.get(f"/journal/{WEEK}").json()["days"][0]
    assert monday["expected_minutes"] == 420


def test_the_current_week_is_always_listed(client):
    # A fresh database still needs somewhere for the app to start.
    assert len(client.get("/weeks").json()) == 1


def test_saved_weeks_are_listed_newest_first(client):
    client.put("/journal/2026-02-09", json={"days": [{"date": "2026-02-11", "entries": []}]})
    client.put("/journal/2026-03-02", json={"days": [{"date": "2026-03-02", "entries": []}]})
    weeks = client.get("/weeks").json()
    assert weeks[:2] == sorted(weeks, reverse=True)[:2]
    assert "2026-02-09" in weeks and "2026-03-02" in weeks
