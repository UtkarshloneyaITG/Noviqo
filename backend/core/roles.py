"""
Roles — Raja Mantri Chor Sipahi, the four-seat role-guessing game.

Each round four rolled paper chits (Raja, Mantri, Chor, Sipahi) roll onto
the table and every player clicks one to take it; nobody's chit is chosen
for them (only bots, and seats whose player left, pick by themselves). The Raja shows theirs ("Mera Mantri kaun hai?"),
the Mantri steps forward, and the Mantri names the Chor from the two
players still hidden by aiming a toy blaster at one and firing (everyone sees
the aim swing between them while the Mantri decides). Points each round: Raja 1000, Sipahi 500; the
Mantri's 800 goes to the Mantri when right and to the Chor when wrong.
Ten rounds; the highest total wins.

A match is a clocked state machine: `tick()` moves phases on when their time
is up and lets bots (and seats whose player left) act; callers push
`state_for(seat)` to each player after any change. In memory only; the
clock and the random source are injectable for tests.
"""
import random
import time
import uuid
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional

ROLES = ("raja", "mantri", "chor", "sipahi")
POINTS = {"raja": 1000, "mantri": 800, "chor": 0, "sipahi": 500}
ROUNDS = 10
SEATS = 4
# Seconds per phase: the reveals, and the Mantri's 30 s to fire. Picking a chit has no
# timer: the round waits for every player (a player who drops for good is played for).
TIMES = {"pick": float("inf"), "raja": 3.0, "mantri": 2.5, "guess": 30.0, "result": 5.0}
BOT_PICK_S = (0.8, 2.5)      # bots (and seats whose player left) act after a human-ish pause
BOT_AIM_S = (0.7, 1.3)       # a bot Mantri swings its aim between the suspects…
BOT_AIMS = (2, 4)            # …this many times, then fires


class RolesError(Exception):
    """A user-facing reason an action was refused."""


@dataclass
class Seat:
    id: str
    name: str
    character: str
    bot: bool = False
    connected: bool = True
    left: bool = False          # walked out mid-match: the seat plays itself, no payout
    score: int = 0

    @property
    def auto(self) -> bool:
        return self.bot or self.left


class RolesMatch:
    def __init__(self, seats: List[Seat], rounds: int = ROUNDS,
                 clock: Callable[[], float] = time.monotonic, rng: Optional[random.Random] = None) -> None:
        if len(seats) != SEATS:
            raise ValueError("Raja Mantri Chor Sipahi needs exactly four seats.")
        self.id = uuid.uuid4().hex[:8]
        self.seats = seats
        self.rounds = rounds
        self.clock = clock
        self.rng = rng or random.Random()
        self.round = 0
        self.phase = ""
        self.deadline = 0.0
        self.slips: List[str] = []           # role written on each slip slot
        self.taken: Dict[int, str] = {}      # slot -> seat id
        self.role: Dict[str, str] = {}       # seat id -> role this round
        self.guessed: Optional[str] = None   # seat id the Mantri fired at
        self.aim: Optional[str] = None       # seat id the Mantri's blaster points at right now
        self.bot_aims = 0                    # swings left before an auto Mantri fires
        self.last: Optional[dict] = None     # last round's outcome
        self.rewards: Dict[str, dict] = {}   # seat id -> payout, filled by the server at the end
        self.due: Dict[str, float] = {}      # auto seat -> when it acts in this phase
        self._next_round()

    # ── lookups ──────────────────────────────────────────────────────────
    def seat(self, sid: str) -> Seat:
        for s in self.seats:
            if s.id == sid:
                return s
        raise RolesError("You're not at this table.")

    def holder(self, role: str) -> Optional[str]:
        return next((sid for sid, r in self.role.items() if r == role), None)

    def suspects(self) -> List[str]:
        """The two seats the Mantri chooses between (in seat order)."""
        return [s.id for s in self.seats if self.role.get(s.id) in ("chor", "sipahi")]

    @property
    def finished(self) -> bool:
        return self.phase == "finished"

    # ── phases ───────────────────────────────────────────────────────────
    def _enter(self, phase: str) -> None:
        now = self.clock()
        self.phase = phase
        self.deadline = now + TIMES.get(phase, 0)
        self.due = {}
        if phase == "pick":
            self.due = {s.id: now + self.rng.uniform(*BOT_PICK_S) for s in self.seats if s.auto}
        elif phase == "guess":
            mantri = self.seat(self.holder("mantri"))
            if mantri.auto:
                self._auto_mantri(mantri.id, now)

    def _auto_mantri(self, sid: str, now: float) -> None:
        self.bot_aims = self.rng.randint(*BOT_AIMS)
        self.due[sid] = now + self.rng.uniform(*BOT_AIM_S)

    def _next_round(self) -> None:
        self.round += 1
        self.slips = list(ROLES)
        self.rng.shuffle(self.slips)
        self.taken, self.role, self.guessed, self.aim = {}, {}, None, None
        self._enter("pick")

    def _take(self, sid: str, slot: int) -> None:
        self.taken[slot] = sid
        self.role[sid] = self.slips[slot]
        if len(self.taken) == SEATS:
            self._enter("raja")

    def _score(self, target: str) -> None:
        self.guessed, self.aim = target, target
        correct = self.role[target] == "chor"
        points = {sid: POINTS[r] for sid, r in self.role.items()}
        if not correct:                               # the Mantri's points go to the Chor
            points[self.holder("chor")] = POINTS["mantri"]
            points[self.holder("mantri")] = 0
        for s in self.seats:
            s.score += points[s.id]
        self.last = {"round": self.round, "correct": correct, "accused": target,
                     "mantri": self.holder("mantri"), "chor": self.holder("chor"), "points": points}
        self._enter("result")

    # ── player actions ───────────────────────────────────────────────────
    def pick(self, sid: str, slot) -> None:
        self.seat(sid)
        if self.phase != "pick":
            raise RolesError("The slips have all been taken.")
        if sid in self.role:
            raise RolesError("You already have a slip.")
        if not isinstance(slot, int) or isinstance(slot, bool) or not 0 <= slot < SEATS:
            raise RolesError("Pick one of the four slips.")
        if slot in self.taken:
            raise RolesError("Someone took that slip. Pick another.")
        self._take(sid, slot)

    def _mantri_only(self, sid: str) -> None:
        self.seat(sid)
        if self.phase != "guess":
            raise RolesError("It isn't time to name the Chor.")
        if self.role.get(sid) != "mantri":
            raise RolesError("Only the Mantri names the Chor.")

    def set_aim(self, sid: str, target) -> bool:
        """Point the Mantri's blaster at a suspect (or lower it with None). True if it moved."""
        self._mantri_only(sid)
        if target is not None and target not in self.suspects():
            raise RolesError("Aim at one of the two hidden players.")
        moved, self.aim = self.aim != target, target
        return moved

    def guess(self, sid: str, target) -> None:
        """Fire: the Mantri names `target` as the Chor."""
        self._mantri_only(sid)
        if target not in self.suspects():
            raise RolesError("Name one of the two hidden players.")
        self._score(target)

    def set_connected(self, sid: str, connected: bool) -> None:
        self.seat(sid).connected = connected

    def leave(self, sid: str) -> None:
        """A player walked out: their seat plays itself from now on (and gets no payout)."""
        s = self.seat(sid)
        s.left, s.connected = True, False
        now = self.clock()
        if self.phase == "pick" and sid not in self.role:
            self.due[sid] = now + self.rng.uniform(*BOT_PICK_S)
        elif self.phase == "guess" and self.role.get(sid) == "mantri":
            self._auto_mantri(sid, now)

    # ── the clock ────────────────────────────────────────────────────────
    def tick(self) -> bool:
        """Let auto seats act and move on any phase whose time is up. True if anything changed."""
        if self.finished:
            return False
        now = self.clock()
        changed = False
        for sid, at in list(self.due.items()):
            if now >= at and self.due.get(sid) == at:
                del self.due[sid]
                if self.phase == "pick" and sid not in self.role:
                    self._take(sid, self.rng.choice([i for i in range(SEATS) if i not in self.taken]))
                    changed = True
                elif self.phase == "guess" and self.role.get(sid) == "mantri":
                    if self.bot_aims > 0:                 # swing to the other suspect (or the first one)
                        self.aim = next((x for x in self.suspects() if x != self.aim), None) if self.aim                             else self.rng.choice(self.suspects())
                        self.bot_aims -= 1
                        self.due[sid] = now + self.rng.uniform(*BOT_AIM_S)
                    else:
                        self._score(self.aim or self.rng.choice(self.suspects()))
                    changed = True
        if now < self.deadline:
            return changed
        if self.phase == "raja":
            self._enter("mantri")
        elif self.phase == "mantri":
            self._enter("guess")
        elif self.phase == "guess":                   # out of time: fire at the aim, or blind
            self._score(self.aim or self.rng.choice(self.suspects()))
        elif self.phase == "result":
            if self.round >= self.rounds:
                self.phase, self.due = "finished", {}
            else:
                self._next_round()
        return True

    # ── results and views ────────────────────────────────────────────────
    def standings(self) -> List[dict]:
        """Final order: highest score first; ties share a place."""
        order = sorted(self.seats, key=lambda s: -s.score)
        out, place = [], 0
        for i, s in enumerate(order):
            if i == 0 or s.score != order[i - 1].score:
                place = i + 1
            out.append({"id": s.id, "place": place, "score": s.score})
        return out

    def _visible_role(self, viewer: str, sid: str) -> Optional[str]:
        r = self.role.get(sid)
        if r is None:
            return None
        if sid == viewer or self.phase in ("result", "finished"):
            return r
        if r == "raja" and self.phase in ("raja", "mantri", "guess"):
            return r
        if r == "mantri" and self.phase in ("mantri", "guess"):
            return r
        return None

    def state_for(self, viewer: str) -> dict:
        """What one player may see: other players' roles stay hidden until revealed."""
        now = self.clock()
        return {
            "id": self.id, "round": self.round, "rounds": self.rounds, "phase": self.phase,
            "ms_left": None if self.deadline == float("inf") or self.finished else max(0, int((self.deadline - now) * 1000)),
            "me": viewer,
            "seats": [{"id": s.id, "name": s.name, "character": s.character, "bot": s.bot,
                       "connected": s.connected, "left": s.left, "score": s.score,
                       "picked": s.id in self.role, "role": self._visible_role(viewer, s.id)}
                      for s in self.seats],
            "slips": [self.taken.get(i) for i in range(SEATS)],
            "suspects": self.suspects() if self.phase in ("guess", "result") else [],
            "aim": self.aim if self.phase in ("guess", "result") else None,
            "last": self.last,
            "standings": self.standings() if self.finished else None,
            "reward": self.rewards.get(viewer),
        }
