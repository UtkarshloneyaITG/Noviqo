"""
Storage — MongoDB persistence.

  channels  one document per live room (lobby or game in progress), so a
            server restart picks up where it left off.
  history   one record appended each time a game finishes.

Writes are batched: handlers call mark(game) after any change and a
background loop flushes every FLUSH_SECONDS, snapshotting the room at flush
time. Handlers never wait on the network, rapid actions coalesce into one
write, and a single writer means saves can't land out of order.
"""
import asyncio
import logging
from datetime import datetime, timezone
from typing import Dict, List

from core.session import GameState, GameStatus

log = logging.getLogger("storage")

# ponytail: whole-room upsert per flush (~15 KB); switch to field diffs if
# write volume ever matters. A crash loses at most this much activity.
FLUSH_SECONDS = 1.0


class Storage:
    def __init__(self, channels, history, client=None) -> None:
        self.channels = channels
        self.history = history
        self.client = client
        self._dirty: Dict[str, GameState] = {}  # room_id -> latest object seen

    async def close(self) -> None:
        if self.client is not None:
            await self.client.close()

    def mark(self, game) -> None:
        if game is not None:
            self._dirty[game.room_id] = game

    async def flush(self, room_manager) -> None:
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

    async def load_all(self) -> List[GameState]:
        return [GameState.from_doc(doc) async for doc in self.channels.find({})]

    async def run(self, room_manager) -> None:
        while True:
            await asyncio.sleep(FLUSH_SECONDS)
            await self.flush(room_manager)


def _history_record(game: GameState) -> dict:
    return {
        "room_id": game.room_id,
        "finished_at": datetime.now(timezone.utc),
        "round": game.rounds_played,
        "round_points": game.last_round_points,
        "winner_id": game.winner_id,
        "winner": game.winner,
        "placements": [dict(p) for p in game.placements],
        "players": [
            {"id": p.id, "name": p.name, "score": game.scores.get(p.id, 0),
             "cards_left": len(p.hand)}
            for p in game.players
        ],
        "settings": dict(game.settings),
    }
