"""
Raja Mantri Chor Sipahi engine (core/roles.py): dealing, who sees which
role when, scoring, the Mantri's blaster, timeouts, bots and the match end.
Run from backend/:  python -m pytest tests/test_roles.py -v
"""
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from core.roles import POINTS, ROUNDS, TIMES, RolesError, RolesMatch, Seat


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


@pytest.fixture
def clock():
    return Clock()


def make(clock, bots=0, seed=7):
    seats = [Seat(f"p{i}", f"P{i}", "char:m-Casual", bot=i >= 4 - bots) for i in range(4)]
    return RolesMatch(seats, clock=clock, rng=random.Random(seed))


def deal(m, roles):
    """Give each seat the role named in `roles` (seat id -> role) by picking that slip."""
    for sid, role in roles.items():
        m.pick(sid, m.slips.index(role))


DEAL = {"p0": "raja", "p1": "mantri", "p2": "chor", "p3": "sipahi"}


def to_guess(m, clock):
    deal(m, DEAL)
    for phase in ("raja", "mantri"):
        assert m.phase == phase
        clock.t += TIMES[phase]
        assert m.tick()
    assert m.phase == "guess"


def roles_seen_by(m, viewer):
    return {s["id"]: s["role"] for s in m.state_for(viewer)["seats"]}


def test_a_round_starts_with_four_hidden_slips(clock):
    m = make(clock)
    st = m.state_for("p0")
    assert (st["round"], st["rounds"], st["phase"]) == (1, ROUNDS, "pick")
    assert sorted(m.slips) == sorted(POINTS) and st["slips"] == [None] * 4
    assert all(s["role"] is None and not s["picked"] for s in st["seats"])


def test_picking_slips(clock):
    m = make(clock)
    m.pick("p0", 2)
    assert m.state_for("p1")["slips"][2] == "p0"
    with pytest.raises(RolesError, match="already have"):
        m.pick("p0", 1)
    with pytest.raises(RolesError, match="Someone took"):
        m.pick("p1", 2)
    for bad in (4, -1, "1", True, None):
        with pytest.raises(RolesError):
            m.pick("p1", bad)
    with pytest.raises(RolesError, match="not at this table"):
        m.pick("stranger", 0)
    for sid, slot in (("p1", 0), ("p2", 1), ("p3", 3)):
        m.pick(sid, slot)
    assert m.phase == "raja"


def test_roles_are_revealed_step_by_step(clock):
    m = make(clock)
    deal(m, DEAL)
    # Raja's turn: only the Raja is public (plus your own slip)
    assert roles_seen_by(m, "p2") == {"p0": "raja", "p1": None, "p2": "chor", "p3": None}
    clock.t += TIMES["raja"]
    m.tick()
    assert roles_seen_by(m, "p3") == {"p0": "raja", "p1": "mantri", "p2": None, "p3": "sipahi"}
    clock.t += TIMES["mantri"]
    m.tick()
    assert roles_seen_by(m, "p1")["p2"] is None and roles_seen_by(m, "p1")["p3"] is None   # the Mantri must guess
    assert m.state_for("p1")["suspects"] == ["p2", "p3"]
    m.guess("p1", "p2")
    assert roles_seen_by(m, "p0") == DEAL                                                  # result: all shown


def test_mantri_catches_the_chor(clock):
    m = make(clock)
    to_guess(m, clock)
    m.guess("p1", "p2")
    assert m.last["correct"] and m.last["points"] == {"p0": 1000, "p1": 800, "p2": 0, "p3": 500}
    assert [s.score for s in m.seats] == [1000, 800, 0, 500]


def test_a_wrong_guess_hands_the_mantris_points_to_the_chor(clock):
    m = make(clock)
    to_guess(m, clock)
    m.guess("p1", "p3")
    assert not m.last["correct"] and m.last["points"] == {"p0": 1000, "p1": 0, "p2": 800, "p3": 500}


def test_only_the_mantri_aims_and_fires_at_a_suspect(clock):
    m = make(clock)
    to_guess(m, clock)
    with pytest.raises(RolesError, match="Only the Mantri"):
        m.guess("p2", "p3")
    with pytest.raises(RolesError, match="Only the Mantri"):
        m.set_aim("p0", "p2")
    with pytest.raises(RolesError, match="hidden players"):
        m.set_aim("p1", "p0")                       # the Raja isn't a suspect
    assert m.set_aim("p1", "p3") and not m.set_aim("p1", "p3")
    assert m.state_for("p2")["aim"] == "p3"
    assert m.set_aim("p1", None)


def test_nobodys_chit_is_picked_for_them(clock):
    m = make(clock)
    m.pick("p0", 0)
    clock.t += 3600                                  # an hour later, still waiting for p1–p3
    assert not m.tick() and m.phase == "pick" and m.state_for("p1")["ms_left"] is None


def test_the_mantri_fires_at_the_aim_when_time_runs_out(clock):
    m = make(clock)
    deal(m, {"p0": "mantri", "p1": "raja", "p2": "chor", "p3": "sipahi"})
    for phase in ("raja", "mantri"):
        clock.t += TIMES[phase]
        m.tick()
    m.set_aim("p0", "p3")
    clock.t += TIMES["guess"]
    m.tick()
    assert m.phase == "result" and m.last["accused"] == "p3"


def test_bots_swing_their_aim_then_fire(clock):
    m = make(clock, bots=3)
    m.pick("p0", m.slips.index("raja"))
    aims = set()
    for _ in range(400):                            # 0.05 s steps through pick, reveals and guess
        clock.t += 0.05
        m.tick()
        if m.phase == "guess" and m.aim:
            aims.add(m.aim)
        if m.phase == "result":
            break
    assert m.phase == "result" and len(aims) >= 1 and m.last["accused"] in m.suspects()


def test_a_full_match_of_bots_finishes_after_ten_rounds(clock):
    m = make(clock, bots=4)
    for _ in range(20000):
        clock.t += 0.25
        m.tick()
        if m.finished:
            break
    assert m.finished and m.round == ROUNDS
    assert sum(s.score for s in m.seats) == ROUNDS * (1000 + 800 + 500)   # every round pays 2300
    st = m.state_for("p0")
    assert [r["place"] for r in st["standings"]][0] == 1 and st["ms_left"] is None
    assert not m.tick()                                                   # nothing moves after the end


def test_a_player_who_leaves_is_played_for(clock):
    m = make(clock)
    m.leave("p3")
    for sid in ("p0", "p1", "p2"):
        m.pick(sid, next(i for i in range(4) if i not in m.taken))
    clock.t += 3
    assert m.tick() and m.seat("p3").id in m.role.keys()                  # auto-picked before the deadline
    assert m.state_for("p0")["seats"][3]["left"]


def test_ties_share_a_place(clock):
    m = make(clock)
    for s, score in zip(m.seats, (5000, 5000, 3000, 1000)):
        s.score = score
    assert [r["place"] for r in m.standings()] == [1, 1, 3, 4]
