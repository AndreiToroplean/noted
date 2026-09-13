import sys
from pathlib import Path

# The api directory holds the app as top-level modules, so make it importable
# once, here, rather than from each test file — importing `models` twice under
# two names would define its tables twice.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
