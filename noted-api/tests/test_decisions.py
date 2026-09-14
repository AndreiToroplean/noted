import datetime as dt

import importer


def test_decisions_start_empty(tmp_path):
    decisions = importer.Decisions.load(tmp_path / "nothing.toml")
    assert decisions.projects == {}


def test_decisions_survive_a_round_trip(tmp_path):
    path = tmp_path / "decisions.toml"
    decisions = importer.Decisions.load(path)
    decisions.projects["refactr"] = "refactor"
    # A dotted path is a name, not a nesting, so it has to come back whole.
    decisions.projects["atlas.2"] = importer.NEW
    decisions.save(path)

    reloaded = importer.Decisions.load(path)
    assert reloaded.projects == {"refactr": "refactor", "atlas.2": importer.NEW}


def test_a_remembered_project_is_not_asked_about_again(tmp_path):
    decisions = importer.Decisions.load(tmp_path / "d.toml")
    decisions.projects["refactr"] = "refactor"

    asked = []

    def never(*args, **kwargs):
        asked.append(args)
        raise AssertionError("should not have asked")

    resolver = importer.Resolver(decisions, ask=never)
    assert resolver.project("refactr", known=["refactor"], date=None) == "refactor"
    assert asked == []


def test_an_unknown_project_is_asked_about_and_remembered(tmp_path):
    decisions = importer.Decisions.load(tmp_path / "d.toml")
    resolver = importer.Resolver(decisions, ask=lambda *a, **k: "refactor")

    assert resolver.project("refactr", known=["refactor"], date=None) == "refactor"
    # Asked once, then remembered.
    assert decisions.projects["refactr"] == "refactor"


def test_a_project_kept_as_new_keeps_its_own_path(tmp_path):
    decisions = importer.Decisions.load(tmp_path / "d.toml")
    resolver = importer.Resolver(decisions, ask=lambda *a, **k: importer.NEW)
    assert resolver.project("atlas.2", known=["atlas"], date=None) == "atlas.2"


def test_rules_answer_before_anyone_is_asked(tmp_path):
    rules = importer.Rules(merge={"refactr": "refactor"}, declare={"atlas.2"})
    decisions = importer.Decisions.load(tmp_path / "d.toml")

    def never(*args, **kwargs):
        raise AssertionError("should not have asked")

    resolver = importer.Resolver(decisions, ask=never, rules=rules)
    assert resolver.project("refactr", known=["refactor"], date=None) == "refactor"
    assert resolver.project("atlas.2", known=["atlas"], date=None) == "atlas.2"


def test_without_a_person_to_ask_nothing_is_decided(tmp_path):
    # A non-interactive run must not silently invent an answer.
    decisions = importer.Decisions.load(tmp_path / "d.toml")
    resolver = importer.Resolver(decisions, ask=None)

    assert resolver.project("refactr", known=["refactor"], date=None) == "refactr"
    assert resolver.unresolved == 1


def test_the_database_is_let_go_of_around_a_question(tmp_path):
    # A question can sit unanswered for an hour, or outlive the terminal that
    # asked it. Holding a write transaction across it locks the database for
    # everyone, so the run lets go before asking and again once answered.
    decisions = importer.Decisions.load(tmp_path / "d.toml")
    events = []

    def ask(*args, **kwargs):
        events.append("asked")
        return "refactor"

    resolver = importer.Resolver(decisions, ask=ask, release=lambda: events.append("released"))
    resolver.project("refactr", known=["refactor"], date=None)

    assert events == ["released", "asked", "released"]


def test_a_remembered_answer_lets_go_of_nothing(tmp_path):
    # Nothing waits on a person, so there is no reason to break the transaction.
    decisions = importer.Decisions.load(tmp_path / "d.toml")
    decisions.projects["refactr"] = "refactor"
    released = []

    resolver = importer.Resolver(
        decisions, ask=None, release=lambda: released.append(True)
    )
    resolver.project("refactr", known=["refactor"], date=None)

    assert released == []


def test_a_second_process_can_write_while_a_question_waits(tmp_path):
    # The point of all this, checked against a real file rather than a spy: an
    # importer sitting at a question must not lock the database for anyone else.
    import sqlite3

    from sqlmodel import Session, SQLModel, create_engine

    from models import Project

    engine = create_engine(f"sqlite:///{tmp_path / 'noted.db'}")
    SQLModel.metadata.create_all(engine)
    decisions = importer.Decisions.load(tmp_path / "d.toml")
    taken = []

    with Session(engine) as session:
        # Something written but not committed, which is what holds the lock.
        session.add(Project(path="webApp", colour="#fff", declared_on=dt.date(2026, 1, 1)))
        session.flush()

        def ask(*args, **kwargs):
            other = sqlite3.connect(tmp_path / "noted.db", timeout=0.2)
            try:
                other.execute("BEGIN IMMEDIATE")
                taken.append(True)
                other.rollback()
            except sqlite3.OperationalError:
                taken.append(False)
            finally:
                other.close()
            return "webApp"

        resolver = importer.Resolver(
            decisions, ask=ask, release=lambda: session.commit()
        )
        resolver.project("webapp", known=["webApp"], date=None)

    assert taken == [True]
