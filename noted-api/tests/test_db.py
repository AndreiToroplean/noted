import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import db


def test_the_database_sits_next_to_the_packaged_exe(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", str(tmp_path / "Noted.exe"))
    assert db.default_path() == tmp_path / "noted.db"


def test_the_database_stays_in_data_during_development(monkeypatch):
    monkeypatch.delattr(sys, "frozen", raising=False)
    assert db.default_path() == Path("data") / "noted.db"


def test_a_new_database_survives_its_first_requests_arriving_together(tmp_path):
    # A browser's first page load asks for several things at once, and each
    # request would otherwise race to create the same tables.
    db.reset()
    db.DATABASE_PATH = tmp_path / "noted.db"
    start = threading.Barrier(8)

    def first_request():
        start.wait()
        db.engine()

    with ThreadPoolExecutor(8) as pool:
        for future in [pool.submit(first_request) for _ in range(8)]:
            future.result()
    db.reset()
