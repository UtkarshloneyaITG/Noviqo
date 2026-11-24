"""
Stage — Ring Clash, a real-time brawl in a wrestling ring for 1 to 5 fighters
(a party of one gets a computer opponent).

Everyone in the ring fights at once; punches (jab, cross), a guard, a dodge
roll. Empty health = knocked out of the round; the last fighter standing
wins it. 1v1 is best of 3; with 3 or more it's always 3 rounds, most round
wins takes the match, and anyone tied for most fights one more round.

The server runs the fight: clients send held input (a move direction, guard
on or off) and button presses; `tick()` advances every fighter by the time
since the last tick (the server calls it 20 times a second) and decides
every hit. Callers push `state_for(viewer)` after each tick. A clocked state
machine like core/route.py: in memory only; clock and RNG injectable.

Ring coordinates: metres, origin at the centre of the ring; yaw = atan2(dx,
dz), 0 faces +z. In the ring, x and z stay inside the ropes (RING_HALF); out
on the arena floor (fighter.outside) they stay inside the barricade
(ARENA_HALF) and off the ring platform (MAT_EDGE). Walking can't cross the
ropes; a roll goes under them, out or back in. Punches only connect between
fighters on the same level, and every round starts back in the ring.
"""
import math
import random
import time
import uuid
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Tuple

RING_HALF = 4.5              # metres from the centre to the ropes (a 9 m ring)
MAT_EDGE = RING_HALF + 0.4   # the ring platform's outer edge (the apron between it and the ropes)
ARENA_HALF = 10.0            # the barricade round the arena floor: as far as anyone can go
FIGHTER_R = 0.35             # a fighter's footprint
WALK_SPEED = 2.2             # metres a second
GUARD_SLOW = 0.4             # walking speed while guarding
START_R = 3.0                # 3 to 5 fighters start on a circle this wide
START_CORNER = 3.0           # two fighters start in opposite corners
MAX_FIGHTERS = 5
MAX_DT = 0.1                 # a late tick never moves anyone further than this much time would
EDGE = RING_HALF - FIGHTER_R
FLOOR_EDGE = ARENA_HALF - FIGHTER_R
PLATFORM = MAT_EDGE + FIGHTER_R  # outside, nobody stands closer to the centre than this (on both axes)

# Punches: how long the move takes, when its hit is checked, how far it reaches, damage, knockback (m).
JAB = dict(secs=0.45, hit_at=0.18, reach=1.0, dmg=6, push=0.0)
CROSS = dict(secs=0.80, hit_at=0.38, reach=1.15, dmg=12, push=0.4)
PUNCHES = {"jab": JAB, "cross": CROSS}
PUNCH_HALF_ARC = math.radians(40)    # a punch reaches an 80° cone in front (players aim across the network delay)
GUARD_HALF_ARC = math.radians(60)    # a guard covers a 120° cone in front
BLOCKED_DMG = 1
ROLL_SECS = 0.6
ROLL_DIST = 2.0
ROLL_SAFE = (0.08, 0.48)             # seconds into a roll when nothing can hit you
ROLL_COOLDOWN = 1.0                  # after a roll ends
HIT_STUN = 0.35
JUMP_SECS = 0.85
JUMP_AIR = (0.1, 0.6)                # seconds into a jump when punches pass under you
JUMP_COOLDOWN = 0.5                  # after landing
SNAPSHOT_EVENTS = 4                  # events each snapshot carries (clients skip ones they've seen by seq)
FREE = ("idle", "walk", "guard")     # states a new move can start from

READY_SECS = 3.0                     # "get ready" before each round
KO_WATCH_SECS = 2.5                  # watching the deciding knockout before the next round
ROUND_SECS = 60.0                    # the round clock with two fighters…
EXTRA_PER_FIGHTER = 15.0             # …plus this for each one beyond two


class StageError(Exception):
    pass


@dataclass
class Fighter:
    id: str
    name: str
    character: str
    bot: bool = False
    connected: bool = True
    left: bool = False
    # managed by the match
    x: float = 0.0
    z: float = 0.0
    yaw: float = 0.0
    hp: int = 100
    state: str = "idle"          # idle | walk | guard | jab | cross | roll | hit | ko | out
    since: float = 0.0           # clock time the state began
    wins: int = 0
    move: Optional[Tuple[float, float]] = None   # held direction (unit vector) or none
    guard: bool = False          # guard held
    roll_ready: float = 0.0      # clock time the next roll is allowed
    in_round: bool = True
    ko_at: Optional[float] = None
    hit_done: bool = False       # this attack's hit has been checked
    think_at: float = 0.0        # computer control: when it next decides
    roll_dir: Tuple[float, float] = (0.0, 0.0)
    outside: bool = False        # down on the arena floor, out of the ring
    jump_ready: float = 0.0
    jump_dir: Tuple[float, float] = (0.0, 0.0)
    aim: Optional[float] = None  # the way the player looks (first person, mouse look); None = face the nearest

    @property
    def aiming(self) -> bool:
        """Facing where the player looks (the computer, covering for anyone, faces the nearest instead)."""
        return self.aim is not None and not self.auto

    @property
    def auto(self) -> bool:
        return self.bot or not self.connected

    @property
    def standing(self) -> bool:
        return self.in_round and not self.left and self.state not in ("ko", "out")


def _finite(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _face(f: Fighter, x: float, z: float) -> None:
    if (x, z) != (f.x, f.z):
        f.yaw = math.atan2(x - f.x, z - f.z)


def _world_move(f: Fighter) -> Optional[Tuple[float, float]]:
    """The held direction on the mat. Aiming players hold it relative to where they look: [right, forward]."""
    if not f.move or not f.aiming:
        return f.move
    right, fwd = f.move
    s, c = math.sin(f.aim), math.cos(f.aim)
    return (fwd * s - right * c, fwd * c + right * s)


def _clamp(f: Fighter) -> None:
    """Keep a fighter where their level allows: inside the ropes, or on the floor between the ring and the barricade."""
    if not f.outside:
        f.x = max(-EDGE, min(EDGE, f.x))
        f.z = max(-EDGE, min(EDGE, f.z))
        return
    f.x = max(-FLOOR_EDGE, min(FLOOR_EDGE, f.x))
    f.z = max(-FLOOR_EDGE, min(FLOOR_EDGE, f.z))
    if abs(f.x) < PLATFORM and abs(f.z) < PLATFORM:     # walked into the side of the ring: back out the nearer way
        if PLATFORM - abs(f.x) < PLATFORM - abs(f.z):
            f.x = math.copysign(PLATFORM, f.x or 1.0)
        else:
            f.z = math.copysign(PLATFORM, f.z or 1.0)


def _roll_through(f: Fighter) -> None:
    """A roll that reaches the ropes goes under them: out to the floor, or back in from it."""
    if not f.outside and (abs(f.x) > EDGE or abs(f.z) > EDGE):
        f.outside = True
        if abs(f.x) > EDGE:
            f.x = math.copysign(max(abs(f.x), PLATFORM), f.x)
        if abs(f.z) > EDGE:
            f.z = math.copysign(max(abs(f.z), PLATFORM), f.z)
    elif f.outside and abs(f.x) < PLATFORM and abs(f.z) < PLATFORM:
        f.outside = False
        f.x = max(-EDGE, min(EDGE, f.x))
        f.z = max(-EDGE, min(EDGE, f.z))


def _off(yaw: float, f: Fighter, x: float, z: float) -> float:
    """How far (radians) the direction from f to (x, z) is from `yaw`."""
    return abs((math.atan2(x - f.x, z - f.z) - yaw + math.pi) % (2 * math.pi) - math.pi)


class StageMatch:
    def __init__(self, fighters: List[Fighter], clock: Callable[[], float] = time.monotonic,
                 rng: Optional[random.Random] = None) -> None:
        if not 2 <= len(fighters) <= MAX_FIGHTERS:
            raise ValueError("Ring Clash needs 2 to 5 fighters.")
        self.id = uuid.uuid4().hex[:8]
        self.fighters = fighters
        self.clock = clock
        self.rng = rng or random.Random()
        self.phase = "ready"         # ready | fight | ko | over
        self.phase_until = clock() + READY_SECS
        self.round = 1               # rounds started, replays and tie-breaks included
        self.counted = 0             # rounds that produced a winner
        self.tiebreak = False
        self.places: List[str] = []
        self.rewards: Dict[str, dict] = {}   # fighter id -> payout, filled by the server
        self.events: List[dict] = []
        self.seq = 0
        self._last = clock()
        self._left: List[str] = []           # leavers, first out first
        self._reported: set = set()
        self._line_up()

    # ── lookups ──────────────────────────────────────────────────────────
    def fighter(self, fid: str) -> Fighter:
        for f in self.fighters:
            if f.id == fid:
                return f
        raise StageError("You're not in this ring.")

    @property
    def finished(self) -> bool:
        return self.phase == "over"

    def _standing(self) -> List[Fighter]:
        return [f for f in self.fighters if f.standing]

    def _nearest(self, f: Fighter) -> Optional[Fighter]:
        others = [g for g in self._standing() if g is not f]
        return min(others, key=lambda g: math.hypot(g.x - f.x, g.z - f.z)) if others else None

    def _line_up(self) -> None:
        """Start positions for the fighters in this round, everyone facing the centre."""
        ring = [f for f in self.fighters if f.in_round]
        if len(ring) == 2:
            spots = [(-START_CORNER, -START_CORNER), (START_CORNER, START_CORNER)]
        else:
            spots = [(START_R * math.sin(2 * math.pi * i / len(ring)), START_R * math.cos(2 * math.pi * i / len(ring)))
                     for i in range(len(ring))]
        for f, (x, z) in zip(ring, spots):
            f.x, f.z, f.outside = x, z, False
            _face(f, 0.0, 0.0)

    # ── input ────────────────────────────────────────────────────────────
    def set_input(self, fid: str, move, guard, yaw=None) -> None:
        """What a fighter holds: a direction to walk (or None), whether they guard, and (first person)
        the way they look — with a yaw, `move` is relative to it: [right, forward]."""
        f = self.fighter(fid)
        if not isinstance(guard, bool):
            raise StageError("Guard is on or off.")
        if yaw is not None:
            if not _finite(yaw):
                raise StageError("Yaw is an angle.")
            f.aim = math.atan2(math.sin(yaw), math.cos(yaw))
        if move is not None:
            if not isinstance(move, (list, tuple)) or len(move) != 2 or not all(_finite(v) for v in move):
                raise StageError("Move is a direction: two numbers, or nothing.")
            n = math.hypot(*move)
            move = (move[0] / n, move[1] / n) if n > 1e-6 else None
        f.move, f.guard = move, guard

    def act(self, fid: str, kind: str) -> bool:
        """A button press: jab, cross, roll or jump. False when the fighter can't start it now (never queued)."""
        if kind not in ("jab", "cross", "roll", "jump"):
            raise StageError("Unknown move.")
        f = self.fighter(fid)
        now = self.clock()
        if self.phase != "fight" or not f.standing or f.state not in FREE:
            return False
        if kind == "jump":
            if now < f.jump_ready:
                return False
            f.jump_dir = _world_move(f) or (0.0, 0.0)        # carried the way they were going, at walking pace
        elif kind == "roll":
            if now < f.roll_ready:
                return False
            f.roll_dir = _world_move(f) or (-math.sin(f.yaw), -math.cos(f.yaw))   # held direction, else straight back
        else:
            if f.aiming:
                f.yaw = f.aim                                # the punch goes where they look
            else:
                target = self._nearest(f)
                if target:
                    _face(f, target.x, target.z)
            f.hit_done = False
        f.state, f.since = kind, now
        return True

    def _event(self, kind: str, by: str, to: str, dmg: int) -> None:
        self.seq += 1
        self.events.append({"seq": self.seq, "kind": kind, "by": by, "to": to, "dmg": dmg})
        del self.events[:-20]

    # ── the clock ────────────────────────────────────────────────────────
    def tick(self) -> bool:
        """Advance everything to now. True while the match is live (time moves every fighter)."""
        now = self.clock()
        dt = min(max(now - self._last, 0.0), MAX_DT)
        self._last = now
        if self.phase == "over":
            return False
        if self.phase == "ready" and now >= self.phase_until:
            ring = sum(f.in_round for f in self.fighters)
            self.phase, self.phase_until = "fight", now + ROUND_SECS + EXTRA_PER_FIGHTER * max(0, ring - 2)
        elif self.phase == "fight":
            self._think(now)
            self._punches(now)
            self._timeouts(now)
            self._move(now, dt)
            self._decide(now)
        elif self.phase == "ko" and now >= self.phase_until:
            self._next_round(now)
        return True

    # ── rounds and the match ─────────────────────────────────────────────
    def _decide(self, now: float) -> None:
        """End the round at the last one standing (none: a replay) or at the round clock (most hp)."""
        up = self._standing()
        if len(up) > 1 and now < self.phase_until:
            return
        top = max((f.hp for f in up), default=0)
        best = [f for f in up if f.hp == top]
        if len(best) == 1:
            best[0].wins += 1
            self.counted += 1
        self.phase, self.phase_until = "ko", now + KO_WATCH_SECS

    def _next_round(self, now: float) -> None:
        if self._over_check():
            return
        n = len(self.fighters)
        tied = []
        if n >= 3 and self.counted >= 3:
            most = max(f.wins for f in self.fighters if not f.left)
            tied = [f for f in self.fighters if not f.left and f.wins == most]
        self.tiebreak = bool(tied)
        if tied:                                     # only those tied for most fight on
            for f in self.fighters:
                f.in_round = f in tied
        self.round += 1
        for f in self.fighters:
            if f.left:
                continue
            if f.in_round:
                f.hp, f.state, f.since, f.ko_at = 100, "idle", now, None
                f.roll_ready, f.hit_done = 0.0, False
            else:
                f.state, f.since = "out", now
        self._line_up()
        self.phase, self.phase_until = "ready", now + READY_SECS

    def _over_check(self) -> bool:
        """End the match if the win rule says so (called between rounds)."""
        live = [f for f in self.fighters if not f.left]
        if len(live) <= 1:
            self._finish(live[0] if live else None)
            return True
        most = max(f.wins for f in live)
        leaders = [f for f in live if f.wins == most]
        if len(self.fighters) == 2:
            done = most >= 2
        else:
            done = self.counted >= 3 and len(leaders) == 1
        if done:
            self._finish(leaders[0])
        return done

    def _finish(self, winner: Optional[Fighter]) -> None:
        rest = [f for f in self.fighters if f is not winner and not f.left]
        rest.sort(key=lambda f: (-f.wins, -(f.ko_at if f.ko_at is not None else math.inf)))
        self.places = ([winner.id] if winner else []) + [f.id for f in rest] + self._left[::-1]
        self.phase, self.phase_until = "over", self.clock()

    def standings(self) -> List[dict]:
        """Places fixed so far: everyone's once the match is over, before that only the leavers'."""
        if self.phase == "over":
            ids = self.places
        else:
            ids = [None] * (len(self.fighters) - len(self._left)) + self._left[::-1]
        return [{"id": fid, "place": i + 1, "wins": self.fighter(fid).wins} for i, fid in enumerate(ids) if fid]

    def newly_placed(self) -> List[str]:
        """Human fighters whose place was fixed since the last call (the server pays them)."""
        out = [s["id"] for s in self.standings() if s["id"] not in self._reported and not self.fighter(s["id"]).bot]
        self._reported.update(out)
        return out

    def set_connected(self, fid: str, connected: bool) -> None:
        """A dropped connection hands the fighter to the computer; coming back takes it over again."""
        f = self.fighter(fid)
        f.connected = connected
        if connected:
            f.move, f.guard = None, False

    def leave(self, fid: str) -> None:
        """Walked out: out of the ring for good, placed last; the last one left wins at once."""
        f = self.fighter(fid)
        if f.left:
            return
        f.left, f.in_round, f.move, f.guard = True, False, None, False
        f.state, f.since = "out", self.clock()
        self._left.append(fid)
        if self.phase != "over" and sum(not g.left for g in self.fighters) <= 1:
            self._over_check()

    def _think(self, now: float) -> None:
        """Computer control (the computer opponent, and anyone whose connection dropped): close in on
        the nearest opponent, then jab, cross, guard or roll, re-deciding after a human-ish pause."""
        for f in self._standing():
            if not f.auto or now < f.think_at:
                continue
            f.think_at = now + self.rng.uniform(0.25, 0.6)
            target = self._nearest(f)
            if not target:
                f.move, f.guard = None, False
                continue
            dx, dz = target.x - f.x, target.z - f.z
            d = math.hypot(dx, dz)
            if target.outside != f.outside:                  # follow them out of the ring (or back in): under the ropes
                f.move, f.guard = ((dx / d, dz / d) if d else None), False
                at_ropes = max(abs(f.x), abs(f.z)) >= EDGE - 0.05 if not f.outside else min(abs(f.x), abs(f.z)) < PLATFORM + 0.6
                if at_ropes:
                    self.act(f.id, "roll")
                continue
            if d > 0.95:
                f.move, f.guard = (dx / d, dz / d), False
                continue
            f.move = None
            moves = {"jab": 0.5, "cross": 0.2, "guard": 0.5 if target.state in PUNCHES else 0.2,
                     "roll": 0.25 if f.hp < 30 else 0.1}
            pick = self.rng.choices(list(moves), list(moves.values()))[0]
            f.guard = pick == "guard"                      # held until the next decision
            if not f.guard:
                self.act(f.id, pick)

    # ── what a player sees ───────────────────────────────────────────────
    def state_for(self, viewer: str) -> dict:
        now = self.clock()
        left = self.phase_until - now
        return {
            "id": self.id,
            "you": next((i for i, f in enumerate(self.fighters) if f.id == viewer), None),
            "phase": self.phase,
            "round": self.round,
            "counted": self.counted,
            "tiebreak": self.tiebreak,
            "ms_left": int(round(max(0.0, min(left, 86400.0)) * 1000)),
            "fighters": [{
                "id": f.id, "name": f.name, "character": f.character, "bot": f.bot,
                "x": round(f.x, 3), "z": round(f.z, 3), "yaw": round(f.yaw, 3), "hp": f.hp, "state": f.state,
                "ms": int(max(0.0, now - f.since) * 1000), "wins": f.wins, "auto": f.auto, "left": f.left,
                "in_round": f.in_round, "outside": f.outside,
            } for f in self.fighters],
            "events": self.events[-SNAPSHOT_EVENTS:],  # 20 snapshots a second: the latest few is plenty
            "standings": self.standings() if self.phase == "over" else None,
            "reward": self.rewards.get(viewer),
        }

    def _set_state(self, f: Fighter, state: str, now: float) -> None:
        if f.state != state:
            f.state, f.since = state, now

    def _safe(self, f: Fighter, now: float) -> bool:
        """Out of reach of punches: mid-roll, or in the air."""
        took = now - f.since
        return (f.state == "roll" and ROLL_SAFE[0] <= took <= ROLL_SAFE[1]) or (f.state == "jump" and JUMP_AIR[0] <= took <= JUMP_AIR[1])

    def _punches(self, now: float) -> None:
        """Every punch due this tick, judged on positions at the start of the tick, then applied
        together, so who is first in the list never matters (two fighters can trade hits)."""
        hits = []
        for f in self._standing():
            p = PUNCHES.get(f.state)
            if not p or f.hit_done or now - f.since < p["hit_at"]:
                continue
            f.hit_done = True
            reach = [g for g in self._standing() if g is not f and g.outside == f.outside and not self._safe(g, now)
                     and math.hypot(g.x - f.x, g.z - f.z) <= p["reach"] and _off(f.yaw, f, g.x, g.z) <= PUNCH_HALF_ARC]
            if not reach:
                continue
            g = min(reach, key=lambda g: math.hypot(g.x - f.x, g.z - f.z))
            blocked = g.state == "guard" and _off(g.yaw, g, f.x, f.z) <= GUARD_HALF_ARC
            hits.append((f, g, p, blocked))
        for f, g, p, blocked in hits:
            dmg = BLOCKED_DMG if blocked else p["dmg"]
            g.hp = max(0, g.hp - dmg)
            self._event("block" if blocked else "hit", f.id, g.id, dmg)
            if g.hp == 0:
                g.state, g.since, g.ko_at = "ko", now, now
                self._event("ko", f.id, g.id, 0)
                continue
            if blocked:
                continue
            if p["push"]:
                d = math.hypot(g.x - f.x, g.z - f.z) or 1.0
                g.x += (g.x - f.x) / d * p["push"]
                g.z += (g.z - f.z) / d * p["push"]
                _clamp(g)
            if g.state != "roll":                         # a hit stuns, cutting a punch short; a roll carries on
                g.state, g.since = "hit", now

    def _timeouts(self, now: float) -> None:
        for f in self._standing():
            took = now - f.since
            if f.state in PUNCHES and took >= PUNCHES[f.state]["secs"] or f.state == "hit" and took >= HIT_STUN:
                f.state, f.since = "idle", now
            elif f.state == "roll" and took >= ROLL_SECS:
                f.roll_ready = f.since + ROLL_SECS + ROLL_COOLDOWN   # from when it ended, however late this tick is
                f.state, f.since = "idle", now
            elif f.state == "jump" and took >= JUMP_SECS:
                f.jump_ready = f.since + JUMP_SECS + JUMP_COOLDOWN
                f.state, f.since = "idle", now

    def _move(self, now: float, dt: float) -> None:
        for f in self._standing():
            if f.state == "roll":
                step = min(dt, max(0.0, f.since + ROLL_SECS - (now - dt)))   # only the part of dt inside the roll
                f.x += f.roll_dir[0] * ROLL_DIST / ROLL_SECS * step
                f.z += f.roll_dir[1] * ROLL_DIST / ROLL_SECS * step
                _roll_through(f)
                _clamp(f)
            elif f.state == "jump":
                step = min(dt, max(0.0, f.since + JUMP_SECS - (now - dt)))
                f.x += f.jump_dir[0] * WALK_SPEED * step
                f.z += f.jump_dir[1] * WALK_SPEED * step
                _clamp(f)
            if f.state in FREE:
                self._set_state(f, "guard" if f.guard else "walk" if f.move else "idle", now)
                move = _world_move(f)
                if move:
                    speed = WALK_SPEED * (GUARD_SLOW if f.guard else 1.0)
                    f.x += move[0] * speed * dt
                    f.z += move[1] * speed * dt
                    _clamp(f)
                if f.aiming:
                    f.yaw = f.aim
                elif f.state == "walk":
                    f.yaw = math.atan2(move[0], move[1])
                else:
                    target = self._nearest(f)
                    if target:
                        _face(f, target.x, target.z)
        self._separate()

    def _separate(self) -> None:
        """Push overlapping fighters apart, never through the ropes."""
        ring = self._standing()
        for _ in range(40):                           # a chain along the ropes settles in a few dozen
            moved = False
            for i, f in enumerate(ring):
                for j, g in enumerate(ring[i + 1:], i + 1):
                    if g.outside != f.outside:                # the ring and the floor don't touch
                        continue
                    dx, dz = g.x - f.x, g.z - f.z
                    d = math.hypot(dx, dz)
                    gap = 2 * FIGHTER_R - d
                    if gap <= 1e-4:
                        continue
                    if d < 1e-6:                          # exactly on top of each other: split by seat order
                        a = 2 * math.pi * (i * MAX_FIGHTERS + j) / (MAX_FIGHTERS ** 2)
                        dx, dz, d = math.sin(a), math.cos(a), 1.0
                    ux, uz = dx / d, dz / d
                    fx, fz = f.x, f.z
                    f.x, f.z = f.x - ux * gap / 2, f.z - uz * gap / 2
                    _clamp(f)
                    took = (fx - f.x) * ux + (fz - f.z) * uz   # what f managed against the ropes
                    g.x, g.z = g.x + ux * (gap - took), g.z + uz * (gap - took)
                    _clamp(g)
                    moved = True
            if not moved:
                return
