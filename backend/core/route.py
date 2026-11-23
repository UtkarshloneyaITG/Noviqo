"""
Route — Ang Mang Chok Chang, a Chowka Bara-style race for four seats.

A 5×5 board. Every seat owns four pawns that start at home, enter on their
home square (the middle of their side), run once round the outer ring
anticlockwise, then the inner ring clockwise, and finish on the centre.
Four cowrie shells are thrown: the number of mouths up is the move, 0 up
counts 8 (Baara) and 4 up is Chowka (4); both earn another throw. Landing
on opponents captures them (back home) and earns another throw, except on
the safe squares (the four homes and the centre). The centre needs an
exact throw. Traditional rules: a pawn may enter only on a 4 or 8, and a
seat that has never captured can't turn inward (its pawns keep circling).
Basic rules drop the inward gate. First to bring all four pawns in wins;
the rest play on for the places.

A match is a clocked state machine like core/roles.py: `tick()` moves it
on (timers, bots, animation pauses); callers push `state_for(seat)` to
each player after any change. In memory only; clock and RNG injectable.
"""
import random
import time
import uuid
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Tuple

Cell = Tuple[int, int]

# Seat 0's route (rows from the far side, columns left to right as seat 0 sees the board).
OUTER: List[Cell] = [(4, 2), (4, 3), (4, 4), (3, 4), (2, 4), (1, 4), (0, 4), (0, 3),
                     (0, 2), (0, 1), (0, 0), (1, 0), (2, 0), (3, 0), (4, 0), (4, 1)]
INNER: List[Cell] = [(3, 1), (2, 1), (1, 1), (1, 2), (1, 3), (2, 3), (3, 3), (3, 2)]
CENTRE: Cell = (2, 2)
SAFE = {(4, 2), (2, 4), (0, 2), (2, 0), CENTRE}
COLOURS = ("red", "blue", "green", "yellow")
SEATS = 4
PAWNS = 4
LAST_OUTER = 15
FINISH = 24
RULES = ("traditional", "basic")
TIMES = {"decide": 20.0}     # a human's throw or pick; at zero the match plays it for them
BOT_THROW_S = (0.8, 1.6)     # bots (and seats played for) act after a human-ish pause
BOT_MOVE_S = (0.6, 1.2)
THROW_S = 0.7                # pauses that let everyone watch: the shells tumble and settle,
SPECIAL_S = 0.5              # a 4 or 8 lingers,
HOP_S = 0.18                 # a pawn hops each square,
CAPTURE_S = 0.6              # a captured pawn flies home


def rot(cell: Cell, k: int = 1) -> Cell:
    """A quarter turn of the board, k times: seat k's view of seat 0's cell."""
    r, c = cell
    for _ in range(k % 4):
        r, c = 4 - c, r
    return (r, c)


def path_for(seat: int) -> List[Cell]:
    """The 25 cells a seat's pawns visit, home square first, centre last."""
    return [rot(cell, seat) for cell in OUTER + INNER + [CENTRE]]


PATHS = [path_for(k) for k in range(SEATS)]


@dataclass(frozen=True)
class Throw:
    faces: Tuple[int, ...]   # 1 = mouth up
    value: int
    extra: bool


def score(faces) -> Throw:
    mouths = sum(faces)
    return Throw(tuple(faces), 8 if mouths == 0 else mouths, mouths in (0, 4))


class RouteError(Exception):
    """A user-facing reason an action was refused."""


@dataclass
class Seat:
    id: str
    name: str
    character: str
    bot: bool = False
    connected: bool = True
    left: bool = False          # walked out mid-match: the seat plays itself, no payout

    @property
    def auto(self) -> bool:
        return self.bot or self.left or not self.connected


@dataclass
class Pawn:
    state: str = "home"         # home | active | finished
    index: int = -1             # position on its seat's path (0..24) while active


class RouteMatch:
    def __init__(self, seats: List[Seat], rules: str = "traditional",
                 clock: Callable[[], float] = time.monotonic, rng: Optional[random.Random] = None,
                 entry_carry: bool = False, max_chain: Optional[int] = None, pauses: bool = True) -> None:
        if len(seats) != SEATS:
            raise ValueError("Ang Mang Chok Chang needs exactly four seats.")
        if rules not in RULES:
            raise ValueError(f"Unknown rules: {rules}")
        self.id = uuid.uuid4().hex[:8]
        self.seats = seats
        self.rules = rules
        self.clock = clock
        self.rng = rng or random.Random()
        self.entry_carry = entry_carry
        self.max_chain = max_chain
        self.pawns: Dict[str, List[Pawn]] = {s.id: [Pawn() for _ in range(PAWNS)] for s in seats}
        self.turn = 0                 # index of the seat to act
        self.phase = "throw"          # throw | move | anim | over
        self.owed = 1                 # throws still owed this turn
        self.chain = 0                # extra throws earned this turn (for max_chain)
        self.last: Optional[Throw] = None
        self.captured: set = set()    # seats that have captured at least once
        self.places: List[str] = []   # seat ids in finishing order
        self.events: List[dict] = []
        self.seq = 0
        self.rewards: Dict[str, dict] = {}   # seat id -> payout, filled by the server
        self.pauses = pauses
        self.deadline = 0.0           # when a human's decision times out
        self.act_at = 0.0             # when an auto seat acts
        self.anim_until = 0.0
        self.resume = ""              # the phase an animation pause returns to
        self.afk = False              # the human to act timed out: play the rest of this turn for them
        self._reported: set = set()
        self._arm()

    # ── lookups ──────────────────────────────────────────────────────────
    def index_of(self, sid: str) -> int:
        for i, s in enumerate(self.seats):
            if s.id == sid:
                return i
        raise RouteError("You're not at this table.")

    def seat(self, sid: str) -> Seat:
        return self.seats[self.index_of(sid)]

    @property
    def current(self) -> Seat:
        return self.seats[self.turn]

    @property
    def finished(self) -> bool:
        return self.phase == "over"

    def cell(self, sid: str, index: int) -> Cell:
        return PATHS[self.index_of(sid)][index]

    def _event(self, kind: str, **data) -> None:
        self.seq += 1
        self.events.append({"seq": self.seq, "kind": kind, **data})
        del self.events[:-60]

    # ── rules ────────────────────────────────────────────────────────────
    def _walk(self, sid: str, start: int, steps: int) -> Optional[List[int]]:
        """Indices a pawn passes through moving `steps` from `start`, or None past the centre."""
        gate = self.rules == "basic" or sid in self.captured
        idx, out = start, []
        for _ in range(steps):
            if idx == FINISH:
                return None
            idx = (16 if gate else 0) if idx == LAST_OUTER else idx + 1
            out.append(idx)
        return out

    def _victims(self, sid: str, index: int) -> List[list]:
        target = self.cell(sid, index)
        if target in SAFE:
            return []
        return [[s.id, i] for s in self.seats if s.id != sid
                for i, p in enumerate(self.pawns[s.id]) if p.state == "active" and self.cell(s.id, p.index) == target]

    def legal_moves(self, sid: str) -> List[dict]:
        """What the seat to act may do with the throw in hand (nothing for anyone else)."""
        if self.phase != "move" or self.current.id != sid or not self.last:
            return []
        value, moves = self.last.value, []
        for i, p in enumerate(self.pawns[sid]):
            if p.state == "finished":
                continue
            if p.state == "home":
                if value not in (4, 8):
                    continue
                rest = self._walk(sid, 0, value - 1) if self.entry_carry else []
                if rest is None:
                    continue
                path, enters = [0] + rest, True
            else:
                path = self._walk(sid, p.index, value)
                if path is None:
                    continue
                enters = False
            to = path[-1]
            moves.append({"pawn": i, "to": to, "path": path, "enters": enters,
                          "captures": self._victims(sid, to), "finishes": to == FINISH})
        return moves

    # ── actions ──────────────────────────────────────────────────────────
    def _need(self, sid: str, phase: str) -> None:
        if self.phase == "over":
            raise RouteError("The game is over.")
        if self.current.id != sid:
            raise RouteError("It's not your turn.")
        if self.phase != phase:
            raise RouteError("Throw the shells first." if phase == "move" else "Move a pawn first.")

    def _earn(self) -> None:
        if self.max_chain is None or self.chain < self.max_chain:
            self.owed += 1
            self.chain += 1

    def do_throw(self, sid: str, faces=None) -> Throw:
        self._need(sid, "throw")
        if faces is None:
            faces = tuple(1 if self.rng.random() < 0.5 else 0 for _ in range(4))
        t = score(faces)
        self.last = t
        self.owed -= 1
        if t.extra:
            self._earn()
        self._event("throw", seat=sid, faces=list(t.faces), value=t.value, extra=t.extra)
        self.phase = "move"
        if not self.legal_moves(sid):
            self._event("stuck", seat=sid)
            self._settle(sid)
        self._pause(THROW_S + (SPECIAL_S if t.extra else 0.0))
        return t

    def do_move(self, sid: str, pawn) -> dict:
        self._need(sid, "move")
        move = next((m for m in self.legal_moves(sid) if m["pawn"] == pawn), None)
        if not move:
            raise RouteError("That pawn can't move with this throw.")
        p = self.pawns[sid][pawn]
        start = p.index
        p.state, p.index = "active", move["to"]
        self._event("entered" if move["enters"] else "moved", seat=sid, pawn=pawn, start=start,
                    to=move["to"], path=move["path"])
        for victim, vp in move["captures"]:
            self.pawns[victim][vp] = Pawn()
            self._event("captured", seat=victim, pawn=vp, by=sid)
        if move["captures"]:
            self.captured.add(sid)
            self._earn()
        if move["finishes"]:
            p.state = "finished"
            self._event("finished", seat=sid, pawn=pawn)
            if all(q.state == "finished" for q in self.pawns[sid]):
                self.places.append(sid)
                self._event("placed", seat=sid, place=len(self.places))
        self._settle(sid)
        self._pause(HOP_S * len(move["path"]) + (CAPTURE_S if move["captures"] else 0.0))
        return move

    # ── turn flow ────────────────────────────────────────────────────────
    def _settle(self, sid: str) -> None:
        """After a throw with no move, or a move: throw again, pass the turn, or end."""
        if self._check_over():
            return
        if self.owed > 0 and sid not in self.places:
            self.phase = "throw"
            return
        self._next_turn()

    def _next_turn(self) -> None:
        for step in range(1, SEATS + 1):
            nxt = (self.turn + step) % SEATS
            if self.seats[nxt].id not in self.places:
                self.turn = nxt
                break
        self.owed, self.chain, self.last, self.phase, self.afk = 1, 0, None, "throw", False

    def _check_over(self) -> bool:
        """Over when one seat is left racing, or no human is (nobody waits for bots)."""
        racing = [s for s in self.seats if s.id not in self.places]
        if len(racing) > 1 and any(not s.bot and not s.left for s in racing):
            return False
        self.places += [s.id for s in sorted(racing, key=lambda s: self.progress(s.id), reverse=True)]
        self.phase = "over"
        self._event("over")
        return True

    # ── the clock ────────────────────────────────────────────────────────
    def _played_for(self) -> bool:
        return self.current.auto or self.afk

    def _arm(self) -> None:
        """A decision starts: the human clock, and when an auto seat will act."""
        now = self.clock()
        self.deadline = now + TIMES["decide"]
        lo, hi = BOT_THROW_S if self.phase == "throw" else BOT_MOVE_S
        self.act_at = now + self.rng.uniform(lo, hi)

    def _pause(self, secs: float) -> None:
        if self.phase == "over":
            return
        if not self.pauses or secs <= 0:
            self._arm()
            return
        self.resume, self.phase = self.phase, "anim"
        self.anim_until = self.clock() + secs

    def tick(self) -> bool:
        """Move the match on: end a pause, or act for an auto seat or a timed-out human."""
        if self.phase == "over":
            return False
        now = self.clock()
        if self.phase == "anim":
            if now < self.anim_until:
                return False
            self.phase, self.resume = self.resume, ""
            self._arm()
            return True
        if self._played_for():
            if now < self.act_at:
                return False
        elif now < self.deadline:
            return False
        else:
            self.afk = True
        sid = self.current.id
        if self.phase == "throw":
            self.do_throw(sid)
        else:
            self.do_move(sid, choose(self, sid))
        return True

    def set_connected(self, sid: str, connected: bool) -> None:
        self.seat(sid).connected = connected
        if self.current.id == sid and self.phase in ("throw", "move"):
            if connected:
                self.afk = False
            self._arm()

    def leave(self, sid: str) -> None:
        """Walked out: the seat plays itself from now on (and may end the match)."""
        self.seat(sid).left = True
        if self.phase == "over":
            return
        if self.current.id == sid and self.phase in ("throw", "move"):
            self._arm()
        self._check_over()

    def newly_placed(self) -> List[str]:
        """Human seats whose final place was fixed since the last call (the server pays them)."""
        out = [sid for sid in self.places if sid not in self._reported and not self.seat(sid).bot]
        self._reported.update(out)
        return out

    def progress(self, sid: str) -> Tuple[int, int]:
        pawns = self.pawns[sid]
        return (sum(p.state == "finished" for p in pawns), sum(p.index + 1 for p in pawns if p.state == "active"))

    def standings(self) -> List[dict]:
        order = self.places + sorted((s.id for s in self.seats if s.id not in self.places),
                                     key=lambda sid: self.progress(sid), reverse=True)
        return [{"id": sid, "place": i + 1, "finished": self.progress(sid)[0]} for i, sid in enumerate(order)]

    # ── what a player sees ───────────────────────────────────────────────
    def state_for(self, viewer: str) -> dict:
        live = self.phase in ("throw", "move")
        seats = []
        for i, s in enumerate(self.seats):
            states = [p.state for p in self.pawns[s.id]]
            seats.append({"id": s.id, "name": s.name, "character": s.character, "index": i, "colour": COLOURS[i],
                          "bot": s.bot, "connected": s.connected, "left": s.left,
                          "home": states.count("home"), "active": states.count("active"),
                          "finished": states.count("finished"), "captured": s.id in self.captured,
                          "place": self.places.index(s.id) + 1 if s.id in self.places else None})
        return {
            "id": self.id,
            "rules": self.rules,
            "you": next((i for i, s in enumerate(self.seats) if s.id == viewer), None),
            "turn": self.turn,
            "phase": self.phase,
            "owed": self.owed,
            "ms_left": int(max(0.0, self.deadline - self.clock()) * 1000) if live and not self._played_for() else None,
            "last": {"faces": list(self.last.faces), "value": self.last.value, "extra": self.last.extra} if self.last else None,
            "seats": seats,
            "pawns": {s.id: [{"state": p.state, "index": p.index} for p in self.pawns[s.id]] for s in self.seats},
            "moves": self.legal_moves(viewer),
            "events": self.events[-30:],
            "standings": self.standings() if self.finished else None,
        }


# ── bots ─────────────────────────────────────────────────────────────────

def _threatened(match: RouteMatch, sid: str, index: int) -> bool:
    """Could an opponent land on this pawn with their next throw?"""
    cell = match.cell(sid, index)
    if cell in SAFE:
        return False
    for s in match.seats:
        if s.id == sid:
            continue
        for p in match.pawns[s.id]:
            if p.state != "active":
                continue
            for v in (1, 2, 3, 4, 8):
                path = match._walk(s.id, p.index, v)
                if path and match.cell(s.id, path[-1]) == cell:
                    return True
    return False


def choose(match: RouteMatch, sid: str) -> int:
    """A bot's pick: capture, else finish, else enter, else escape danger, else the furthest pawn."""
    moves = match.legal_moves(sid)
    if not moves:
        raise RouteError("No pawn can move.")

    def escapes(m: dict) -> bool:
        return (not m["enters"] and _threatened(match, sid, match.pawns[sid][m["pawn"]].index)
                and not _threatened(match, sid, m["to"]))

    return max(moves, key=lambda m: (bool(m["captures"]), m["finishes"], m["enters"], escapes(m), m["to"],
                                     match.rng.random()))["pawn"]
