"""
Game server — FastAPI + one WebSocket endpoint (/ws) carrying JSON messages
with a "type" field. The full message contract (accounts, friends, party,
chat, shop, game actions) is documented for the client team; in short:

  signed-out:  signup, signin, auth                → auth_ok | auth_error
  account:     signout, update_profile, equip, buy → profile, catalog
  friends:     friend_request / _accept / _decline / _remove → friends;
               user_search {q}                     → user_results (Add friend page)
  party:       party_invite / _accept / _request / _admit / _deny / _leave /
               _kick / _ready / _set / _start      → party, party_invite, party_request
  lobby:       emote (your character acts it out)  → emote, to the whole party
  roles:       roles_pick {slot}, roles_aim {target}, roles_guess {target}, roles_leave
                                                   → roles_state (personal), roles_left
  chat:        gchat (everyone), pchat (party)     → gchat, gchat_history, pchat
  game:        play_card, draw_card, pass_turn, call_uno, catch_uno,
               challenge_wild4, chat, leave_room, rematch, kick_player
                                                   → joined, game_state, game_rewards
Errors come back as {type: "error", message}; anything but signup/signin/auth
from a signed-out socket gets {type: "auth_error"}.
"""

import asyncio
import json
import logging
import os
import random
import time
import uuid
from collections import deque
from contextlib import asynccontextmanager
from typing import Dict, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pymongo import AsyncMongoClient

from core import catalog
from core.limits import Limiter
from core.accounts import AccountError, Accounts
from core.channel_manager import RoomManager
from core.member import Player
from core.parties import INVITE_TTL_S, PartyError, Parties
from core.roles import RolesError, RolesMatch, Seat as RoleSeat
from core.route import RouteError, RouteMatch, Seat as RouteSeat
from storage import Storage
from websocket.connection_manager import ConnectionManager

# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("uno")

# Local dev reads backend/.env; on Render set DB in the service's environment.
# An already-set variable wins over .env (tests rely on that — see conftest.py).
load_dotenv()

storage: Optional[Storage] = None
manager = ConnectionManager()
room_manager = RoomManager()
accounts = Accounts()
# ADMINS="@gamith,@someone" (env, comma-separated; the @ is optional): who may give coins.
accounts.admins = {"@" + u.strip().lstrip("@").lower() for u in os.environ.get("ADMINS", "").split(",") if u.strip()}
parties = Parties()

TURN_SECONDS = 30
GRACE_SECONDS = 15        # a dropped socket keeps its seat this long (refresh / blip)
CHAT_KEEP = 50            # global chat messages kept and replayed on sign-in
CHAT_MAX_LEN = 200
CHAT_GAP_S = 0.8          # minimum seconds between one account's chat messages
AUTH_WINDOW_S = 60        # sign-in attempts allowed per socket per window…
AUTH_MAX_TRIES = 8        # …before it has to wait

_turn_timers: Dict[str, asyncio.Task] = {}
_grace_tasks: Dict[str, asyncio.Task] = {}
_gchat: deque = deque(maxlen=CHAT_KEEP)
_last_chat: Dict[str, float] = {}

# Rate limits (in memory, per server process).
messages_per_socket = Limiter(150, 10)    # any message: 15 a second on average, with room for bursts
slow_down_notes = Limiter(1, 10)          # tell a flooding socket at most once per 10 s
auth_per_socket = Limiter(AUTH_MAX_TRIES, AUTH_WINDOW_S)
failed_signins = Limiter(5, 600)          # wrong passwords per username, then locked for the rest of the 10 min
signups_per_address = Limiter(10, 3600)   # new accounts per network address per hour
searches_per_account = Limiter(20, 10)    # Add friend lookups (the client debounces typing)
_ws_token: Dict[int, str] = {}


def _make_storage() -> Optional[Storage]:
    """Storage on the database named in the DB connection string, or None
    (pure in-memory) when DB isn't set."""
    url = os.environ.get("DB")
    if not url:
        return None
    client = AsyncMongoClient(url)
    db = client.get_default_database(default="app")
    return Storage(db["channels"], db["history"], client,
                   accounts=db["accounts"], sessions=db["sessions"], chat=db["chat"])


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global storage
    storage = _make_storage()
    if storage is None:
        log.warning("DB not set — state is in memory only and lost on restart")
        yield
        return

    account_docs, session_docs, chat = await storage.load_accounts()
    accounts.load(account_docs, session_docs)
    _gchat.extend(chat[-CHAT_KEEP:])
    await storage.ensure_indexes()
    for game in await storage.load_all():
        _restore(game)
    flusher = asyncio.create_task(storage.run(room_manager, accounts))
    try:
        yield
    finally:
        flusher.cancel()
        await storage.flush(room_manager, accounts)   # don't lose the last second on shutdown
        await storage.close()
        storage = None


app = FastAPI(title="Realtime server", version="2.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Turn clock, reconnect grace, persistence hooks
# ---------------------------------------------------------------------------

def _schedule_turn_timer(room_id: str) -> None:
    """(Re)start the per-room turn clock for the current turn."""
    old = _turn_timers.pop(room_id, None)
    if old:
        old.cancel()
    game = room_manager.get_room(room_id)
    if not game or game.status.value != "playing":
        return
    secs = game.settings.get("turn_seconds", TURN_SECONDS)
    secs += max(0.0, (game.countdown_until_ms or 0) / 1000 - time.time())   # first turn waits for 3-2-1
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


def _cancel_grace(aid: str) -> None:
    task = _grace_tasks.pop(aid, None)
    if task:
        task.cancel()


async def _expire_after_grace(aid: str) -> None:
    try:
        await asyncio.sleep(GRACE_SECONDS)
    except asyncio.CancelledError:
        return
    if _grace_tasks.get(aid) is not asyncio.current_task():
        return
    del _grace_tasks[aid]
    log.info("Account %s did not come back — removing", aid)
    await _depart(aid)
    await _leave_roles(aid)
    await _leave_route(aid)
    await _leave_party_for_good(aid)
    if aid in accounts.accounts:
        accounts.mark_seen(aid)
        await _presence_changed(aid)


# ---------------------------------------------------------------------------
# WebSocket endpoint + dispatch
# ---------------------------------------------------------------------------

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await _send(ws, "error", message="Invalid JSON.")
                continue
            if isinstance(msg, dict):
                await _dispatch(ws, msg)
    except WebSocketDisconnect:
        await _on_disconnect(ws)
    except Exception as exc:
        log.exception("Unexpected WebSocket error: %s", exc)
        await _on_disconnect(ws)


async def _dispatch(ws: WebSocket, msg: dict) -> None:
    if not messages_per_socket.hit(id(ws)):
        if slow_down_notes.hit(id(ws)):
            await _send(ws, "error", message="You're sending too fast. Slow down.")
        return
    t = msg.get("type", "")
    if t in SIGNED_OUT_HANDLERS:
        return await _guarded(ws, SIGNED_OUT_HANDLERS[t], msg)
    handler = HANDLERS.get(t)
    if not handler:
        return await _send(ws, "error", message=f"Unknown message type: {t}")
    aid = manager.get_player_id(ws)
    if not aid or aid not in accounts.accounts:
        return await _send(ws, "auth_error", message="Sign in first.")
    before = _room_of(ws)       # the room this socket leaves / acts in…
    await _guarded(ws, handler, msg)
    _save(before, _room_of(ws))  # …and the one it starts


async def _guarded(ws: WebSocket, handler, msg: dict) -> None:
    try:
        await handler(ws, msg)
    except (AccountError, PartyError, RolesError, RouteError) as exc:
        await _send(ws, "error", message=str(exc))
    except Exception as exc:
        log.exception("Handler error for type=%s: %s", msg.get("type"), exc)
        await _send(ws, "error", message="Something went wrong on the server.")


def _room_of(ws: WebSocket):
    aid = manager.get_player_id(ws)
    return room_manager.get_room_for_player(aid) if aid else None


async def _send(ws: WebSocket, type_: str, **payload) -> None:
    await manager.send({"type": type_, **payload}, ws)


async def _to(aid: str, type_: str, **payload) -> None:
    await manager.send_to_player({"type": type_, **payload}, aid)


async def _on_disconnect(ws: WebSocket) -> None:
    for limit in (auth_per_socket, messages_per_socket, slow_down_notes):
        limit.forget(id(ws))
    _ws_token.pop(id(ws), None)
    aid = await manager.disconnect(ws)
    if not aid:
        return
    match = _roles_of(aid)
    if match:
        match.set_connected(aid, False)
        await _push_roles(match)
    route = _route_of(aid)
    if route:
        route.set_connected(aid, False)
        await _push_route(route)
    # Don't drop them yet — a refresh or network blip signs back in within
    # seconds and _sign_in cancels this.
    _cancel_grace(aid)
    _grace_tasks[aid] = asyncio.create_task(_expire_after_grace(aid))


async def _depart(aid: str) -> None:
    """Take an account out of its room (leave, sign out, or grace expired).

    Mid-game they stay seated as offline; GameState.disconnect_player
    auto-plays their turns (or awards a default win)."""
    game = room_manager.get_room_for_player(aid)
    if not game:
        return
    player = game._find_player(aid)
    name = player.name if player else "A player"
    turn_before = game.current_player_index
    room_id = room_manager.remove_player(aid)
    log.info("'%s' left room %s", name, room_id)
    _save(game)  # saved, or deleted from the DB if the room just closed
    if game.status.value != "waiting":
        await _broadcast_game_state(room_id, reset_timer=game.current_player_index != turn_before)
    await _broadcast_to_room(room_id, {"type": "player_left", "player_name": name})


# ---------------------------------------------------------------------------
# Signing in and out
# ---------------------------------------------------------------------------

def _too_many_tries(ws: WebSocket) -> bool:
    return not auth_per_socket.hit(id(ws))


def _address(ws: WebSocket) -> str:
    # Behind Render's proxy the client is the first X-Forwarded-For entry. It can be forged,
    # so this only slows casual abuse; the per-username sign-in lock doesn't depend on it.
    fwd = ws.headers.get("x-forwarded-for")
    return fwd.split(",")[0].strip() if fwd else (ws.client.host if ws.client else "?")


async def _signup(ws: WebSocket, msg: dict) -> None:
    if _too_many_tries(ws):
        return await _send(ws, "auth_error", message="Too many attempts. Wait a minute and try again.")
    address = _address(ws)
    if signups_per_address.blocked(address):
        return await _send(ws, "auth_error", message="Too many new accounts from your network. Try again later.")
    try:
        # ponytail: scrypt runs on the event loop (~50 ms); move to asyncio.to_thread if sign-ups pile up
        account, token = accounts.signup(msg.get("username"), msg.get("password"),
                                         msg.get("display_name"), msg.get("character"))
    except AccountError as exc:
        return await _send(ws, "auth_error", message=str(exc))
    signups_per_address.hit(address)
    log.info("New account %s", account["username"])
    await _sign_in(ws, account, token)


async def _signin(ws: WebSocket, msg: dict) -> None:
    if _too_many_tries(ws):
        return await _send(ws, "auth_error", message="Too many attempts. Wait a minute and try again.")
    who = str(msg.get("username") or "").strip().lower().lstrip("@")
    if failed_signins.blocked(who):
        return await _send(ws, "auth_error", message="Too many wrong passwords for this account. Try again in 10 minutes.")
    try:
        account, token = accounts.signin(msg.get("username"), msg.get("password"))
    except AccountError as exc:
        failed_signins.hit(who)
        return await _send(ws, "auth_error", message=str(exc))
    failed_signins.forget(who)
    await _sign_in(ws, account, token)


async def _auth(ws: WebSocket, msg: dict) -> None:
    token = msg.get("token")
    account = accounts.auth(token)
    if not account:
        return await _send(ws, "auth_error", message="Your session has ended. Sign in again.")
    await _sign_in(ws, account, token)


async def _sign_in(ws: WebSocket, account: dict, token: str) -> None:
    aid = account["id"]
    for limit in (auth_per_socket, messages_per_socket, slow_down_notes):
        limit.forget(id(ws))
    _ws_token[id(ws)] = token
    manager.register(ws, aid, None)
    _cancel_grace(aid)
    accounts.mark_seen(aid)
    await _send(ws, "auth_ok", token=token, expires_at=accounts.session_expiry(token), profile=accounts.profile(aid))
    await _send(ws, "catalog", **catalog.public_catalog())

    # Still seated at a live table? Put them straight back.
    game = room_manager.get_room_for_player(aid)
    if game and game._find_player(aid) and game.reconnect_player(aid):
        manager.register(ws, aid, game.room_id)
        await _send(ws, "joined", player_id=aid, room_id=game.room_id, room_state=game.get_room_state())
        await _broadcast_game_state(game.room_id, reset_timer=False)
        await _broadcast_to_room(game.room_id, {"type": "player_reconnected", "player_name": game._find_player(aid).name},
                                 exclude_player=aid)

    match = _roles_of(aid)                    # back at a Raja Mantri Chor Sipahi table
    if match:
        match.set_connected(aid, True)
        await _push_roles(match)
    route = _route_of(aid)                    # back at an Ang Mang Chok Chang table
    if route:
        route.set_connected(aid, True)
        await _push_route(route)

    await _push_friends(aid)
    await _push_party(parties.ensure(aid))
    await _send(ws, "gchat_history", messages=list(_gchat))
    await _presence_changed(aid)


async def _signout(ws: WebSocket, _msg: dict) -> None:
    aid = manager.get_player_id(ws)
    accounts.signout(_ws_token.pop(id(ws), None))
    await _depart(aid)
    await _leave_roles(aid)
    await _leave_route(aid)
    await _leave_party_for_good(aid)
    manager.unbind_player(aid)
    accounts.mark_seen(aid)
    await _send(ws, "signed_out")
    await _presence_changed(aid)


# ---------------------------------------------------------------------------
# Profile, shop, inventory
# ---------------------------------------------------------------------------

async def _push_profile(aid: str) -> None:
    await _to(aid, "profile", profile=accounts.profile(aid))


async def _admin_give_coins(ws: WebSocket, msg: dict) -> None:
    aid = manager.get_player_id(ws)
    if accounts.accounts[aid]["username"] not in accounts.admins:
        raise AccountError("Only admins can give coins.")
    amount = msg.get("amount")
    target = accounts.give_coins(msg.get("username"), amount)
    name = accounts.accounts[target]["username"]
    log.info("Admin %s gave %s coins to %s", accounts.accounts[aid]["username"], amount, name)
    await _push_profile(target)
    await _send(ws, "notice", message=f"Gave {amount:,} coins to {name}.")


async def _leaderboard(ws: WebSocket, msg: dict) -> None:
    aid = manager.get_player_id(ws)
    await _to(aid, "leaderboard", **accounts.leaderboard(aid, msg.get("board"), msg.get("scope")))


async def _update_profile(ws: WebSocket, msg: dict) -> None:
    aid = manager.get_player_id(ws)
    if "display_name" in msg:
        accounts.set_display_name(aid, msg["display_name"])
    await _push_profile(aid)
    await _push_party(parties.of(aid))
    await _presence_changed(aid)


async def _equip(ws: WebSocket, msg: dict) -> None:
    aid = manager.get_player_id(ws)
    accounts.equip(aid, msg.get("item_id"))
    await _push_profile(aid)
    await _push_party(parties.of(aid))
    await _presence_changed(aid)


async def _buy(ws: WebSocket, msg: dict) -> None:
    aid = manager.get_player_id(ws)
    item = accounts.buy(aid, msg.get("item_id"))
    await _push_profile(aid)
    await _send(ws, "notice", message=f"{item['name']} is in your inventory.")


# ---------------------------------------------------------------------------
# Friends and presence
# ---------------------------------------------------------------------------

def _status(aid: str) -> str:
    if not manager.get_ws(aid):
        return "offline"
    match = _roles_of(aid) or _route_of(aid)
    if match and not match.finished:
        return "in_game"
    game = room_manager.get_room_for_player(aid)
    return "in_game" if game and game.status.value == "playing" else "online"


def _people(ids) -> list:
    return [accounts.person(i) for i in ids if i in accounts.accounts]


async def _push_friends(aid: str) -> None:
    if not manager.get_ws(aid) or aid not in accounts.accounts:
        return
    d = accounts.accounts[aid]
    friends = [
        {**accounts.person(f), "status": _status(f), "last_seen": accounts.accounts[f].get("last_seen"),
         "rank_label": accounts.rank_label(f)}
        for f in d["friends"] if f in accounts.accounts
    ]
    await _to(aid, "friends", friends=friends, incoming=_people(d["incoming"]), outgoing=_people(d["outgoing"]))


async def _presence_changed(aid: str) -> None:
    """Refresh the friend lists of everyone who can see this account."""
    for f in list(accounts.accounts.get(aid, {}).get("friends", [])):
        await _push_friends(f)


async def _friend_request(ws: WebSocket, msg: dict) -> None:
    aid = manager.get_player_id(ws)
    other = accounts.friend_request(aid, msg.get("username"))
    await _push_friends(aid)
    await _push_friends(other)
    if accounts.are_friends(aid, other):
        await _send(ws, "notice", message=f"You and {accounts.accounts[other]['display_name']} are now friends.")
    else:
        await _send(ws, "notice", message=f"Friend request sent to {accounts.accounts[other]['username']}.")


async def _friend_change(ws: WebSocket, msg: dict, action) -> None:
    aid = manager.get_player_id(ws)
    other = msg.get("id")
    if other not in accounts.accounts:
        raise AccountError("That player no longer exists.")
    action(aid, other)
    await _push_friends(aid)
    await _push_friends(other)


async def _friend_accept(ws, msg):
    await _friend_change(ws, msg, accounts.friend_accept)


async def _friend_decline(ws, msg):
    await _friend_change(ws, msg, accounts.friend_decline)


async def _friend_remove(ws, msg):
    await _friend_change(ws, msg, accounts.friend_remove)


async def _user_search(ws: WebSocket, msg: dict) -> None:
    """Add friend page: players matching the typed name, or a random handful for an empty box."""
    aid = manager.get_player_id(ws)
    if not searches_per_account.hit(aid):
        raise AccountError("You're searching too fast. Try again in a moment.")
    q, ids = accounts.search(aid, msg.get("q"), online=lambda other: manager.get_ws(other) is not None)
    users = [{**accounts.person(i), "status": _status(i), "rank_label": accounts.rank_label(i)} for i in ids]
    await _send(ws, "user_results", q=q, users=users)


# ---------------------------------------------------------------------------
# Party
# ---------------------------------------------------------------------------

def _party_view(p) -> dict:
    return {
        "id": p.id, "leader_id": p.leader_id, "game": p.game, "mode": p.mode,
        "turn_seconds": p.turn_seconds, "stack_draw_cards": p.stack_draw_cards, "route_rules": p.route_rules, "max": 5,
        "members": [{**accounts.person(m), "entry": accounts.accounts[m]["equipped"].get("entry"),
                     "ready": m in p.ready or m == p.leader_id,
                     "rank_label": accounts.rank_label(m)} for m in p.members if m in accounts.accounts],
    }


async def _push_party(p) -> None:
    if p is None or p.id not in parties.parties:
        return
    view = _party_view(p)
    for m in p.members:
        await _to(m, "party", party=view)


async def _leave_party_for_good(aid: str) -> None:
    if aid in parties.member_of:
        old = parties.of(aid)
        parties.drop(aid)
        await _push_party(old)


def _online_friend(aid: str, other) -> str:
    if other not in accounts.accounts or not accounts.are_friends(aid, other):
        raise PartyError("You can only party up with friends.")
    if not manager.get_ws(other):
        raise PartyError(f"{accounts.accounts[other]['display_name']} is offline.")
    return other


async def _party_invite(ws: WebSocket, msg: dict) -> None:
    aid = manager.get_player_id(ws)
    other = _online_friend(aid, msg.get("id"))
    party_id = parties.invite(aid, other)
    # built by hand: `from` is a Python keyword, so it can't go through _to(**payload)
    await manager.send_to_player({"type": "party_invite", "party_id": party_id, "from": accounts.person(aid),
                                  "size": len(parties.of(aid).members), "expires_in": INVITE_TTL_S}, other)
    await _send(ws, "notice", message=f"Invite sent to {accounts.accounts[other]['display_name']}.")


async def _party_accept(ws: WebSocket, msg: dict) -> None:
    aid = manager.get_player_id(ws)
    old = parties.of(aid)
    new = parties.accept(aid, msg.get("party_id"))
    await _push_party(old)
    await _push_party(new)


async def _party_request(ws: WebSocket, msg: dict) -> None:
    aid = manager.get_player_id(ws)
    other = _online_friend(aid, msg.get("id"))
    leader = parties.request(aid, other)
    await manager.send_to_player({"type": "party_request", "from": accounts.person(aid)}, leader)
    await _send(ws, "notice", message="Request sent to the party leader.")


async def _party_admit(ws: WebSocket, msg: dict) -> None:
    aid = manager.get_player_id(ws)
    who = msg.get("id")
    old = parties.of(who) if who in accounts.accounts else None
    new = parties.admit(aid, who)
    await _push_party(old)
    await _push_party(new)


async def _party_deny(ws: WebSocket, msg: dict) -> None:
    aid = manager.get_player_id(ws)
    who = msg.get("id")
    parties.deny(aid, who)
    if who in accounts.accounts:
        await _to(who, "notice", message=f"{accounts.accounts[aid]['display_name']}'s party couldn't take you right now.")


async def _party_leave(ws: WebSocket, _msg: dict) -> None:
    aid = manager.get_player_id(ws)
    old = parties.leave(aid)
    await _push_party(old)
    await _push_party(parties.of(aid))


async def _party_kick(ws: WebSocket, msg: dict) -> None:
    aid = manager.get_player_id(ws)
    who = msg.get("id")
    parties.kick(aid, who)
    await _push_party(parties.of(aid))
    await _push_party(parties.of(who))
    await _to(who, "notice", message="You were removed from the party.")


async def _party_ready(ws: WebSocket, msg: dict) -> None:
    await _push_party(parties.set_ready(manager.get_player_id(ws), bool(msg.get("ready"))))


async def _party_set(ws: WebSocket, msg: dict) -> None:
    settings = {k: msg[k] for k in ("game", "mode", "turn_seconds", "stack_draw_cards", "route_rules") if k in msg}
    await _push_party(parties.configure(manager.get_player_id(ws), settings))


async def _party_start(ws: WebSocket, _msg: dict) -> None:
    aid = manager.get_player_id(ws)
    p = parties.check_start(aid)
    for m in p.members:
        name = accounts.accounts[m]["display_name"]
        if not manager.get_ws(m):
            raise PartyError(f"{name} is offline.")
        seated = room_manager.get_room_for_player(m)
        match = _roles_of(m) or _route_of(m)
        if (seated and seated.status.value == "playing") or (match and not match.finished):
            raise PartyError(f"{name} is still in a game.")
    for m in p.members:                       # leave any finished table first
        if room_manager.get_room_for_player(m):
            await _depart(m)
        if _roles_of(m):
            await _leave_roles(m)
            await _to(m, "roles_left")
        if _route_of(m):
            await _leave_route(m)
            await _to(m, "route_left")
    if p.game == "roles":
        return await _start_roles(p)
    if p.game == "route":
        return await _start_route(p)

    room_id = room_manager.create_room()
    game = room_manager.get_room(room_id)
    for m in p.members:
        d = accounts.accounts[m]
        room_manager.add_player_to_room(room_id, Player(
            name=d["display_name"], id=m,
            character=d["equipped"]["character"], card_back=d["equipped"]["card_back"]))
    game.host_player_id = p.leader_id
    game.mode = p.mode
    game.settings.update(turn_seconds=p.turn_seconds, stack_draw_cards=p.stack_draw_cards)
    leader = accounts.accounts[p.leader_id]["equipped"]
    game.felt, game.deck_back = leader["felt"], leader["card_back"]
    result = game.start_game()
    if not result["success"]:
        raise PartyError(result["error"])
    p.ready.clear()
    for m in p.members:
        manager.register(manager.get_ws(m), m, room_id)
        await _to(m, "joined", player_id=m, room_id=room_id, room_state=game.get_room_state())
    log.info("Game %s started for party %s (%s)", room_id, p.id, p.mode)
    _save(game)
    await _broadcast_game_state(room_id)
    await _push_party(p)
    for m in p.members:
        await _presence_changed(m)


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------

def _chat_text(aid: str, msg: dict) -> Optional[str]:
    text = " ".join(str(msg.get("text") or "").split())[:CHAT_MAX_LEN]
    if not text:
        return None
    now = time.monotonic()
    if now - _last_chat.get(aid, -1e9) < CHAT_GAP_S:
        raise AccountError("Slow down a little.")
    _last_chat[aid] = now
    return text


def _chat_message(aid: str, text: str) -> dict:
    return {"id": uuid.uuid4().hex[:12], "from": accounts.person(aid), "text": text, "ts": int(time.time() * 1000)}


async def _gchat_send(ws: WebSocket, msg: dict) -> None:
    aid = manager.get_player_id(ws)
    text = _chat_text(aid, msg)
    if not text:
        return
    m = _chat_message(aid, text)
    _gchat.append(m)
    if storage:
        storage.mark_chat(_gchat)
    await manager.broadcast_common({"type": "gchat", "message": m}, manager.player_ids())


async def _pchat_send(ws: WebSocket, msg: dict) -> None:
    aid = manager.get_player_id(ws)
    text = _chat_text(aid, msg)
    if not text:
        return
    await manager.broadcast_common({"type": "pchat", "message": _chat_message(aid, text)}, parties.of(aid).members)


EMOTE_GAP_S = 1.0           # one lobby emote a second per account (a new one replaces the playing one)
_last_emote: Dict[str, float] = {}


async def _emote(ws: WebSocket, msg: dict) -> None:
    """Your character acts out an emote on its lobby pedestal, for the whole party (you included)."""
    aid = manager.get_player_id(ws)
    emote = msg.get("emote")
    pack = catalog.LOBBY_EMOTES.get(emote) if isinstance(emote, str) else None
    if not pack:
        raise PartyError("Unknown emote.")
    if pack not in accounts.accounts[aid]["inventory"]:
        raise PartyError(f"Unlock {catalog.ITEM_BY_ID[pack]['name']} to use that emote.")
    now = time.monotonic()
    if now - _last_emote.get(aid, -1e9) < EMOTE_GAP_S:
        return                      # the picker can't go this fast; this just caps a flood
    _last_emote[aid] = now
    await manager.broadcast_common({"type": "emote", "id": aid, "emote": emote}, parties.of(aid).members)


# ---------------------------------------------------------------------------
# Game actions
# ---------------------------------------------------------------------------

def _game_for(ws: WebSocket):
    aid = manager.get_player_id(ws)
    game = room_manager.get_room_for_player(aid)
    if not game:
        raise PartyError("You're not in a game.")
    return aid, game


async def _turn_action(ws: WebSocket, result: dict, game, reset_timer: bool = True) -> None:
    if not result["success"]:
        return await _send(ws, "error", message=result["error"])
    await _broadcast_game_state(game.room_id, reset_timer=reset_timer)


async def _play_card(ws, msg):
    aid, game = _game_for(ws)
    await _turn_action(ws, game.play_card(aid, msg.get("card_id", ""), msg.get("chosen_color")), game)


async def _draw_card(ws, _msg):
    aid, game = _game_for(ws)
    await _turn_action(ws, game.draw_card(aid), game)


async def _pass_turn(ws, _msg):
    aid, game = _game_for(ws)
    await _turn_action(ws, game.pass_turn(aid), game)


async def _call_uno(ws, _msg):
    aid, game = _game_for(ws)
    # Not a turn action — must not extend the current player's clock.
    await _turn_action(ws, game.call_uno(aid), game, reset_timer=False)


async def _catch_uno(ws, msg):
    aid, game = _game_for(ws)
    await _turn_action(ws, game.catch_uno_violation(aid, msg.get("target_id", "")), game, reset_timer=False)


async def _challenge_wild4(ws, _msg):
    aid, game = _game_for(ws)
    await _turn_action(ws, game.challenge_wild_four(aid), game)


async def _chat(ws: WebSocket, msg: dict) -> None:
    """A chat line / emoji bubble over your seat, for everyone at the table."""
    match = _roles_of(manager.get_player_id(ws)) or _route_of(manager.get_player_id(ws))
    if match:
        aid = manager.get_player_id(ws)
        text = (msg.get("text") or "").strip()[:120]
        if text:
            await manager.broadcast_common({"type": "chat", "player_id": aid, "player_name": match.seat(aid).name,
                                            "text": text}, _table_people(match))
        return
    aid, game = _game_for(ws)
    text = (msg.get("text") or "").strip()[:120]
    if text:
        player = game._find_player(aid)
        await _broadcast_to_room(game.room_id, {"type": "chat", "player_id": aid,
                                                "player_name": player.name if player else "?", "text": text})


LOOK_GAP_S = 0.05           # relay at most ~20 look updates a second per player
_last_look: Dict[str, float] = {}


def _angle(value, limit: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value != value:
        raise PartyError("Look angles must be numbers.")
    return max(-limit, min(limit, float(value)))


async def _look(ws: WebSocket, msg: dict) -> None:
    """Where a player's camera points; the others turn that player's head to match."""
    aid = manager.get_player_id(ws)
    match = _roles_of(aid) or _route_of(aid)
    game = None if match else _game_for(ws)[1]
    yaw, pitch = _angle(msg.get("yaw"), 1.0), _angle(msg.get("pitch"), 0.6)
    now = time.monotonic()
    if now - _last_look.get(aid, -1.0) < LOOK_GAP_S:
        return                      # client throttles too; this just caps a flood
    _last_look[aid] = now
    if match:
        return await manager.broadcast_common({"type": "look", "id": aid, "yaw": yaw, "pitch": pitch},
                                              _table_people(match, exclude=aid))
    await _broadcast_to_room(game.room_id, {"type": "look", "id": aid, "yaw": yaw, "pitch": pitch}, exclude_player=aid)


async def _leave_room(ws: WebSocket, _msg: dict) -> None:
    aid = manager.get_player_id(ws)
    await _depart(aid)
    await _push_party(parties.of(aid))
    await _presence_changed(aid)


async def _rematch(ws: WebSocket, _msg: dict) -> None:
    """Play again: same table, everyone still there, a fresh deal straight away."""
    aid, game = _game_for(ws)
    if game.status.value != "finished":
        raise PartyError("The game isn't finished yet.")
    if game.host_player_id != aid:
        host = game._find_player(game.host_player_id)
        if host and host.is_connected:
            raise PartyError("Only the host can start another round.")
        game.host_player_id = aid   # host left — don't dead-end the table
    if sum(1 for p in game.players if p.is_connected) < 2:
        raise PartyError("Not enough players are still here for another round.")
    old = _turn_timers.pop(game.room_id, None)
    if old:
        old.cancel()
    result = game.reset_for_rematch()
    for pid in result.get("removed_player_ids", []):
        room_manager.unregister_player(pid)
    start = game.start_game()
    if not start["success"]:
        raise PartyError(start["error"])
    log.info("New round in room %s", game.room_id)
    await _broadcast_game_state(game.room_id)
    for p in game.players:
        await _presence_changed(p.id)


async def _kick_player(ws: WebSocket, msg: dict) -> None:
    """Host removes a player from the table."""
    aid, game = _game_for(ws)
    target_id = msg.get("target_id", "")
    turn_before = game.current_player_index
    result = game.kick_player(aid, target_id)
    if not result["success"]:
        return await _send(ws, "error", message=result["error"])
    _cancel_grace(target_id)
    await _to(target_id, "kicked", message="You were removed from the table by the host.")
    room_manager.unregister_player(target_id)
    await _broadcast_to_room(game.room_id, {"type": "player_left", "player_name": result.get("player_name", "A player")})
    if game.status.value in ("playing", "finished"):
        await _broadcast_game_state(game.room_id, reset_timer=game.current_player_index != turn_before)
    await _presence_changed(target_id)


# ---------------------------------------------------------------------------
# Broadcasting and rewards
# ---------------------------------------------------------------------------

def _apply_rewards(game) -> Dict[str, dict]:
    """Pay out a finished game exactly once (coins, rank points, stats, milestones)."""
    ranked = game.mode == "ranked"
    n = len(game.placements)
    rewards = {}
    for pl in game.placements:
        pid = pl["id"]
        if pid in accounts.accounts:
            rewards[pid] = accounts.record_game(pid, pl["rank"], n, ranked, pid in game.departed_ids)
    game.rewards = rewards
    _save(game)
    return rewards


async def _broadcast_game_state(room_id: str, reset_timer: bool = True) -> None:
    """Send a personalised game_state message to every player in a room.

    reset_timer=True starts a fresh turn clock (use after turn actions);
    False keeps the running one (UNO calls, catches, reconnects)."""
    game = room_manager.get_room(room_id)
    if not game:
        return
    paid = None
    if game.status.value == "finished" and not game.rewards and game.placements:
        paid = _apply_rewards(game)
    if reset_timer or room_id not in _turn_timers:
        _schedule_turn_timer(room_id)
    messages = {pid: {"type": "game_state", "state": game.get_state_for_player(pid)} for pid in _seated(game)}
    await manager.broadcast_room(messages)
    if paid:
        for pid, reward in paid.items():
            await _to(pid, "game_rewards", rewards=reward)
            await _push_profile(pid)
        for p in game.players:
            await _presence_changed(p.id)


async def _broadcast_to_room(room_id: str, message: dict, exclude_player: Optional[str] = None) -> None:
    """Broadcast a generic message to all (or most) players in a room."""
    game = room_manager.get_room(room_id)
    if not game:
        return
    await manager.broadcast_common(message, [pid for pid in _seated(game) if pid != exclude_player])


def _seated(game) -> list:
    """Players still at this table. Someone who left stays in game.players (offline, so their
    turns auto-play and payouts work) but must get no more of its messages, or a finished
    table pops back up in their lobby."""
    return [p.id for p in game.players if room_manager.get_room_for_player(p.id) is game]


# ---------------------------------------------------------------------------
# Raja Mantri Chor Sipahi (core/roles.py): four seats, bots fill the empty ones
# ---------------------------------------------------------------------------

ROLES_TICK_S = 0.2           # each match's clock: bots act and reveals move on at this resolution
BOT_NAMES = ["Asha", "Vikram", "Meera", "Arjun", "Kabir", "Isha", "Rohan", "Tara", "Dev", "Nisha"]
BOT_CHARACTERS = [i["id"] for i in catalog.ITEMS if i["kind"] == "character"]
role_matches: Dict[str, RolesMatch] = {}
role_seat: Dict[str, str] = {}               # account id -> the match they're seated at
_role_tasks: Dict[str, asyncio.Task] = {}


def _roles_of(aid: Optional[str]) -> Optional[RolesMatch]:
    mid = role_seat.get(aid) if aid else None
    return role_matches.get(mid) if mid else None


def _roles_people(match: RolesMatch, exclude: Optional[str] = None) -> list:
    """Humans still at this table; someone who left gets none of its messages."""
    return [s.id for s in match.seats if not s.bot and role_seat.get(s.id) == match.id and s.id != exclude]


async def _push_roles(match: RolesMatch) -> None:
    for aid in _roles_people(match):
        await _to(aid, "roles_state", state=match.state_for(aid))


async def _start_roles(p) -> None:
    seats = [RoleSeat(id=m, name=accounts.accounts[m]["display_name"],
                      character=accounts.accounts[m]["equipped"]["character"]) for m in p.members]
    seats += [RoleSeat(id=f"bot-{uuid.uuid4().hex[:8]}", name=name, character=random.choice(BOT_CHARACTERS), bot=True)
              for name in random.sample(BOT_NAMES, 4 - len(seats))]
    random.shuffle(seats)                    # who sits where around the table
    # ponytail: matches live in memory only; a server restart mid-match ends it
    match = RolesMatch(seats)
    role_matches[match.id] = match
    for m in p.members:
        role_seat[m] = match.id
    p.ready.clear()
    log.info("Roles match %s started for party %s (%d bots)", match.id, p.id, 4 - len(p.members))
    _role_tasks[match.id] = asyncio.create_task(_drive_roles(match))
    await _push_roles(match)
    await _push_party(p)
    for m in p.members:
        await _presence_changed(m)


def _pay_roles(match: RolesMatch) -> None:
    """Coins and stats for the humans, once, by final place (casual: no rank points)."""
    place = {r["id"]: r["place"] for r in match.standings()}
    for s in match.seats:
        if not s.bot and s.id in accounts.accounts:
            match.rewards[s.id] = accounts.record_game(s.id, place[s.id], len(match.seats), False, s.left)


async def _drive_roles(match: RolesMatch) -> None:
    """The match's clock: lets it tick, pushes every change, pays out once at the end."""
    try:
        while not match.finished:
            await asyncio.sleep(ROLES_TICK_S)
            if not match.tick():
                continue
            if match.finished:
                _pay_roles(match)
            await _push_roles(match)
        for aid in _roles_people(match):
            await _to(aid, "game_rewards", rewards=match.rewards.get(aid))
            await _push_profile(aid)
            await _presence_changed(aid)
    except asyncio.CancelledError:
        pass
    finally:
        _role_tasks.pop(match.id, None)


async def _leave_roles(aid: str) -> None:
    """Off the table: mid-match their seat plays itself; the last human out closes it."""
    match = _roles_of(aid)
    if not match:
        return
    del role_seat[aid]
    if not match.finished:
        match.leave(aid)
    if _roles_people(match):
        await _push_roles(match)
        return
    task = _role_tasks.pop(match.id, None)
    if task:
        task.cancel()
    role_matches.pop(match.id, None)


def _roles_for(ws: WebSocket):
    aid = manager.get_player_id(ws)
    match = _roles_of(aid)
    if not match:
        raise RolesError("You're not at a Raja Mantri Chor Sipahi table.")
    return aid, match


async def _roles_pick(ws: WebSocket, msg: dict) -> None:
    """Take one of the four rolled chits."""
    aid, match = _roles_for(ws)
    match.pick(aid, msg.get("slot"))
    await _push_roles(match)


async def _roles_aim(ws: WebSocket, msg: dict) -> None:
    """The Mantri swings the blaster toward a suspect (or lowers it); everyone sees it."""
    aid, match = _roles_for(ws)
    if match.set_aim(aid, msg.get("target")):
        await _push_roles(match)


async def _roles_guess(ws: WebSocket, msg: dict) -> None:
    """The Mantri fires: names the Chor."""
    aid, match = _roles_for(ws)
    match.guess(aid, msg.get("target"))
    await _push_roles(match)


async def _roles_leave(ws: WebSocket, _msg: dict) -> None:
    aid = manager.get_player_id(ws)
    await _leave_roles(aid)
    await _send(ws, "roles_left")
    await _push_party(parties.of(aid))
    await _presence_changed(aid)


# ---------------------------------------------------------------------------
# Ang Mang Chok Chang (core/route.py): four seats, bots fill the empty ones
# ---------------------------------------------------------------------------

ROUTE_TICK_S = 0.2           # each match's clock: bots act, timers run out, animation pauses end
route_matches: Dict[str, RouteMatch] = {}
route_seat: Dict[str, str] = {}              # account id -> the match they're seated at
_route_tasks: Dict[str, asyncio.Task] = {}


def _route_of(aid: Optional[str]) -> Optional[RouteMatch]:
    mid = route_seat.get(aid) if aid else None
    return route_matches.get(mid) if mid else None


def _route_people(match: RouteMatch, exclude: Optional[str] = None) -> list:
    """Humans still at this table; someone who left gets none of its messages."""
    return [s.id for s in match.seats if not s.bot and route_seat.get(s.id) == match.id and s.id != exclude]


def _table_people(match, exclude: Optional[str] = None) -> list:
    """Humans at either table game (chat and head-look relay)."""
    return _route_people(match, exclude) if isinstance(match, RouteMatch) else _roles_people(match, exclude)


def _pay_route(match: RouteMatch) -> None:
    """Coins and stats for each human as soon as their place is fixed (casual: no rank points).
    Leaving before finishing counts as leaving early; a finished human keeps their payout."""
    for sid in match.newly_placed():
        if sid in accounts.accounts:
            match.rewards[sid] = accounts.record_game(sid, match.places.index(sid) + 1, len(match.seats), False,
                                                      match.seat(sid).left)


async def _push_route(match: RouteMatch) -> None:
    _pay_route(match)
    for aid in _route_people(match):
        await _to(aid, "route_state", state=match.state_for(aid))


async def _start_route(p) -> None:
    seats = [RouteSeat(id=m, name=accounts.accounts[m]["display_name"],
                       character=accounts.accounts[m]["equipped"]["character"]) for m in p.members]
    seats += [RouteSeat(id=f"bot-{uuid.uuid4().hex[:8]}", name=name, character=random.choice(BOT_CHARACTERS), bot=True)
              for name in random.sample(BOT_NAMES, 4 - len(seats))]
    random.shuffle(seats)                    # who sits on which side of the board
    # ponytail: matches live in memory only; a server restart mid-match ends it
    match = RouteMatch(seats, rules=p.route_rules)
    route_matches[match.id] = match
    for m in p.members:
        route_seat[m] = match.id
    p.ready.clear()
    log.info("Route match %s started for party %s (%d bots, %s rules)", match.id, p.id, 4 - len(p.members), p.route_rules)
    _route_tasks[match.id] = asyncio.create_task(_drive_route(match))
    await _push_route(match)
    await _push_party(p)
    for m in p.members:
        await _presence_changed(m)


async def _drive_route(match: RouteMatch) -> None:
    """The match's clock: lets it tick, pushes every change, sends the results once at the end."""
    try:
        while not match.finished:
            await asyncio.sleep(ROUTE_TICK_S)
            if match.tick():
                await _push_route(match)
        await _push_route(match)
        for aid in _route_people(match):
            await _to(aid, "game_rewards", rewards=match.rewards.get(aid))
            await _push_profile(aid)
            await _presence_changed(aid)
    except asyncio.CancelledError:
        pass
    finally:
        _route_tasks.pop(match.id, None)


async def _leave_route(aid: str) -> None:
    """Off the table: mid-match their seat plays itself; the last human out closes it."""
    match = _route_of(aid)
    if not match:
        return
    del route_seat[aid]
    if not match.finished:
        match.leave(aid)
    if _route_people(match):
        await _push_route(match)
        return
    _pay_route(match)
    task = _route_tasks.pop(match.id, None)
    if task:
        task.cancel()
    route_matches.pop(match.id, None)


def _route_for(ws: WebSocket):
    aid = manager.get_player_id(ws)
    match = _route_of(aid)
    if not match:
        raise RouteError("You're not at an Ang Mang Chok Chang table.")
    return aid, match


async def _route_throw(ws: WebSocket, _msg: dict) -> None:
    """Throw the four cowrie shells (the server rolls them)."""
    aid, match = _route_for(ws)
    match.do_throw(aid)
    await _push_route(match)


async def _route_move(ws: WebSocket, msg: dict) -> None:
    """Move one pawn by the throw in hand."""
    aid, match = _route_for(ws)
    pawn = msg.get("pawn")
    if isinstance(pawn, bool) or not isinstance(pawn, int):
        raise RouteError("Pick one of your pawns.")
    match.do_move(aid, pawn)
    await _push_route(match)


async def _route_leave(ws: WebSocket, _msg: dict) -> None:
    aid = manager.get_player_id(ws)
    await _leave_route(aid)
    await _send(ws, "route_left")
    await _push_profile(aid)                  # a finished player's coins show in the lobby at once
    await _push_party(parties.of(aid))
    await _presence_changed(aid)


# ---------------------------------------------------------------------------
# Handler tables
# ---------------------------------------------------------------------------

SIGNED_OUT_HANDLERS = {"signup": _signup, "signin": _signin, "auth": _auth}

HANDLERS = {
    "signout": _signout, "update_profile": _update_profile, "leaderboard": _leaderboard, "admin_give_coins": _admin_give_coins, "equip": _equip, "buy": _buy,
    "friend_request": _friend_request, "friend_accept": _friend_accept,
    "friend_decline": _friend_decline, "friend_remove": _friend_remove, "user_search": _user_search,
    "party_invite": _party_invite, "party_accept": _party_accept, "party_request": _party_request,
    "party_admit": _party_admit, "party_deny": _party_deny, "party_leave": _party_leave,
    "party_kick": _party_kick, "party_ready": _party_ready, "party_set": _party_set,
    "party_start": _party_start,
    "gchat": _gchat_send, "pchat": _pchat_send, "emote": _emote,
    "play_card": _play_card, "draw_card": _draw_card, "pass_turn": _pass_turn,
    "call_uno": _call_uno, "catch_uno": _catch_uno, "challenge_wild4": _challenge_wild4,
    "roles_pick": _roles_pick, "roles_aim": _roles_aim, "roles_guess": _roles_guess, "roles_leave": _roles_leave,
    "route_throw": _route_throw, "route_move": _route_move, "route_leave": _route_leave,
    "chat": _chat, "look": _look, "leave_room": _leave_room, "rematch": _rematch, "kick_player": _kick_player,
}
