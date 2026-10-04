import sys
from pathlib import Path

import pytest

# The api directory holds the app as top-level modules, so make it importable
# once, here, rather than from each test file — importing `models` twice under
# two names would define its tables twice.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import seed  # noqa: E402


@pytest.fixture(autouse=True)
def shipped_seed(tmp_path, monkeypatch):
    """Seed from `seed.toml`, whatever the person running the tests has locally.

    `seed-local.toml` is a real file on the machine of anyone whose hours are
    not the defaults, and the suite must not read it: tests describe the app,
    not its owner.
    """
    monkeypatch.setattr(seed, "LOCAL_PATH", tmp_path / "no-seed-local.toml")
