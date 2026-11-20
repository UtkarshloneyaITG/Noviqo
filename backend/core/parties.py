"""
Parties — the squad you stand with in the lobby and start games with.

Everyone signed in is always in exactly one party (a solo one to begin
with); the leader is members[0]. In-memory only: parties are rebuilt as
people sign back in after a restart.
"""
import time
import uuid
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Set

MAX_MEMBERS = 5
# People a party needs to start each game: (fewest, most). Roles fills empty seats with bots.
GAMES = {"uno": (2, MAX_MEMBERS), "roles": (1, 4)}
INVITE_TTL_S = 30        # an unanswered invite lapses after this
INVITE_SLACK_S = 2       # accepting just as the invitee's countdown ends still works (network delay)


class PartyError(Exception):
    """A user-facing reason a party action was refused."""


@dataclass
class Party:
    leader_id: str
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    members: List[str] = field(default_factory=list)
    ready: Set[str] = field(default_factory=set)       # non-leaders who pressed Ready
    invited: Dict[str, float] = field(default_factory=dict)  # outstanding invites: id -> when it lapses
    requests: Set[str] = field(default_factory=set)    # outstanding join requests
    game: str = "uno"
    mode: str = "casual"
    turn_seconds: int = 30
    stack_draw_cards: bool = False

    @property
    def full(self) -> bool:
        return len(self.members) >= MAX_MEMBERS


class Parties:
    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self.clock = clock
        self.parties: Dict[str, Party] = {}
        self.member_of: Dict[str, str] = {}

    def ensure(self, aid: str) -> Party:
        pid = self.member_of.get(aid)
        if pid:
            return self.parties[pid]
        p = Party(leader_id=aid, members=[aid])
        self.parties[p.id] = p
        self.member_of[aid] = p.id
        return p

    of = ensure

    def _detach(self, aid: str) -> None:
        pid = self.member_of.pop(aid, None)
        if not pid:
            return
        p = self.parties[pid]
        p.members.remove(aid)
        p.ready.discard(aid)
        if not p.members:
            del self.parties[pid]
        elif p.leader_id == aid:
            p.leader_id = p.members[0]
            p.ready.discard(p.leader_id)

    def _join(self, aid: str, p: Party) -> None:
        if p.full:
            raise PartyError("That party is full.")
        self._detach(aid)
        p.members.append(aid)
        self.member_of[aid] = p.id

    def _leader_party(self, aid: str, action: str) -> Party:
        p = self.of(aid)
        if p.leader_id != aid:
            raise PartyError(f"Only the party leader can {action}.")
        return p

    # ── invites and join requests ────────────────────────────────────────
    def invite(self, from_id: str, to_id: str) -> str:
        p = self.of(from_id)
        if to_id in p.members:
            raise PartyError("They're already in your party.")
        if p.full:
            raise PartyError("Your party is full.")
        now = self.clock()
        p.invited = {aid: t for aid, t in p.invited.items() if t > now}   # drop lapsed ones
        p.invited[to_id] = now + INVITE_TTL_S + INVITE_SLACK_S
        return p.id

    def accept(self, aid: str, party_id: str) -> Party:
        p = self.parties.get(party_id)
        if not p or p.invited.get(aid, 0) <= self.clock():
            raise PartyError("That invite has expired.")
        self._join(aid, p)
        p.invited.pop(aid, None)
        return p

    def request(self, aid: str, friend_id: str) -> str:
        p = self.of(friend_id)
        if aid in p.members:
            raise PartyError("You're already in that party.")
        if p.full:
            raise PartyError("That party is full.")
        p.requests.add(aid)
        return p.leader_id

    def admit(self, leader: str, aid: str) -> Party:
        p = self._leader_party(leader, "let people in")
        if aid not in p.requests:
            raise PartyError("That request has expired.")
        p.requests.discard(aid)
        self._join(aid, p)
        return p

    def deny(self, leader: str, aid: str) -> None:
        self.of(leader).requests.discard(aid)

    # ── membership ───────────────────────────────────────────────────────
    def leave(self, aid: str) -> Party:
        """Leave for a fresh solo party; returns the party left behind."""
        old = self.of(aid)
        if len(old.members) > 1:
            self._detach(aid)
            self.ensure(aid)
        return old

    def kick(self, leader: str, aid: str) -> None:
        p = self._leader_party(leader, "remove members")
        if aid == leader or aid not in p.members:
            raise PartyError("They aren't in your party.")
        self._detach(aid)
        self.ensure(aid)

    def drop(self, aid: str) -> None:
        """Gone for good (signed out / didn't come back)."""
        self._detach(aid)

    # ── readiness, settings, start ───────────────────────────────────────
    def set_ready(self, aid: str, ready: bool) -> Party:
        p = self.of(aid)
        if ready and aid != p.leader_id:
            p.ready.add(aid)
        else:
            p.ready.discard(aid)
        return p

    def configure(self, leader: str, settings: dict) -> Party:
        p = self._leader_party(leader, "change the settings")
        if "game" in settings:
            if settings["game"] not in GAMES:
                raise PartyError("Pick one of the games on offer.")
            p.game = settings["game"]
        if "mode" in settings:
            if settings["mode"] not in ("casual", "ranked"):
                raise PartyError("Mode must be casual or ranked.")
            p.mode = settings["mode"]
        if "turn_seconds" in settings:
            if settings["turn_seconds"] not in (15, 30, 60):
                raise PartyError("Turn time must be 15, 30 or 60 seconds.")
            p.turn_seconds = settings["turn_seconds"]
        if "stack_draw_cards" in settings:
            p.stack_draw_cards = bool(settings["stack_draw_cards"])
        return p

    def check_start(self, aid: str) -> Party:
        p = self._leader_party(aid, "start")
        fewest, most = GAMES[p.game]
        if len(p.members) < fewest:
            raise PartyError("Invite at least one friend to start.")
        if len(p.members) > most:
            raise PartyError(f"This game seats {most}. Someone needs to leave the party first.")
        if any(m not in p.ready for m in p.members[1:]):
            raise PartyError("Waiting for everyone to be ready.")
        return p
