"""
UNO Game Server — FastAPI + WebSockets

WebSocket endpoint: ws://localhost:8000/ws
REST endpoint:      GET /rooms   (list open lobbies)

All game messages are JSON objects with a "type" field.

──────────────────────────────────────────────
CLIENT  →  SERVER  messages
──────────────────────────────────────────────
create_room        { type, player_name }
join_room          { type, room_id, player_name, player_id? }
start_game         { type }
play_card          { type, card_id, chosen_color? }
draw_card          { type }
pass_turn          { type }
call_uno           { type }
catch_uno          { type, target_id }
challenge_wild4    { type }
leave_room         { type }

──────────────────────────────────────────────
SERVER  →  CLIENT  messages
──────────────────────────────────────────────
joined             { type, player_id, room_id, room_state }
room_update        { type, room_state }            – lobby changes
game_state         { type, state }                 – personalised per player
error              { type, message }
player_left        { type, player_name }
player_reconnected { type, player_name }
"""

import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Dict, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pymongo import AsyncMongoClient

from core.channel_manager import RoomManager
from core.member import Player
from storage import Storage
from websocket.connection_manager import ConnectionManager

# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("uno")

# Local dev reads backend/.env; on Render set DB in the service's environment.
# An already-set variable wins over .env (tests rely on that — see conftest.py).
load_dotenv()

storage: Optional[Storage] = None


def _make_storage() -> Optional[Storage]:
    """Storage on the database named in the DB connection string, or None
    (pure in-memory) when DB isn't set."""
    url = os.environ.get("DB")
    if not url:
        return None
    client = AsyncMongoClient(url)
    db = client.get_default_database(default="app")
    return Storage(db["channels"], db["history"], client)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global storage
    storage = _make_storage()
    if storage is None:
        log.warning("DB not set — state is in memory only and lost on restart")
        yield
        return

    for game in await storage.load_all():
        _restore(game)
    flusher = asyncio.create_task(storage.run(room_manager))
    try:
        yield
    finally:
        flusher.cancel()
        await storage.flush(room_manager)  # don't lose the last second on shutdown
        await storage.close()
        storage = None


app = FastAPI(title="UNO Multiplayer Server", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

manager = ConnectionManager()
room_manager = RoomManager()

# ── Per-turn countdown ──────────────────────────────────────────────────────
TURN_SECONDS = 30
GRACE_SECONDS = 15   # a dropped socket keeps its seat this long (refresh / blip)
MAX_NAME_LEN = 20
_turn_timers: Dict[str, asyncio.Task] = {}
_grace_tasks: Dict[str, asyncio.Task] = {}


def _schedule_turn_timer(room_id: str) -> None:
    """(Re)start the per-room turn clock for the current turn."""
    old = _turn_timers.pop(room_id, None)
    if old:
        old.cancel()

    game = room_manager.get_room(room_id)
    if not game or game.status.value != "playing":
        return

    secs = game.settings.get("turn_seconds", TURN_SECONDS)
    game.turn_deadline_ms = int((time.time() + secs) * 1000)
    _turn_timers[room_id] = asyncio.create_task(_turn_timeout(room_id, secs))


async def _turn_timeout(room_id: str, secs: float) -> None:
    try:
        await asyncio.sleep(secs)
    except asyncio.CancelledError:
        return
    if _turn_timers.get(room_id) is not asyncio.current_task():
        return  # superseded by a newer turn
    # Retire ourselves BEFORE broadcasting: the broadcast schedules the next
    # turn's timer, which would otherwise cancel this task mid-send.
    del _turn_timers[room_id]

    game = room_manager.get_room(room_id)
    if game and game.timeout_penalty().get("success"):
        log.info("Turn timeout penalty applied in room %s", room_id)
        _save(game)
        await _broadcast_game_state(room_id)


def _save(*games) -> None:
    """Queue rooms for the next DB flush (no-op without a DB)."""
    if storage:
        for g in games:
            storage.mark(g)


def _restore(game) -> None:
    """Bring a saved room back after a restart. Every socket died with the
    old process, so connected players get the normal reconnect grace."""
    room_manager.restore_room(game)
    for p in game.players:
        if p.is_connected:
            _grace_tasks[p.id] = asyncio.create_task(_expire_after_grace(p.id))
    _schedule_turn_timer(game.room_id)  # fresh turn clock for live games
    log.info("Restored room %s (%s)", game.room_id, game.status.value)


def _cancel_grace(player_id: str) -> None:
    task = _grace_tasks.pop(player_id, None)
    if task:
        task.cancel()


async def _expire_after_grace(player_id: str) -> None:
    try:
        await asyncio.sleep(GRACE_SECONDS)
    except asyncio.CancelledError:
        return
    if _grace_tasks.get(player_id) is not asyncio.current_task():
        return
    del _grace_tasks[player_id]
    log.info("Player %s did not come back — removing", player_id)
    await _depart(player_id)


# ---------------------------------------------------------------------------
# REST helpers
# ---------------------------------------------------------------------------

@app.get("/rooms")
async def list_rooms():
    """Return open lobbies so the frontend can show a join list."""
    return {"rooms": room_manager.list_open_rooms()}


@app.get("/health")
async def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    log.info("WebSocket connected")
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await manager.send({"type": "error", "message": "Invalid JSON."}, ws)
                continue
            await _dispatch(ws, msg)
    except WebSocketDisconnect:
        await _on_disconnect(ws)
    except Exception as exc:
        log.exception("Unexpected WebSocket error: %s", exc)
        await _on_disconnect(ws)


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------

async def _dispatch(ws: WebSocket, msg: dict) -> None:
    t = msg.get("type", "")
    handlers = {
        "create_room":      _create_room,
        "join_room":        _join_room,
        "start_game":       _start_game,
        "play_card":        _play_card,
        "draw_card":        _draw_card,
        "pass_turn":        _pass_turn,
        "call_uno":         _call_uno,
        "catch_uno":        _catch_uno,
        "challenge_wild4":  _challenge_wild4,
        "leave_room":       _leave_room,
        "chat":             _chat,
        "rematch":          _rematch,
        "update_settings":  _update_settings,
        "kick_player":      _kick_player,
    }
    handler = handlers.get(t)
    if handler:
        before = _room_of(ws)  # the room this socket leaves / acts in…
        try:
            await handler(ws, msg)
        except Exception as exc:
            log.exception("Handler error for type=%s: %s", t, exc)
            await manager.send({"type": "error", "message": "Something went wrong on the server."}, ws)
        _save(before, _room_of(ws))  # …and the one it created / joined
    else:
        await manager.send({"type": "error", "message": f"Unknown message type: {t}"}, ws)


def _room_of(ws: WebSocket):
    player_id = manager.get_player_id(ws)
    return room_manager.get_room_for_player(player_id) if player_id else None


# ---------------------------------------------------------------------------
# Disconnect handler
# ---------------------------------------------------------------------------

async def _on_disconnect(ws: WebSocket) -> None:
    player_id = await manager.disconnect(ws)
    if not player_id:
        return
    # Don't drop them yet — a page refresh or network blip reconnects within
    # seconds (the client resumes by player_id). _join_room cancels this.
    _cancel_grace(player_id)
    _grace_tasks[player_id] = asyncio.create_task(_expire_after_grace(player_id))


async def _depart(player_id: str) -> None:
    """Take a player out of their room (leave, or grace expired) and tell the table.

    Mid-game they stay seated as offline; GameState.disconnect_player
    auto-plays their turns (or awards a default win)."""
    game = room_manager.get_room_for_player(player_id)
    if not game:
        return
    player = game._find_player(player_id)
    name = player.name if player else "A player"
    turn_before = game.current_player_index

    room_id = room_manager.remove_player(player_id)
    log.info("Player '%s' left room %s", name, room_id)
    _save(game)  # saved, or deleted from the DB if the room just closed

    if game.status.value != "waiting":
        await _broadcast_game_state(
            room_id, reset_timer=game.current_player_index != turn_before
        )
    await _broadcast_room_state(room_id)
    await _broadcast_to_room(room_id, {"type": "player_left", "player_name": name})


# ---------------------------------------------------------------------------
# Message handlers
# ---------------------------------------------------------------------------

async def _create_room(ws: WebSocket, msg: dict) -> None:
    player_name = (msg.get("player_name") or "").strip()[:MAX_NAME_LEN]
    if not player_name:
        return await manager.send({"type": "error", "message": "player_name required."}, ws)

    room_id = room_manager.create_room()
    player = Player(name=player_name)
    result = room_manager.add_player_to_room(room_id, player)
    if not result["success"]:
        return await manager.send({"type": "error", "message": result["error"]}, ws)

    manager.register(ws, player.id, room_id)
    game = room_manager.get_room(room_id)
    log.info("Room %s created by '%s'", room_id, player_name)

    await manager.send(
        {
            "type": "joined",
            "player_id": player.id,
            "room_id": room_id,
            "room_state": game.get_room_state(),
        },
        ws,
    )


async def _join_room(ws: WebSocket, msg: dict) -> None:
    room_id = (msg.get("room_id") or "").strip().upper()
    player_name = (msg.get("player_name") or "").strip()[:MAX_NAME_LEN]
    existing_player_id: Optional[str] = msg.get("player_id")

    if not room_id or not player_name:
        return await manager.send(
            {"type": "error", "message": "room_id and player_name are required."}, ws
        )

    game = room_manager.get_room(room_id)
    if not game:
        return await manager.send({"type": "error", "message": f"Room '{room_id}' not found."}, ws)

    # --- Reconnection: player sends their saved player_id ---
    # reconnect_player returns False for kicked ids — those fall through to
    # the fresh-join path below (rejected mid-game by add_player_to_room).
    if existing_player_id:
        existing = game._find_player(existing_player_id)
        if existing and game.reconnect_player(existing_player_id):
            _cancel_grace(existing_player_id)
            room_manager.register_player_in_room(existing_player_id, room_id)
            manager.register(ws, existing_player_id, room_id)
            log.info("Player '%s' reconnected to room %s", existing.name, room_id)

            await manager.send(
                {
                    "type": "joined",
                    "player_id": existing_player_id,
                    "room_id": room_id,
                    "room_state": game.get_room_state(),
                },
                ws,
            )
            if game.status.value != "waiting":
                # Everyone (incl. the returner) sees them back online.
                await _broadcast_game_state(room_id, reset_timer=False)

            await _broadcast_to_room(
                room_id,
                {"type": "player_reconnected", "player_name": existing.name},
                exclude_player=existing_player_id,
            )
            await _broadcast_room_state(room_id)
            return

    # --- New player joining the lobby ---
    player = Player(name=player_name)
    result = room_manager.add_player_to_room(room_id, player)
    if not result["success"]:
        return await manager.send({"type": "error", "message": result["error"]}, ws)

    manager.register(ws, player.id, room_id)
    log.info("Player '%s' joined room %s", player_name, room_id)

    await manager.send(
        {
            "type": "joined",
            "player_id": player.id,
            "room_id": room_id,
            "room_state": game.get_room_state(),
        },
        ws,
    )
    # Notify existing players
    await _broadcast_to_room(
        room_id,
        {"type": "player_joined", "player_name": player_name, "room_state": game.get_room_state()},
        exclude_player=player.id,
    )


async def _start_game(ws: WebSocket, _msg: dict) -> None:
    player_id = manager.get_player_id(ws)
    game = room_manager.get_room_for_player(player_id) if player_id else None
    if not game:
        return await manager.send({"type": "error", "message": "You are not in a room."}, ws)
    if game.host_player_id != player_id:
        return await manager.send({"type": "error", "message": "Only the host can start the game."}, ws)

    result = game.start_game()
    if not result["success"]:
        return await manager.send({"type": "error", "message": result["error"]}, ws)

    log.info("Game started in room %s", game.room_id)
    await _broadcast_game_state(game.room_id)


async def _play_card(ws: WebSocket, msg: dict) -> None:
    player_id = manager.get_player_id(ws)
    game = room_manager.get_room_for_player(player_id) if player_id else None
    if not game or not player_id:
        return await manager.send({"type": "error", "message": "Not in a game."}, ws)

    card_id: str = msg.get("card_id", "")
    chosen_color: Optional[str] = msg.get("chosen_color")

    result = game.play_card(player_id, card_id, chosen_color)
    if not result["success"]:
        return await manager.send({"type": "error", "message": result["error"]}, ws)

    await _broadcast_game_state(game.room_id)


async def _draw_card(ws: WebSocket, _msg: dict) -> None:
    player_id = manager.get_player_id(ws)
    game = room_manager.get_room_for_player(player_id) if player_id else None
    if not game or not player_id:
        return await manager.send({"type": "error", "message": "Not in a game."}, ws)

    result = game.draw_card(player_id)
    if not result["success"]:
        return await manager.send({"type": "error", "message": result["error"]}, ws)

    await _broadcast_game_state(game.room_id)


async def _pass_turn(ws: WebSocket, _msg: dict) -> None:
    player_id = manager.get_player_id(ws)
    game = room_manager.get_room_for_player(player_id) if player_id else None
    if not game or not player_id:
        return await manager.send({"type": "error", "message": "Not in a game."}, ws)

    result = game.pass_turn(player_id)
    if not result["success"]:
        return await manager.send({"type": "error", "message": result["error"]}, ws)

    await _broadcast_game_state(game.room_id)


async def _call_uno(ws: WebSocket, _msg: dict) -> None:
    player_id = manager.get_player_id(ws)
    game = room_manager.get_room_for_player(player_id) if player_id else None
    if not game or not player_id:
        return await manager.send({"type": "error", "message": "Not in a game."}, ws)

    result = game.call_uno(player_id)
    if not result["success"]:
        return await manager.send({"type": "error", "message": result["error"]}, ws)

    # Not a turn action — must not extend the current player's clock.
    await _broadcast_game_state(game.room_id, reset_timer=False)


async def _catch_uno(ws: WebSocket, msg: dict) -> None:
    player_id = manager.get_player_id(ws)
    game = room_manager.get_room_for_player(player_id) if player_id else None
    if not game or not player_id:
        return await manager.send({"type": "error", "message": "Not in a game."}, ws)

    target_id: str = msg.get("target_id", "")
    result = game.catch_uno_violation(player_id, target_id)
    if not result["success"]:
        return await manager.send({"type": "error", "message": result["error"]}, ws)

    await _broadcast_game_state(game.room_id, reset_timer=False)


async def _challenge_wild4(ws: WebSocket, _msg: dict) -> None:
    player_id = manager.get_player_id(ws)
    game = room_manager.get_room_for_player(player_id) if player_id else None
    if not game or not player_id:
        return await manager.send({"type": "error", "message": "Not in a game."}, ws)

    result = game.challenge_wild_four(player_id)
    if not result["success"]:
        return await manager.send({"type": "error", "message": result["error"]}, ws)

    await _broadcast_game_state(game.room_id)


async def _chat(ws: WebSocket, msg: dict) -> None:
    """Broadcast a chat line / emoji to everyone in the room (incl. sender)."""
    player_id = manager.get_player_id(ws)
    game = room_manager.get_room_for_player(player_id) if player_id else None
    if not game or not player_id:
        return

    text = (msg.get("text") or "").strip()[:120]
    if not text:
        return

    player = game._find_player(player_id)
    name = player.name if player else "?"
    await _broadcast_to_room(
        game.room_id,
        {"type": "chat", "player_id": player_id, "player_name": name, "text": text},
    )


async def _leave_room(ws: WebSocket, _msg: dict) -> None:
    player_id = manager.get_player_id(ws)
    if not player_id:
        return
    manager.unbind_player(player_id)
    await _depart(player_id)


async def _rematch(ws: WebSocket, _msg: dict) -> None:
    """Host returns a finished game to the lobby for another round."""
    player_id = manager.get_player_id(ws)
    game = room_manager.get_room_for_player(player_id) if player_id else None
    if not game or not player_id:
        return await manager.send({"type": "error", "message": "Not in a game."}, ws)

    if game.status.value != "finished":
        return await manager.send({"type": "error", "message": "Game is not finished."}, ws)

    if game.host_player_id != player_id:
        host = game._find_player(game.host_player_id)
        if host and host.is_connected:
            return await manager.send(
                {"type": "error", "message": "Only the host can start a rematch."}, ws
            )
        # Host left/closed the tab — hand the room to the requester so it
        # doesn't dead-end on the game-over screen.
        game.host_player_id = player_id

    old = _turn_timers.pop(game.room_id, None)
    if old:
        old.cancel()

    result = game.reset_for_rematch()
    if not result["success"]:
        return await manager.send({"type": "error", "message": result["error"]}, ws)

    for pid in result.get("removed_player_ids", []):
        room_manager.unregister_player(pid)

    log.info("Rematch started in room %s", game.room_id)
    await _broadcast_to_room(
        game.room_id,
        {"type": "rematch_started", "room_state": game.get_room_state()},
    )


async def _update_settings(ws: WebSocket, msg: dict) -> None:
    """Host updates room settings while in the lobby."""
    player_id = manager.get_player_id(ws)
    game = room_manager.get_room_for_player(player_id) if player_id else None
    if not game or not player_id:
        return await manager.send({"type": "error", "message": "Not in a room."}, ws)

    result = game.update_settings(player_id, msg.get("settings") or {})
    if not result["success"]:
        return await manager.send({"type": "error", "message": result["error"]}, ws)

    await _broadcast_room_state(game.room_id)


async def _kick_player(ws: WebSocket, msg: dict) -> None:
    """Host removes a player from the room."""
    player_id = manager.get_player_id(ws)
    game = room_manager.get_room_for_player(player_id) if player_id else None
    if not game or not player_id:
        return await manager.send({"type": "error", "message": "Not in a room."}, ws)

    target_id: str = msg.get("target_id", "")
    turn_before = game.current_player_index
    result = game.kick_player(player_id, target_id)
    if not result["success"]:
        return await manager.send({"type": "error", "message": result["error"]}, ws)
    _cancel_grace(target_id)

    await manager.send_to_player(
        {"type": "kicked", "message": "You were removed from the room by the host."},
        target_id,
    )
    manager.unbind_player(target_id)
    room_manager.unregister_player(target_id)

    await _broadcast_to_room(
        game.room_id,
        {"type": "player_left", "player_name": result.get("player_name", "A player")},
    )
    await _broadcast_room_state(game.room_id)
    if game.status.value in ("playing", "finished"):
        await _broadcast_game_state(
            game.room_id, reset_timer=game.current_player_index != turn_before
        )


# ---------------------------------------------------------------------------
# Broadcast helpers
# ---------------------------------------------------------------------------

async def _broadcast_game_state(room_id: str, reset_timer: bool = True) -> None:
    """Send a personalised game_state message to every player in a room.

    reset_timer=True starts a fresh turn clock (use after turn actions);
    False keeps the running one (UNO calls, catches, reconnects)."""
    game = room_manager.get_room(room_id)
    if not game:
        return
    # Reset the turn clock first so the broadcast carries the fresh deadline.
    if reset_timer or room_id not in _turn_timers:
        _schedule_turn_timer(room_id)
    messages = {
        p.id: {"type": "game_state", "state": game.get_state_for_player(p.id)}
        for p in game.players
    }
    await manager.broadcast_room(messages)


async def _broadcast_room_state(room_id: str) -> None:
    """Send the lobby state to every player in the room."""
    game = room_manager.get_room(room_id)
    if not game:
        return
    msg = {"type": "room_update", "room_state": game.get_room_state()}
    await manager.broadcast_common(msg, [p.id for p in game.players])


async def _broadcast_to_room(
    room_id: str,
    message: dict,
    exclude_player: Optional[str] = None,
) -> None:
    """Broadcast a generic message to all (or most) players in a room."""
    game = room_manager.get_room(room_id)
    if not game:
        return
    players = [
        p.id for p in game.players if p.id != exclude_player
    ]
    await manager.broadcast_common(message, players)
