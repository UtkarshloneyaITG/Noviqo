"""
Storage — MongoDB persistence.

  channels  one document per live room (lobby or game in progress), so a
            server restart picks up where it left off.
  history   one record appended each time a game finishes.
  accounts  one document per account (password hash, profile, friends, items).
  sessions  one document per sign-in, keyed by the SHA-256 of the token;
            MongoDB's TTL index deletes it when it expires (14 days).
  chat      a single document holding the last 50 global chat messages.

Writes are batched: handlers mark what changed and a background loop
flushes every FLUSH_SECONDS, snapshotting at flush time. Handlers never
wait on the network, rapid changes coalesce into one write, and a single
writer means saves can't land out of order.
"""
import asyncio
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from core.session import GameState, GameStatus

log = logging.getLogger("storage")

# ponytail: whole-document upserts per flush (~15 KB a room); switch to field
# diffs if write volume ever matters. A crash loses at most this much activity.
FLUSH_SECONDS = 1.0


class Storage:
    def __init__(self, channels, history, client=None, accounts=None, sessions=None, chat=None) -> None:
        self.channels = channels
        self.history = history
        self.client = client
        self.accounts = accounts
        self.sessions = sessions
        self.chat = chat
        self._dirty: Dict[str, GameState] = {}     # room_id -> latest object seen
        self._chat: Optional[List[dict]] = None     # latest global chat snapshot to save

    async def close(self) -> None:
        if self.client is not None:
            await self.client.close()

    def mark(self, game) -> None:
        if game is not None:
            self._dirty[game.room_id] = game

    def mark_chat(self, messages) -> None:
        self._chat = list(messages)

    async def ensure_indexes(self) -> None:
        """Expired sessions vanish on their own; usernames stay unique in the DB too."""
        if self.sessions is not None and hasattr(self.sessions, "create_index"):
            await self.sessions.create_index("expire_at", expireAfterSeconds=0)
        if self.accounts is not None and hasattr(self.accounts, "create_index"):
            await self.accounts.create_index("username", unique=True)

    async def flush(self, room_manager, accounts=None) -> None:
        dirty, self._dirty = self._dirty, {}
        for room_id, game in dirty.items():
            try:
                if game.status == GameStatus.FINISHED and not game.history_logged:
                    await self.history.insert_one(_history_record(game))
                    game.history_logged = True
                if room_manager.get_room(room_id) is game:
                    await self.channels.replace_one(
                        {"_id": room_id}, {"_id": room_id, **game.to_doc()}, upsert=True
                    )
                else:  # room was closed
                    await self.channels.delete_one({"_id": room_id})
            except Exception:
                log.exception("Saving room %s failed — will retry", room_id)
                self._dirty.setdefault(room_id, game)

        if accounts is not None and self.accounts is not None:
            await self._flush_accounts(accounts)

        if self._chat is not None and self.chat is not None:
            snapshot, self._chat = self._chat, None
            try:
                await self.chat.replace_one({"_id": "global"}, {"_id": "global", "messages": snapshot}, upsert=True)
            except Exception:
                log.exception("Saving chat failed — will retry")
                self._chat = self._chat if self._chat is not None else snapshot

    async def _flush_accounts(self, acc) -> None:
        ids, acc.dirty_accounts = acc.dirty_accounts, set()
        for aid in ids:
            try:
                await self.accounts.replace_one({"_id": aid}, acc.account_doc(aid), upsert=True)
            except Exception:
                log.exception("Saving account %s failed — will retry", aid)
                acc.dirty_accounts.add(aid)
        keys, acc.dirty_sessions = acc.dirty_sessions, set()
        for key in keys:
            if key not in acc.sessions:
                continue
            doc = acc.session_doc(key)
            doc["expire_at"] = datetime.fromtimestamp(doc["expires_at"] / 1000, tz=timezone.utc)   # TTL index field
            try:
                await self.sessions.replace_one({"_id": key}, doc, upsert=True)
            except Exception:
                log.exception("Saving a session failed — will retry")
                acc.dirty_sessions.add(key)
        gone, acc.deleted_sessions = acc.deleted_sessions, set()
        for key in gone:
            try:
                await self.sessions.delete_one({"_id": key})
            except Exception:
                log.exception("Deleting a session failed — will retry")
                acc.deleted_sessions.add(key)

    async def load_all(self) -> List[GameState]:
        return [GameState.from_doc(doc) async for doc in self.channels.find({})]

    async def load_accounts(self) -> Tuple[List[dict], List[dict], List[dict]]:
        """(account docs, session docs, last global chat messages)."""
        accounts = [d async for d in self.accounts.find({})] if self.accounts is not None else []
        sessions = [d async for d in self.sessions.find({})] if self.sessions is not None else []
        chat: List[dict] = []
        if self.chat is not None:
            async for d in self.chat.find({}):
                if d.get("_id") == "global":
                    chat = d.get("messages", [])
        return accounts, sessions, chat

    async def run(self, room_manager, accounts=None) -> None:
        while True:
            await asyncio.sleep(FLUSH_SECONDS)
            await self.flush(room_manager, accounts)


def _history_record(game: GameState) -> dict:
    return {
        "room_id": game.room_id,
        "finished_at": datetime.now(timezone.utc),
        "round": game.rounds_played,
        "round_points": game.last_round_points,
        "mode": game.mode,
        "winner_id": game.winner_id,
        "winner": game.winner,
        "placements": [dict(p) for p in game.placements],
        "players": [
            {"id": p.id, "name": p.name, "score": game.scores.get(p.id, 0),
             "cards_left": len(p.hand)}
            for p in game.players
        ],
        "settings": dict(game.settings),
        "rewards": dict(game.rewards),
    }
