import pytest
from fastapi.testclient import TestClient

import db
import noted


@pytest.fixture
def frontend(tmp_path):
    built = tmp_path / "frontend"
    built.mkdir()
    (built / "index.html").write_text("<title>Noted</title>")
    (built / "main.js").write_text("console.log('noted')")
    return built


@pytest.fixture
def client(tmp_path, frontend):
    db.reset()
    db.DATABASE_PATH = tmp_path / "noted.db"
    yield TestClient(noted.create(frontend))
    db.reset()


def test_the_frontend_is_served_at_the_root(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "<title>Noted</title>" in r.text


def test_the_frontend_files_are_served_beside_the_api(client):
    assert client.get("/main.js").text == "console.log('noted')"


def test_the_api_still_answers_beside_the_frontend(client):
    r = client.get("/weeks")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_a_missing_file_is_not_found(client):
    assert client.get("/nothing-here.js").status_code == 404
