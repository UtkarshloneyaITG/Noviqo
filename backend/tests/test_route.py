"""
Route engine (core/route.py): the board path, cowrie throws, entering,
moving, captures, safe squares, the inner gate, exact finishing, extra
throws, places, the clock, bots and the end of a match.
Run from backend/:  python -m pytest tests/test_route.py -v
"""
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from core.route import CENTRE, FINISH, INNER, OUTER, RouteError, RouteMatch, Seat, path_for, rot, score


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


@pytest.fixture
def clock():
    return Clock()


def make(clock, bots=0, rules="traditional", seed=7, **kw):
    seats = [Seat(f"p{i}", f"P{i}", "char:m-Casual", bot=i >= 4 - bots) for i in range(4)]
    return RouteMatch(seats, rules=rules, clock=clock, rng=random.Random(seed), **kw)


FACES = {1: (1, 0, 0, 0), 2: (1, 1, 0, 0), 3: (1, 1, 1, 0), 4: (1, 1, 1, 1), 8: (0, 0, 0, 0)}


def give(m, value):
    """The seat to act throws `value`."""
    return m.do_throw(m.seats[m.turn].id, FACES[value])


def put(m, sid, pawn, index):
    p = m.pawns[sid][pawn]
    p.state, p.index = ("finished", 24) if index == FINISH else ("active", index)


def legal(m, sid="p0"):
    return {mv["pawn"]: mv for mv in m.legal_moves(sid)}


# ── board and throws ─────────────────────────────────────────────────────

def test_every_seat_path_covers_the_board_once_by_adjacent_steps():
    for k in range(4):
        p = path_for(k)
        assert len(p) == 25 and len(set(p)) == 25 and p[24] == CENTRE
        assert all(abs(a[0] - b[0]) + abs(a[1] - b[1]) == 1 for a, b in zip(p, p[1:]))
        assert p[0] == rot((4, 2), k) and p[0] not in p[1:16]
    assert path_for(0)[:16] == OUTER and path_for(0)[16:24] == INNER


def test_throw_values():
    assert score((1, 0, 0, 0)).value == 1 and not score((1, 0, 0, 0)).extra
    assert score((1, 1, 1, 0)).value == 3
    assert (score((1, 1, 1, 1)).value, score((1, 1, 1, 1)).extra) == (4, True)
    assert (score((0, 0, 0, 0)).value, score((0, 0, 0, 0)).extra) == (8, True)


# ── entering, moving, finishing ──────────────────────────────────────────

def test_home_pawns_enter_only_on_four_or_eight(clock):
    m = make(clock)
    give(m, 3)
    assert m.legal_moves("p0") == [] and m.turn == 1          # nothing could move: the turn passed
    m = make(clock)
    give(m, 4)
    moves = legal(m)
    assert set(moves) == {0, 1, 2, 3} and all(mv["enters"] and mv["to"] == 0 for mv in moves.values())


def test_entering_uses_the_whole_throw(clock):
    m = make(clock)
    give(m, 8)
    m.do_move("p0", 0)
    assert m.pawns["p0"][0].index == 0
    m = make(clock, entry_carry=True)
    give(m, 8)
    m.do_move("p0", 0)
    assert m.pawns["p0"][0].index == 7


def test_no_overshoot_of_the_centre(clock):
    m = make(clock)
    put(m, "p0", 0, 22)
    give(m, 3)
    assert 0 not in legal(m)
    m = make(clock)
    put(m, "p0", 0, 22)
    give(m, 2)
    assert legal(m)[0]["finishes"]
    m.do_move("p0", 0)
    assert m.pawns["p0"][0].state == "finished"
    m.turn, m.phase, m.owed = 0, "throw", 1
    give(m, 4)
    assert 0 not in legal(m)                                   # a finished pawn never moves again


def test_only_the_fitting_pawn_is_legal_near_the_centre(clock):
    m = make(clock)
    put(m, "p0", 0, 22)
    put(m, "p0", 1, 5)
    give(m, 3)
    assert set(legal(m)) == {1}


def test_wrong_seat_or_phase_is_refused(clock):
    m = make(clock)
    with pytest.raises(RouteError):
        m.do_throw("p1", FACES[2])
    with pytest.raises(RouteError):
        m.do_move("p0", 0)


# ── captures and safe squares ────────────────────────────────────────────
# Seat 1's pawn at its path index 13 stands on (4,3), seat 0's path index 1.

def test_capture_sends_home_and_grants_a_throw(clock):
    m = make(clock)
    put(m, "p0", 0, 0)
    put(m, "p1", 0, 13)
    give(m, 1)
    assert legal(m)[0]["captures"] == [["p1", 0]]
    owed = m.owed
    m.do_move("p0", 0)
    assert m.pawns["p1"][0].state == "home" and m.owed == owed + 1 and "p0" in m.captured


def test_four_that_captures_owes_two_more_throws(clock):
    m = make(clock)
    put(m, "p0", 1, 1)
    put(m, "p1", 0, 1)                                         # seat 1 index 1 stands on seat 0 index 5
    assert path_for(1)[1] == path_for(0)[5] == (1, 4)
    give(m, 4)
    m.do_move("p0", 1)                                         # 1 + 4 = 5: lands on it
    assert m.pawns["p1"][0].state == "home" and m.owed == 2


def test_no_capture_on_safe_squares_and_sharing_is_allowed(clock):
    m = make(clock)
    put(m, "p0", 0, 1)
    put(m, "p1", 0, 0)                                         # on its own home square (2,4)
    give(m, 3)
    assert legal(m)[0]["captures"] == []
    m.do_move("p0", 0)
    assert m.pawns["p1"][0].state == "active" and m.pawns["p0"][0].index == 4


def test_capture_takes_every_opponent_pawn_on_the_cell(clock):
    m = make(clock)
    put(m, "p0", 0, 0)
    put(m, "p1", 0, 13)
    put(m, "p1", 1, 13)
    give(m, 1)
    m.do_move("p0", 0)
    assert [p.state for p in m.pawns["p1"][:2]] == ["home", "home"]


# ── the inner gate ───────────────────────────────────────────────────────

def test_traditional_gate_circles_until_a_capture(clock):
    m = make(clock)
    put(m, "p0", 0, 14)
    give(m, 3)
    assert legal(m)[0]["to"] == 1                              # round the outer ring again
    m = make(clock)
    m.captured.add("p0")
    put(m, "p0", 0, 14)
    give(m, 3)
    assert legal(m)[0]["to"] == 17                             # turns inward


def test_basic_rules_turn_in_without_a_capture(clock):
    m = make(clock, rules="basic")
    put(m, "p0", 0, 14)
    give(m, 3)
    assert legal(m)[0]["to"] == 17


# ── extra throws and passing ─────────────────────────────────────────────

def test_special_throw_with_no_move_throws_again_and_normal_passes(clock):
    m = make(clock)
    for i in range(3):
        put(m, "p0", i, FINISH)
    put(m, "p0", 3, 22)
    give(m, 4)                                                 # overshoots: no move, but a 4 throws again
    assert (m.turn, m.phase) == (0, "throw")
    give(m, 3)                                                 # overshoots, nothing owed: the turn passes
    assert m.turn == 1


def test_places_and_last_player(clock):
    m = make(clock)
    for sid in ("p0", "p1", "p2"):
        for i in range(3):
            put(m, sid, i, FINISH)
        put(m, sid, 3, 23)
    for sid in ("p0", "p1", "p2"):
        assert m.seats[m.turn].id == sid
        give(m, 1)
        m.do_move(sid, 3)
    assert m.places == ["p0", "p1", "p2", "p3"] and m.finished
