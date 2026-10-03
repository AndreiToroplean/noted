import threading
from concurrent.futures import ThreadPoolExecutor

import db


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
