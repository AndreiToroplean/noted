import importer


def test_decisions_start_empty(tmp_path):
    decisions = importer.Decisions.load(tmp_path / "nothing.toml")
    assert decisions.projects == {}
    assert decisions.overtime == {}


def test_decisions_survive_a_round_trip(tmp_path):
    path = tmp_path / "decisions.toml"
    decisions = importer.Decisions.load(path)
    decisions.projects["refactr"] = "refactor"
    # A dotted path is a name, not a nesting, so it has to come back whole.
    decisions.projects["atlas.2"] = importer.NEW
    decisions.overtime["2026-02-10"] = importer.WRITTEN
    decisions.save(path)

    reloaded = importer.Decisions.load(path)
    assert reloaded.projects == {"refactr": "refactor", "atlas.2": importer.NEW}
    assert reloaded.overtime == {"2026-02-10": importer.WRITTEN}


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


def test_an_overtime_disagreement_is_asked_about_once(tmp_path):
    decisions = importer.Decisions.load(tmp_path / "d.toml")
    calls = []

    def ask(*args, **kwargs):
        calls.append(args)
        return importer.WRITTEN

    resolver = importer.Resolver(decisions, ask=ask)
    assert resolver.overtime("2026-02-10", written=-30, recomputed=-15, lines=[]) == -30
    assert resolver.overtime("2026-02-10", written=-30, recomputed=-15, lines=[]) == -30
    assert len(calls) == 1


def test_choosing_the_recomputed_figure_returns_none():
    # None means "nothing to override" — the day computes itself.
    decisions = importer.Decisions()
    resolver = importer.Resolver(decisions, ask=lambda *a, **k: importer.RECOMPUTED)
    assert resolver.overtime("2026-02-10", written=-30, recomputed=-15, lines=[]) is None


def test_without_a_person_to_ask_nothing_is_decided(tmp_path):
    # A non-interactive run must not silently invent an answer.
    decisions = importer.Decisions.load(tmp_path / "d.toml")
    resolver = importer.Resolver(decisions, ask=None)

    assert resolver.project("refactr", known=["refactor"], date=None) == "refactr"
    assert resolver.overtime("2026-02-10", written=-30, recomputed=-15, lines=[]) is None
    assert resolver.unresolved == 2
