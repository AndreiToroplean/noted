"""Typing a line into a day: the spreadsheet's syntax, read into fields once."""

import pytest
from fastapi.testclient import TestClient

import db
from app import app


@pytest.fixture
def client(tmp_path):
    db.reset()
    db.DATABASE_PATH = tmp_path / "noted.db"
    yield TestClient(app)
    db.reset()


def parse(client, text):
    return client.post("/parse", json={"text": text})


def test_a_task_is_split_into_its_fields(client):
    project = client.post("/projects", json={"path": "webApp", "colour": "#6fb373"}).json()
    item = parse(client, "[T] webApp: Fixed the header.\nIt was the z-index").json()
    assert item == {
        "kind": "task",
        "done": False,
        "category": "T",
        "project_id": project["id"],
        "text": "Fixed the header.",
        "note": "It was the z-index",
        "explicit_minutes": None,
        "explicit_start": None,
        "explicit_end": None,
        "approx_weight": None,
    }


def test_a_category_is_matched_whatever_its_case(client):
    # Holding shift for the second letter of `Tr` is not something to be
    # refused over; the vocabulary's own spelling is what gets stored.
    assert parse(client, "[TR] Train to the client").json()["category"] == "Tr"


def test_an_unknown_category_is_refused(client):
    r = parse(client, "[Zz] Something")
    assert r.status_code == 422
    assert "Zz" in r.json()["detail"]


def test_a_line_with_no_category_is_still_a_task(client):
    item = parse(client, "Just some text").json()
    assert (item["kind"], item["category"], item["text"]) == ("task", None, "Just some text")


def test_an_annotation_is_a_meta_entry(client):
    item = parse(client, "[On site]").json()
    assert (item["kind"], item["text"]) == ("meta", "[On site]")


def test_a_lunch_marker_is_a_break(client):
    item = parse(client, "[# 1h15 with the team]").json()
    assert item == {
        "kind": "break",
        "is_noon": True,
        "description": "with the team",
        "start": None,
        "end": None,
        "minutes": 75,
    }


def test_a_ranged_break_keeps_its_clock(client):
    item = parse(client, "[10:15 -> 10:30]").json()
    assert (item["kind"], item["is_noon"], item["start"], item["end"]) == (
        "break",
        False,
        "10:15:00",
        "10:30:00",
    )


def test_a_short_break_is_a_break(client):
    item = parse(client, "[-15m]").json()
    assert (item["kind"], item["is_noon"], item["minutes"]) == ("break", False, 15)


def test_an_arrow_is_a_clock_time_for_the_day(client):
    # Whether it is the arrival or the departure depends on where in the day it
    # is written, which only the client knows.
    assert parse(client, "[-> 9:15]").json() == {"kind": "clock", "time": "09:15:00"}


def test_a_known_project_resolves_to_its_latest_declaration(client):
    client.post("/projects", json={"path": "webApp", "colour": "#111111"})
    latest = client.post("/projects", json={"path": "webApp", "colour": "#222222"}).json()
    assert parse(client, "[T] webApp: Again").json()["project_id"] == latest["id"]


def test_an_undeclared_project_is_refused_with_the_fix(client):
    r = parse(client, "[T] webApp: Something")
    assert r.status_code == 422
    assert "+webApp:" in r.json()["detail"]


def test_a_plus_declares_the_project(client):
    item = parse(client, "[T] +webApp: Started it").json()
    projects = client.get("/projects").json()
    assert [project["path"] for project in projects] == ["webApp"]
    assert item["project_id"] == projects[0]["id"]


def test_an_empty_line_is_refused(client):
    assert parse(client, "   ").status_code == 422
