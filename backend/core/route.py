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
                 entry_carry: bool = False, max_chain: Optional[int] = None) -> None:
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
        self.rewards: Dict[str, dict] = {}

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
        self.owed, self.chain, self.last, self.phase = 1, 0, None, "throw"

    def _check_over(self) -> bool:
        racing = [s.id for s in self.seats if s.id not in self.places]
        if len(racing) <= 1:
            self.places += racing
            self.phase = "over"
            self._event("over")
            return True
        return False

    def progress(self, sid: str) -> Tuple[int, int]:
        pawns = self.pawns[sid]
        return (sum(p.state == "finished" for p in pawns), sum(p.index + 1 for p in pawns if p.state == "active"))

    def standings(self) -> List[dict]:
        order = self.places + sorted((s.id for s in self.seats if s.id not in self.places),
                                     key=lambda sid: self.progress(sid), reverse=True)
        return [{"id": sid, "place": i + 1, "finished": self.progress(sid)[0]} for i, sid in enumerate(order)]
