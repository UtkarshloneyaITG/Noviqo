"""
Ring match engine (core/stage.py): movement, punches, guard, roll, rounds,
the match end, places, leaving and the computer fighter.
Run from backend/:  python -m pytest tests/test_stage.py -v
"""
import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from core.stage import (ARENA_HALF, FIGHTER_R, KO_WATCH_SECS, MAT_EDGE, READY_SECS, RING_HALF, ROUND_SECS, START_CORNER,
                        START_R, Fighter, StageError, StageMatch)


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


@pytest.fixture
def clock():
    return Clock()


def make(clock, n=2, bots=0, seed=7):
    fighters = [Fighter(f"p{i}", f"P{i}", "char:m-Casual", bot=i >= n - bots) for i in range(n)]
    return StageMatch(fighters, clock=clock, rng=random.Random(seed))


def fight(match):
    """Skip the get-ready countdown: the round is live and never times out."""
    match.phase, match.phase_until = "fight", float("inf")
    return match


def run(match, clock, secs, dt=0.05):
    for _ in range(round(secs / dt)):
        clock.t += dt
        match.tick()


def place(f, x, z):
    f.x, f.z = x, z


def facing(f, x, z):
    """Angle between f's yaw and the direction from f to (x, z)."""
    want = math.atan2(x - f.x, z - f.z)
    return abs((f.yaw - want + math.pi) % (2 * math.pi) - math.pi)


# ── fighters, input, movement ────────────────────────────────────────────

def test_start_positions_face_the_centre(clock):
    m = make(clock, 2)
    assert [(f.x, f.z) for f in m.fighters] == [(-START_CORNER, -START_CORNER), (START_CORNER, START_CORNER)]
    for f in make(clock, 4).fighters + m.fighters:
        assert facing(f, 0, 0) < 1e-6
    for f in make(clock, 4).fighters:
        assert math.hypot(f.x, f.z) == pytest.approx(START_R)


def test_walking_moves_at_walk_speed_and_turns_to_face_the_way(clock):
    m = fight(make(clock))
    a, b = m.fighters
    place(a, -2, 0)
    place(b, 2, 2.2)
    m.set_input("p0", (1, 0), False)
    run(m, clock, 0.5)
    assert a.x == pytest.approx(-0.9, abs=0.01) and a.z == pytest.approx(0, abs=1e-9)
    assert a.state == "walk" and a.yaw == pytest.approx(math.pi / 2)


def test_guard_slows_walking(clock):
    m = fight(make(clock))
    a, b = m.fighters
    place(a, -2, 0)
    place(b, 2, 2.2)
    m.set_input("p0", (1, 0), True)
    run(m, clock, 0.5)
    assert a.x == pytest.approx(-2 + 0.44, abs=0.01) and a.state == "guard"


def test_idle_fighters_face_the_nearest_opponent(clock):
    m = fight(make(clock, 3))
    a, b, c = m.fighters
    place(a, 0, 0)
    place(b, 1, 0)
    place(c, 0, -2.5)
    run(m, clock, 0.05)
    assert facing(a, 1, 0) < 1e-6


def test_bad_input_is_refused_and_moves_are_capped(clock):
    m = fight(make(clock))
    for move, guard in [((float("nan"), 0), False), (("a", 1), False), ((True, 0), False), ((1, 2, 3), False),
                        ((float("inf"), 0), False), ("up", False), ((1, 0), "yes")]:
        with pytest.raises(StageError):
            m.set_input("p0", move, guard)
    a, b = m.fighters
    place(a, -2, 0)
    place(b, 2, 2.2)
    m.set_input("p0", [50, 0], False)
    run(m, clock, 0.5)
    assert a.x == pytest.approx(-0.9, abs=0.01)
    with pytest.raises(StageError):
        m.set_input("nobody", None, False)


def test_crowded_fighters_stay_inside_the_ropes(clock):
    m = fight(make(clock, 5))
    for i, f in enumerate(m.fighters):
        place(f, 2.6 - 0.01 * i, 2.6)
        m.set_input(f.id, (1, 1), False)
    run(m, clock, 2)
    edge = RING_HALF - FIGHTER_R
    for f in m.fighters:
        assert abs(f.x) <= edge + 1e-9 and abs(f.z) <= edge + 1e-9
    for i, f in enumerate(m.fighters):
        for g in m.fighters[i + 1:]:
            assert math.hypot(f.x - g.x, f.z - g.z) >= 2 * FIGHTER_R - 1e-3


# ── punches, guard, roll, hit stun ───────────────────────────────────────

def duel(clock, gap=0.9):
    """a at the centre facing b, gap metres away along +x, the round live."""
    m = fight(make(clock))
    a, b = m.fighters
    place(a, 0, 0)
    place(b, gap, 0)
    run(m, clock, 0.05)                      # both turn to face each other
    return m, a, b


def test_jab_in_reach_lands_six(clock):
    m, a, b = duel(clock)
    assert m.act("p0", "jab")
    run(m, clock, 0.2)
    assert b.hp == 94 and b.state == "hit" and a.hp == 100


def test_jab_out_of_reach_or_behind_misses(clock):
    m, a, b = duel(clock, gap=1.3)
    m.act("p0", "jab")
    run(m, clock, 0.5)
    assert b.hp == 100
    m = fight(make(clock, 3))
    a, b, c = m.fighters
    place(a, 0, 0)
    place(b, 0.9, 0)
    place(c, -0.95, 0)
    m.act("p0", "jab")
    run(m, clock, 0.5)
    assert (b.hp, c.hp) == (94, 100)


def test_cross_lands_twelve_and_knocks_back(clock):
    m, a, b = duel(clock)
    m.act("p0", "cross")
    run(m, clock, 0.4)
    assert b.hp == 88 and b.x == pytest.approx(1.3, abs=1e-6) and b.z == pytest.approx(0, abs=1e-6)


def test_guard_from_the_front_takes_one_from_behind_takes_full(clock):
    m, a, b = duel(clock)
    m.set_input("p1", None, True)
    run(m, clock, 0.05)
    m.act("p0", "jab")
    run(m, clock, 0.25)
    assert b.hp == 99 and b.state == "guard"
    m = fight(make(clock, 3))
    a, b, c = m.fighters
    place(a, 0, 0)
    place(b, 0.9, 0)
    place(c, 1.6, 0)                          # nearer to b than a is: b guards facing c, its back to a
    m.set_input("p1", None, True)
    run(m, clock, 0.05)
    m.act("p0", "jab")
    run(m, clock, 0.25)
    assert b.hp == 94


def test_roll_dodges_inside_its_window_and_has_a_cooldown(clock):
    m, a, b = duel(clock)
    m.act("p0", "jab")
    run(m, clock, 0.1)
    m.set_input("p1", (0, 1), False)
    assert m.act("p1", "roll")
    rolled = clock.t
    run(m, clock, 0.25)
    assert b.hp == 100                       # the jab came while b was safe in the roll
    m.set_input("p1", None, False)
    run(m, clock, 0.5)
    assert b.z == pytest.approx(2.0, abs=0.01) and b.state == "idle"
    clock.t = rolled + 1.0
    assert not m.act("p1", "roll")
    clock.t = rolled + 1.65
    assert m.act("p1", "roll")


def test_presses_during_an_action_are_ignored(clock):
    m, a, b = duel(clock)
    assert m.act("p0", "jab")
    run(m, clock, 0.1)
    assert not m.act("p0", "jab") and not m.act("p0", "roll")
    run(m, clock, 0.15)
    assert b.state == "hit" and not m.act("p1", "jab")
    run(m, clock, 1.0)
    assert b.hp == 94
    b.hp = 6
    m.act("p0", "jab")
    run(m, clock, 0.25)
    assert b.state == "ko" and not m.act("p1", "jab")
    with pytest.raises(StageError):
        m.act("p0", "kick")


def test_simultaneous_punches_both_land(clock):
    for order in (0, 1):
        m, a, b = duel(clock)
        if order:
            m.fighters.reverse()
        m.act("p1", "jab")
        m.act("p0", "jab")
        run(m, clock, 0.25)
        assert (a.hp, b.hp) == (94, 94)


def test_knockout_at_zero_hp(clock):
    m, a, b = duel(clock)
    b.hp = 6
    m.act("p0", "jab")
    run(m, clock, 0.25)
    assert b.hp == 0 and b.state == "ko" and b.ko_at is not None
    assert [e["kind"] for e in m.events][-1] == "ko" and m.events[-1]["to"] == "p1"


# ── rounds, the match end, places, leaving ───────────────────────────────

def knock(m, clock, *fs):
    """Knock these fighters out now (knockouts by punch are covered above) and let the match react."""
    for f in fs:
        f.hp, f.state, f.since, f.ko_at = 0, "ko", clock.t, clock.t
    run(m, clock, 0.05)


def to_fight(m, clock):
    if m.phase == "ready":
        run(m, clock, READY_SECS + 0.05)
    assert m.phase == "fight"


def win_round(m, clock, w, order=()):
    """`w` wins the next round: the fighters in `order` go down first, one tick apart, then the rest."""
    to_fight(m, clock)
    for f in order:
        knock(m, clock, f)
    knock(m, clock, *[f for f in m.fighters if f.standing and f is not w])
    run(m, clock, KO_WATCH_SECS + 0.05)


def test_last_one_standing_wins_the_round(clock):
    m = make(clock, 3)
    a, b, c = m.fighters
    to_fight(m, clock)
    knock(m, clock, a)
    assert m.phase == "fight"
    knock(m, clock, b)
    assert m.phase == "ko" and c.wins == 1 and m.counted == 1
    run(m, clock, KO_WATCH_SECS + 0.05)
    assert m.phase == "ready" and m.round == 2
    assert all(f.hp == 100 and f.state == "idle" and f.in_round for f in m.fighters)


def test_double_knockout_replays_the_round(clock):
    m = make(clock, 3)
    a, b, c = m.fighters
    to_fight(m, clock)
    knock(m, clock, a)
    knock(m, clock, b, c)
    assert m.phase == "ko" and [f.wins for f in m.fighters] == [0, 0, 0] and m.counted == 0
    run(m, clock, KO_WATCH_SECS + 0.05)
    assert m.phase == "ready" and m.round == 2 and m.counted == 0


def test_round_clock_goes_to_the_most_hp_and_a_tie_replays(clock):
    m = make(clock)
    a, b = m.fighters
    to_fight(m, clock)
    a.hp, b.hp = 70, 40
    run(m, clock, ROUND_SECS + 0.1)
    assert m.phase == "ko" and (a.wins, b.wins) == (1, 0)
    m = make(clock)
    a, b = m.fighters
    to_fight(m, clock)
    a.hp, b.hp = 50, 50
    run(m, clock, ROUND_SECS + 0.1)
    assert m.phase == "ko" and (a.wins, b.wins) == (0, 0)
    run(m, clock, KO_WATCH_SECS + 0.05)
    assert m.round == 2 and m.counted == 0


def test_one_v_one_is_first_to_two(clock):
    m = make(clock)
    a, b = m.fighters
    win_round(m, clock, a)
    assert m.phase == "ready"
    win_round(m, clock, a)
    assert m.phase == "over" and m.finished and m.places == ["p0", "p1"]


def test_three_fighters_play_three_rounds_and_ties_fight_it_out(clock):
    m = make(clock, 3)
    a, b, c = m.fighters
    for w in (a, b, c):
        win_round(m, clock, w)
    assert m.phase == "ready" and m.round == 4 and m.tiebreak and all(f.in_round for f in m.fighters)
    for winners in ((0, 0, 1), (0, 1, 0)):
        m = make(clock, 3)
        for i in winners:
            win_round(m, clock, m.fighters[i])
        assert m.phase == "over" and m.places[0] == "p0" and m.round == 3


def test_tiebreak_only_for_the_tied(clock):
    m = make(clock, 4)
    a, b, c, d = m.fighters
    for w in (a, b, c):
        win_round(m, clock, w)
    assert m.tiebreak and [f.in_round for f in m.fighters] == [True, True, True, False]
    assert d.state == "out" and not d.standing
    win_round(m, clock, b)
    assert m.phase == "over" and m.places[0] == "p1"


def test_places_follow_wins_then_survival(clock):
    m = make(clock, 4)
    a, b, c, d = m.fighters
    win_round(m, clock, a)
    win_round(m, clock, a)
    win_round(m, clock, b, order=(d, c))          # last round: d down first, then c, then a
    assert m.phase == "over" and m.places == ["p0", "p1", "p2", "p3"]
    assert [s["place"] for s in m.standings()] == [1, 2, 3, 4]


def test_leaving_forfeits_and_the_last_one_left_wins(clock):
    m = make(clock)
    to_fight(m, clock)
    m.leave("p1")
    assert m.phase == "over" and m.places == ["p0", "p1"]
    assert sorted(m.newly_placed()) == ["p0", "p1"] and m.newly_placed() == []
    m = make(clock, 3)
    a, b, c = m.fighters
    to_fight(m, clock)
    m.leave("p2")
    run(m, clock, 0.05)
    assert c.state == "out" and not c.standing and m.phase == "fight"
    assert m.newly_placed() == ["p2"] and m.standings() == [{"id": "p2", "place": 3, "wins": 0}]


def test_disconnected_fighter_is_auto_and_reconnecting_hands_back(clock):
    m = make(clock)
    a, b = m.fighters
    m.set_connected("p1", False)
    assert b.auto
    b.move, b.guard = (1.0, 0.0), True                # what the computer was holding for them
    m.set_connected("p1", True)
    assert not b.auto and b.move is None and not b.guard


# ── the computer fighter and the snapshot ────────────────────────────────

def watch(m, clock, secs, each=lambda: None):
    """Run the match, collecting every event (the match keeps only the latest)."""
    seen = {}
    for _ in range(round(secs / 0.05)):
        clock.t += 0.05
        each()
        m.tick()
        seen.update((e["seq"], e) for e in m.events)
    return list(seen.values())


def test_computer_closes_in_and_lands_hits(clock):
    m = make(clock, 2, bots=1, seed=3)
    to_fight(m, clock)
    events = watch(m, clock, 20)
    assert any(e["kind"] == "hit" and e["by"] == "p1" for e in events)


def test_computer_guards_sometimes_when_attacked(clock):
    m = make(clock, 2, bots=1, seed=5)
    to_fight(m, clock)
    events = watch(m, clock, 10, each=lambda: m.act("p0", "jab"))
    assert any(e["kind"] == "block" and e["to"] == "p1" for e in events)


def test_snapshot_has_the_agreed_shape(clock):
    m = make(clock, 3, bots=1)
    st = m.state_for("p0")
    assert set(st) == {"id", "you", "phase", "round", "counted", "tiebreak", "ms_left", "fighters", "events",
                       "standings", "reward"}
    assert set(st["fighters"][0]) == {"id", "name", "character", "bot", "x", "z", "yaw", "hp", "state", "ms", "wins",
                                      "auto", "left", "in_round", "outside"}
    assert st["you"] == 0 and st["phase"] == "ready" and st["ms_left"] == 3000 and st["standings"] is None
    assert m.state_for("someone else")["you"] is None
    json.dumps(st)
    fight(m)
    json.dumps(m.state_for("p0"))                      # an endless test round still serialises


def test_snapshots_stay_small(clock):
    """20 a second to every phone: keep each one light (only the latest few events ride along)."""
    for n, limit in ((2, 1400), (5, 2100)):
        m = make(clock, n)
        for f in m.fighters:
            f.id = str(f.id).ljust(36, "x")              # real ids are 36-character uuids
        for i in range(20):
            m._event("hit", m.fighters[0].id, m.fighters[1].id, 6)
        size = len(json.dumps(m.state_for(m.fighters[0].id)))
        assert size < limit, (n, size)


# ── first person: aiming with a yaw ──────────────────────────────────────

def test_aimed_walking_is_relative_and_keeps_facing_the_aim(clock):
    m = fight(make(clock))
    a, b = m.fighters
    place(a, 0, 0)
    place(b, 2.5, 2.5)
    m.set_input("p0", (0, 1), False, yaw=math.pi / 2)        # forward, facing +x
    run(m, clock, 0.5)
    assert a.x == pytest.approx(1.1, abs=0.01) and a.z == pytest.approx(0, abs=1e-6)
    assert a.yaw == pytest.approx(math.pi / 2) and a.state == "walk"
    place(a, 0, 0)
    m.set_input("p0", (1, 0), False, yaw=0.0)                # strafe right while facing +z: toward -x
    run(m, clock, 0.5)
    assert a.x == pytest.approx(-1.1, abs=0.01) and a.yaw == pytest.approx(0)
    m.set_input("p0", None, False, yaw=1.0)                  # standing: still faces the aim, not the nearest
    run(m, clock, 0.1)
    assert a.yaw == pytest.approx(1.0)


def test_aimed_punches_hit_where_you_look(clock):
    m, a, b = duel(clock)                                    # b is 0.9 m away along +x
    m.set_input("p0", None, False, yaw=-math.pi / 2)         # looking the other way
    m.act("p0", "jab")
    run(m, clock, 0.5)
    assert b.hp == 100
    m.set_input("p0", None, False, yaw=math.pi / 2 + math.radians(35))   # 35° off: inside the 40° half-arc
    m.act("p0", "jab")
    run(m, clock, 0.25)
    assert b.hp == 94


def test_bad_yaw_is_refused(clock):
    m = fight(make(clock))
    for yaw in (float("nan"), float("inf"), "left", True):
        with pytest.raises(StageError):
            m.set_input("p0", None, False, yaw=yaw)


def test_the_computer_ignores_a_dropped_players_old_aim(clock):
    m = fight(make(clock))
    a, b = m.fighters
    place(a, 0, 0)
    place(b, 2.0, 0)
    m.set_input("p0", None, False, yaw=-math.pi / 2)         # was looking away when the phone dropped
    m.set_connected("p0", False)
    run(m, clock, 1.0)
    assert facing(a, b.x, b.z) < 0.2 and a.x > 0.3           # the computer turned to b and closed in


# ── jump ─────────────────────────────────────────────────────────────────

def test_jump_carries_you_and_punches_pass_under_you(clock):
    m, a, b = duel(clock)                                    # b is 0.9 m away along +x, facing a
    m.set_input("p1", (0, 1), False)                         # b holds "toward +z"
    m.act("p0", "jab")                                       # a's jab checks at 0.18 s…
    run(m, clock, 0.05)
    assert m.act("p1", "jump")                               # …while b is in the air
    m.set_input("p1", None, False)                           # the jump keeps the direction it took off in
    z0 = b.z
    run(m, clock, 0.3)
    assert b.hp == 100 and b.state == "jump"
    run(m, clock, 0.6)
    assert b.state != "jump" and b.z - z0 == pytest.approx(2.2 * 0.85, abs=0.15)  # carried at walking pace


def test_jump_has_a_cooldown_and_ignores_presses_in_the_air(clock):
    m, a, b = duel(clock)
    jumped = clock.t
    assert m.act("p1", "jump")
    run(m, clock, 0.2)
    assert not m.act("p1", "jump") and not m.act("p1", "jab")
    clock.t = jumped + 1.0
    run(m, clock, 0.05)
    assert not m.act("p1", "jump")                           # landed, still cooling down
    clock.t = jumped + 1.45
    run(m, clock, 0.05)
    assert m.act("p1", "jump")


# ── outside the ring ─────────────────────────────────────────────────────

EDGE_IN = RING_HALF - FIGHTER_R


def test_walking_stops_at_the_ropes_but_a_roll_goes_under_them(clock):
    m = fight(make(clock))
    a, b = m.fighters
    place(a, EDGE_IN - 0.3, 0)
    place(b, -3, -3)
    m.set_input("p0", (1, 0), False)
    run(m, clock, 1.0)
    assert a.x == pytest.approx(EDGE_IN) and not a.outside          # the ropes hold you in
    assert m.act("p0", "roll")
    run(m, clock, 0.7)
    assert a.outside and a.x >= MAT_EDGE + FIGHTER_R - 1e-9          # under the bottom rope, down to the floor
    run(m, clock, 3.0)
    assert a.x == pytest.approx(ARENA_HALF - FIGHTER_R)              # the barricade stops you out there


def test_outside_you_walk_round_the_ring_and_roll_back_in(clock):
    m = fight(make(clock))
    a, b = m.fighters
    place(b, -3, -3)
    a.outside = True
    place(a, MAT_EDGE + 1.0, 0)
    m.set_input("p0", (-1, 0), False)
    run(m, clock, 1.0)
    assert a.outside and a.x == pytest.approx(MAT_EDGE + FIGHTER_R)  # can't walk into the side of the ring
    m.set_input("p0", (-1, 0), False)
    clock.t += 2.0                                                    # any roll cooldown has passed
    assert m.act("p0", "roll")
    run(m, clock, 0.7)
    assert not a.outside and a.x <= EDGE_IN + 1e-9                   # slid back in under the ropes


def test_punches_only_connect_on_the_same_level(clock):
    m = fight(make(clock))
    a, b = m.fighters
    place(a, EDGE_IN, 0)
    b.outside = True
    place(b, MAT_EDGE + FIGHTER_R, 0)                                 # 1.1 m away, but down on the floor
    run(m, clock, 0.05)
    m.act("p0", "cross")
    run(m, clock, 0.5)
    assert b.hp == 100


def test_each_round_starts_back_in_the_ring(clock):
    m = make(clock)
    a, b = m.fighters
    to_fight(m, clock)
    a.outside = True
    place(a, 7, 0)
    win_round(m, clock, a)
    assert m.phase == "ready" and not a.outside and math.hypot(a.x, a.z) < RING_HALF


def test_the_computer_follows_you_out_of_the_ring(clock):
    m = fight(make(clock, 2, bots=1, seed=11))
    a, b = m.fighters
    a.outside = True
    place(a, MAT_EDGE + 1.2, 0)
    place(b, 0, 0)
    for _ in range(round(8 / 0.05)):
        clock.t += 0.05
        m.tick()
        if b.outside:
            break
    assert b.outside
