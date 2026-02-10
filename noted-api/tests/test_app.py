import sys
from pathlib import Path

# Ensure the `api` directory is importable when tests are run from the repo root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import json
import pytest
from fastapi.testclient import TestClient

import app as app_module


@pytest.fixture
def client(tmp_path):
    # Point the app's DATA_DIR to a temporary dir to avoid touching repo files
    app_module.DATA_DIR = tmp_path
    return TestClient(app_module.app)


def test_get_empty_week_returns_empty_object(client):
    r = client.get("/journal/2026-02-09")
    assert r.status_code == 200
    assert r.json() == {}


def test_post_and_get_persists_and_writes_file(client, tmp_path):
    week = "2026-02-09"
    payload = {"note": "Pytest note"}

    r = client.post(f"/journal/{week}", json=payload)
    assert r.status_code == 200
    assert r.json() == {"ok": True}

    r = client.get(f"/journal/{week}")
    assert r.status_code == 200
    assert r.json() == payload

    # Check file on disk
    f = Path(app_module.DATA_DIR) / f"{week}.json"
    assert f.exists()
    stored = json.loads(f.read_text(encoding="utf-8"))
    assert stored == payload


@pytest.mark.parametrize("path", ["not-a-date", "2026-02-10"])  # invalid format, and not a Monday
def test_invalid_week_paths_return_400(client, path):
    r = client.get(f"/journal/{path}")
    assert r.status_code == 400


def test_post_requires_object_payload(client):
    # A list payload should be rejected. FastAPI may return 422 if body can't be parsed
    r = client.post("/journal/2026-02-09", json=[1, 2, 3])
    assert r.status_code in (400, 422)
    # If the handler raised our custom 400 error, ensure message is present
    if r.status_code == 400:
        assert "Payload must be a JSON object" in r.text
