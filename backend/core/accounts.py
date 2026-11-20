"""
Accounts — sign up / sign in, 14-day sessions, profiles, the shop and
inventory, friends, and per-game rewards.

In-memory and synchronous; storage.py persists whatever lands in the
`dirty_*` sets. Passwords are scrypt-hashed with a per-account salt, and
sessions are stored by the SHA-256 of their token, so a leaked database
holds neither passwords nor usable tokens.
"""
import copy
import hashlib
import hmac
import os
import random
import re
import secrets
import time
import uuid
from typing import Callable, Dict, Iterable, List, Optional, Tuple

from . import catalog

SESSION_MS = 14 * 24 * 3600 * 1000      # fixed from sign-in; using it doesn't extend it
START_COINS = 200
MAX_GIFT = 1_000_000          # most coins an admin can give in one go
MAX_FRIENDS = 100
_USERNAME = re.compile(r"^@[a-z0-9_]{3,20}$")
_SCRYPT = {"n": 2 ** 14, "r": 8, "p": 1, "dklen": 32}


class AccountError(Exception):
    """A user-facing reason an account action was refused."""


def _hash_password(password: str, salt: bytes, params: dict) -> bytes:
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, maxmem=64 * 1024 * 1024, **params)


def _token_key(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def clean_display_name(name) -> str:
    name = " ".join(str(name or "").split())
    if not 1 <= len(name) <= 20 or any(ord(ch) < 32 for ch in name):
        raise AccountError("In-game names are 1–20 characters.")
    return name


class Accounts:
    def __init__(self, now_ms: Optional[Callable[[], int]] = None) -> None:
        self.now_ms = now_ms or (lambda: int(time.time() * 1000))
        self.accounts: Dict[str, dict] = {}
        self.by_username: Dict[str, str] = {}
        self.sessions: Dict[str, dict] = {}         # sha256(token) -> {account_id, expires_at}
        self.dirty_accounts: set = set()
        self.dirty_sessions: set = set()
        self.deleted_sessions: set = set()
        self.admins: set = set()                    # usernames ("@name") that may give coins; main.py fills it from ADMINS

    # ── persistence ──────────────────────────────────────────────────────
    def load(self, account_docs: Iterable[dict], session_docs: Iterable[dict]) -> None:
        for raw in account_docs:
            doc = dict(raw)
            aid = doc.pop("_id", None) or doc["id"]
            doc["id"] = aid
            for key, default in self._defaults().items():   # docs saved by older code
                doc.setdefault(key, copy.deepcopy(default))
            # Items and slots added since this account was saved: grant new
            # starters, fill new equip slots with their defaults.
            missing = [i for i in catalog.STARTER_ITEMS if i not in doc["inventory"]]
            slots = [k for k in catalog.DEFAULT_EQUIPPED if k not in doc["equipped"]]
            doc["inventory"].extend(missing)
            for k in slots:
                doc["equipped"][k] = catalog.DEFAULT_EQUIPPED[k]
            if missing or slots:
                self.dirty_accounts.add(aid)
            self.accounts[aid] = doc
            self.by_username[doc["username"]] = aid
        now = self.now_ms()
        for raw in session_docs:
            if raw.get("expires_at", 0) > now and raw.get("account_id") in self.accounts:
                self.sessions[raw["_id"]] = {"account_id": raw["account_id"], "expires_at": raw["expires_at"]}

    def account_doc(self, aid: str) -> dict:
        return {"_id": aid, **copy.deepcopy(self.accounts[aid])}

    def session_doc(self, key: str) -> dict:
        return {"_id": key, **self.sessions[key]}

    def _touch(self, aid: str) -> None:
        self.dirty_accounts.add(aid)

    @staticmethod
    def _defaults() -> dict:
        return {"coins": START_COINS, "stats": {"games": 0, "wins": 0, "ranked_wins": 0}, "rp": {"uno": 0},
                "inventory": list(catalog.STARTER_ITEMS), "equipped": dict(catalog.DEFAULT_EQUIPPED),
                "unlocked": {}, "friends": [], "incoming": [], "outgoing": [], "last_seen": None}

    # ── sign up / sign in / sessions ─────────────────────────────────────
    def find_username(self, username) -> Optional[dict]:
        aid = self.by_username.get(str(username or "").strip().lower())
        return self.accounts.get(aid) if aid else None

    def signup(self, username, password, display_name, character) -> Tuple[dict, str]:
        u = str(username or "").strip().lower()
        if not _USERNAME.match(u):
            raise AccountError("Usernames start with @ and use 3–20 letters, numbers or _.")
        if u in self.by_username:
            raise AccountError("That username is taken.")
        if not isinstance(password, str) or not 8 <= len(password) <= 200:
            raise AccountError("Passwords need at least 8 characters.")
        if character not in catalog.STARTER_CHARACTERS:
            raise AccountError("Pick one of the starter characters.")
        name = clean_display_name(display_name) if str(display_name or "").strip() else u[1:]
        salt = os.urandom(16)
        aid = str(uuid.uuid4())
        doc = {"id": aid, "username": u, "display_name": name, "created_at": self.now_ms(),
               "password": {"salt": salt.hex(), "hash": _hash_password(password, salt, _SCRYPT).hex(), **_SCRYPT},
               **copy.deepcopy(self._defaults())}
        doc["equipped"]["character"] = character
        self.accounts[aid] = doc
        self.by_username[u] = aid
        self._touch(aid)
        return doc, self._new_session(aid)

    def signin(self, username, password) -> Tuple[dict, str]:
        doc = self.find_username(username)
        if not doc or not isinstance(password, str) or not self._password_ok(doc, password):
            raise AccountError("Wrong username or password.")
        return doc, self._new_session(doc["id"])

    @staticmethod
    def _password_ok(doc: dict, password: str) -> bool:
        pw = doc["password"]
        params = {k: pw[k] for k in ("n", "r", "p", "dklen")}
        got = _hash_password(password, bytes.fromhex(pw["salt"]), params)
        return hmac.compare_digest(got.hex(), pw["hash"])

    def _new_session(self, aid: str) -> str:
        token = secrets.token_urlsafe(32)
        key = _token_key(token)
        self.sessions[key] = {"account_id": aid, "expires_at": self.now_ms() + SESSION_MS}
        self.dirty_sessions.add(key)
        return token

    def session_expiry(self, token: str) -> Optional[int]:
        s = self.sessions.get(_token_key(token)) if isinstance(token, str) else None
        return s["expires_at"] if s else None

    def auth(self, token) -> Optional[dict]:
        if not isinstance(token, str) or not token:
            return None
        key = _token_key(token)
        s = self.sessions.get(key)
        if not s:
            return None
        if s["expires_at"] <= self.now_ms():
            self._drop_session(key)
            return None
        return self.accounts.get(s["account_id"])

    def signout(self, token) -> None:
        if isinstance(token, str) and token:
            self._drop_session(_token_key(token))

    def _drop_session(self, key: str) -> None:
        if self.sessions.pop(key, None) is not None:
            self.dirty_sessions.discard(key)
            self.deleted_sessions.add(key)

    # ── profile ──────────────────────────────────────────────────────────
    def profile(self, aid: str) -> dict:
        d = self.accounts[aid]
        return {"id": aid, "username": d["username"], "display_name": d["display_name"], "coins": d["coins"],
                "stats": dict(d["stats"]), "rank": catalog.rank_info(d["rp"].get("uno", 0)),
                "inventory": list(d["inventory"]), "equipped": dict(d["equipped"]),
                "milestones": catalog.milestone_progress(d), "admin": d["username"] in self.admins}

    def give_coins(self, username, amount) -> str:
        """Admin gift. Changes the live account (and marks it for saving), so a
        running server never writes an older balance over it."""
        if isinstance(amount, bool) or not isinstance(amount, int) or not 1 <= amount <= MAX_GIFT:
            raise AccountError(f"Give between 1 and {MAX_GIFT:,} coins.")
        aid = self.by_username.get(str(username or "").strip().lower())
        if not aid:
            raise AccountError("No player has that username.")
        self.accounts[aid]["coins"] += amount
        self._touch(aid)
        return aid

    def person(self, aid: str) -> dict:
        d = self.accounts[aid]
        return {"id": aid, "username": d["username"], "display_name": d["display_name"],
                "character": d["equipped"]["character"]}

    def rank_label(self, aid: str) -> str:
        return catalog.rank_info(self.accounts[aid]["rp"].get("uno", 0))["label"]

    # ── leaderboard ──────────────────────────────────────────────────────
    BOARDS = {"rp": lambda d: d["rp"].get("uno", 0), "wins": lambda d: d["stats"]["wins"]}

    def leaderboard(self, me: str, board, scope, limit: int = 50) -> dict:
        """Top `limit` by ranked points or wins (ties: the other stat, then username).
        Global leaves out accounts that never played; friends is you + your friends;
        server is every account, first to last, with no limit (the Ranks page).
        `me` is always your own row (place None if you're not on the board)."""
        if board not in self.BOARDS or scope not in ("global", "friends", "server"):
            raise AccountError("Unknown leaderboard.")
        main, tie = self.BOARDS[board], self.BOARDS["wins" if board == "rp" else "rp"]
        if scope == "friends":
            ids = [me, *self.accounts[me]["friends"]]
        elif scope == "server":
            # ponytail: sends every account in one reply; page it once there are thousands of players
            ids, limit = list(self.accounts), None
        else:
            ids = [i for i, d in self.accounts.items() if d["stats"]["games"] > 0]
        # ponytail: sorts every account per request; keep a sorted index once there are tens of thousands
        ranked = sorted(ids, key=lambda i: (-main(self.accounts[i]), -tie(self.accounts[i]), self.accounts[i]["username"]))
        place = {aid: n for n, aid in enumerate(ranked, 1)}

        def row(aid):
            d = self.accounts[aid]
            return {"place": place.get(aid), **self.person(aid), "rank_label": self.rank_label(aid),
                    "rp": d["rp"].get("uno", 0), "wins": d["stats"]["wins"]}

        return {"board": board, "scope": scope, "rows": [row(i) for i in ranked[:limit]], "me": row(me)}

    def set_display_name(self, aid: str, name) -> None:
        self.accounts[aid]["display_name"] = clean_display_name(name)
        self._touch(aid)

    def mark_seen(self, aid: str) -> None:
        self.accounts[aid]["last_seen"] = self.now_ms()
        self._touch(aid)

    # ── shop and inventory ───────────────────────────────────────────────
    def buy(self, aid: str, item_id) -> dict:
        d = self.accounts[aid]
        item = catalog.ITEM_BY_ID.get(item_id)
        if not item or item["price"] is None:
            raise AccountError("That item isn't sold in the shop.")
        if item_id in d["inventory"]:
            raise AccountError("You already own that.")
        if d["coins"] < item["price"]:
            raise AccountError("Not enough coins.")
        d["coins"] -= item["price"]
        d["inventory"].append(item_id)
        self._touch(aid)
        return item

    def equip(self, aid: str, item_id) -> None:
        d = self.accounts[aid]
        item = catalog.ITEM_BY_ID.get(item_id)
        if not item or item_id not in d["inventory"]:
            raise AccountError("You don't own that yet.")
        slot = catalog.SLOT_OF_KIND.get(item["kind"])
        if not slot:
            raise AccountError("Emotes are always available; nothing to equip.")
        d["equipped"][slot] = item_id
        self._touch(aid)

    # ── friends ──────────────────────────────────────────────────────────
    SEARCH_MAX = 10

    def search(self, me: str, query, online: Callable[[str], bool] = lambda _aid: False) -> Tuple[str, List[str]]:
        """Players to befriend, never yourself; returns (the query as used, up to SEARCH_MAX ids).
        Typed text matches @usernames and display names: exact, then starts-with, then contains.
        An empty box gets a random handful you aren't friends with yet, online players first."""
        q = str(query or "").strip().removeprefix("@").lower()[:20]
        others = [aid for aid in self.accounts if aid != me]
        if not q:
            friends = set(self.accounts[me]["friends"])
            pool = [aid for aid in others if aid not in friends]
            random.shuffle(pool)
            pool.sort(key=lambda aid: not online(aid))     # stable: still random within each group
            return q, pool[:self.SEARCH_MAX]

        def score(aid):
            d = self.accounts[aid]
            names = (d["username"][1:], d["display_name"].lower())
            for s, test in ((0, str.__eq__), (1, str.startswith), (2, str.__contains__)):
                if any(test(n, q) for n in names):
                    return s
            return None

        # ponytail: scans every account per search; add a name index once there are tens of thousands
        hits = sorted((s, self.accounts[aid]["username"], aid) for aid in others if (s := score(aid)) is not None)
        return q, [aid for _, _, aid in hits[:self.SEARCH_MAX]]

    def are_friends(self, a: str, b: str) -> bool:
        return b in self.accounts.get(a, {}).get("friends", [])

    def friend_request(self, me: str, username) -> str:
        target = self.find_username(username)
        if not target:
            raise AccountError("No one goes by that username.")
        other = target["id"]
        if other == me:
            raise AccountError("You can't add yourself.")
        if self.are_friends(me, other):
            raise AccountError("You're already friends.")
        mine = self.accounts[me]
        if other in mine["incoming"]:          # they already asked — just accept
            self.friend_accept(me, other)
            return other
        if other in mine["outgoing"]:
            raise AccountError("Request already sent.")
        if len(mine["friends"]) >= MAX_FRIENDS or len(target["friends"]) >= MAX_FRIENDS:
            raise AccountError("Friend list is full.")
        mine["outgoing"].append(other)
        target["incoming"].append(me)
        self._touch(me)
        self._touch(other)
        return other

    def friend_accept(self, me: str, other: str) -> None:
        mine = self.accounts[me]
        if other not in mine["incoming"] or other not in self.accounts:
            raise AccountError("That request is no longer pending.")
        theirs = self.accounts[other]
        mine["incoming"].remove(other)
        if me in theirs["outgoing"]:
            theirs["outgoing"].remove(me)
        mine["friends"].append(other)
        theirs["friends"].append(me)
        self._touch(me)
        self._touch(other)

    def friend_decline(self, me: str, other: str) -> None:
        self._unlink(me, other, ("incoming",), ("outgoing",))

    def friend_remove(self, me: str, other: str) -> None:
        self._unlink(me, other, ("friends", "incoming", "outgoing"), ("friends", "incoming", "outgoing"))

    def _unlink(self, me: str, other: str, my_lists, their_lists) -> None:
        for key in my_lists:
            if other in self.accounts[me][key]:
                self.accounts[me][key].remove(other)
        if other in self.accounts:
            for key in their_lists:
                if me in self.accounts[other][key]:
                    self.accounts[other][key].remove(me)
            self._touch(other)
        self._touch(me)

    # ── rewards ──────────────────────────────────────────────────────────
    def record_game(self, aid: str, placement: int, players: int, ranked: bool, left_early: bool) -> dict:
        """Apply one finished game to an account; returns the Reward for the client."""
        d = self.accounts[aid]
        coins = 0 if left_early else catalog.coins_for(placement)
        d["coins"] += coins
        if not left_early:
            d["stats"]["games"] += 1
            if placement == 1:
                d["stats"]["wins"] += 1
                if ranked:
                    d["stats"]["ranked_wins"] += 1
        change = 0
        if ranked:
            old = d["rp"].get("uno", 0)
            delta = -15 if left_early else catalog.rp_delta(placement, players)
            d["rp"]["uno"] = max(0, old + delta)
            change = d["rp"]["uno"] - old
        unlocked = self._check_milestones(d)
        self._touch(aid)
        return {"coins": coins, "rp": change, "rank_label": self.rank_label(aid),
                "unlocked": unlocked, "placement": placement}

    def _check_milestones(self, d: dict) -> List[str]:
        got = []
        for m in catalog.MILESTONES:
            if m["id"] not in d["unlocked"] and catalog.stat_value(d, m["stat"]) >= m["goal"]:
                d["unlocked"][m["id"]] = self.now_ms()
                if m["reward"] not in d["inventory"]:
                    d["inventory"].append(m["reward"])
                    got.append(m["reward"])
        return got
