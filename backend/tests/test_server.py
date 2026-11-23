"""
WebSocket-level tests for main.py: accounts, friends, party → game, turn
clock, reconnect grace, rewards, chat. Run from backend/:  python -m pytest tests/ -v
"""
import itertools
import os
import sys
import time
from contextlib import ExitStack

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient

import main
import core.roles
import core.session
from core.limits import Limiter
from core.item import Card, CardType, Color

_seq = itertools.count(1)


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main, "GRACE_SECONDS", 0.3)
    monkeypatch.setattr(main, "CHAT_GAP_S", 0)
    monkeypatch.setattr(core.session, "COUNTDOWN_S", 0)   # tests that need it set it back
    # The suite makes hundreds of accounts from one address: rate-limit tests set their own limits.
    for name in ("messages_per_socket", "failed_signins", "signups_per_address", "searches_per_account"):
        monkeypatch.setattr(main, name, Limiter(10**6, 60))
    with TestClient(main.app) as c:
        yield c


def recv(ws, type_):
    while True:
        msg = ws.receive_json()
        if msg["type"] == type_:
            return msg


def drain(ws):
    """Everything queued for ws so far (a bogus message's error reply marks the end)."""
    ws.send_json({"type": "ping"})
    out = []
    while True:
        msg = ws.receive_json()
        if msg["type"] == "error" and "Unknown message type" in msg["message"]:
            return out
        out.append(msg)


def signup(ws, display=None):
    name = f"@t{os.getpid() % 1000}_{next(_seq)}"
    ws.send_json({"type": "signup", "username": name, "password": "password1",
                  "display_name": display, "character": "char:m-Casual"})
    ok = recv(ws, "auth_ok")
    return ok["profile"]["id"], ok["token"], name


def befriend(a, b, a_id, b_name):
    a.send_json({"type": "friend_request", "username": b_name})
    b.send_json({"type": "friend_accept", "id": a_id})
    while not any(f["id"] == a_id for f in recv(b, "friends")["friends"]):
        pass


def party_up(a, b, b_id):
    a.send_json({"type": "party_invite", "id": b_id})
    invite = recv(b, "party_invite")
    assert invite["expires_in"] == 30                    # the client counts this down
    b.send_json({"type": "party_accept", "party_id": invite["party_id"]})
    b.send_json({"type": "party_ready", "ready": True})
    while True:
        p = recv(a, "party")["party"]
        if len(p["members"]) == 2 and all(m["ready"] for m in p["members"]):
            return


def start(client, sa, sb, turn_seconds=None, mode=None):
    a = sa.enter_context(client.websocket_connect("/ws"))
    b = sb.enter_context(client.websocket_connect("/ws"))
    a_id, a_tok, _ = signup(a, "Ana")
    b_id, b_tok, b_name = signup(b, "Bo")
    befriend(a, b, a_id, b_name)
    party_up(a, b, b_id)
    if mode:
        a.send_json({"type": "party_set", "mode": mode})
    if turn_seconds:
        main.parties.of(a_id).turn_seconds = turn_seconds
    a.send_json({"type": "party_start"})
    recv(a, "game_state")
    recv(b, "game_state")
    return a, b, a_id, b_id, main.room_manager.get_room_for_player(a_id), (a_tok, b_tok)


def win_now(game, socks):
    """Give the current player one playable card and play it."""
    cur = game.players[game.current_player_index]
    card = Card(color=Color(game.current_color.value), card_type=CardType.NUMBER, number=1)
    cur.hand = [card]
    socks[cur.id].send_json({"type": "play_card", "card_id": card.id})
    return cur.id


# ── accounts ─────────────────────────────────────────────────────────────

def test_signup_sends_everything_the_lobby_needs(client):
    with client.websocket_connect("/ws") as ws:
        aid, _, _ = signup(ws)
        types = {m["type"] for m in drain(ws)}
        assert {"catalog", "friends", "party", "gchat_history"} <= types
        assert main.accounts.profile(aid)["coins"] == 200


def test_game_messages_need_sign_in(client):
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "draw_card"})
        assert ws.receive_json()["type"] == "auth_error"


def test_session_token_signs_in_on_a_new_socket(client):
    with client.websocket_connect("/ws") as ws:
        aid, token, _ = signup(ws)
    with client.websocket_connect("/ws") as ws2:
        ws2.send_json({"type": "auth", "token": token})
        assert recv(ws2, "auth_ok")["profile"]["id"] == aid
        ws2.send_json({"type": "auth", "token": "forged"})
        assert recv(ws2, "auth_error")["message"]


def test_signout_ends_the_session(client):
    with client.websocket_connect("/ws") as ws:
        _, token, _ = signup(ws)
        ws.send_json({"type": "signout"})
        recv(ws, "signed_out")
    with client.websocket_connect("/ws") as ws2:
        ws2.send_json({"type": "auth", "token": token})
        assert ws2.receive_json()["type"] == "auth_error"


def test_long_display_name_rejected(client):
    with client.websocket_connect("/ws") as ws:
        signup(ws)
        ws.send_json({"type": "update_profile", "display_name": "x" * 30})
        assert "1–20" in recv(ws, "error")["message"]


def test_only_friends_can_be_invited(client):
    with client.websocket_connect("/ws") as a, client.websocket_connect("/ws") as b:
        signup(a)
        b_id, _, _ = signup(b)
        a.send_json({"type": "party_invite", "id": b_id})
        assert "friends" in recv(a, "error")["message"]


def test_party_members_carry_their_entrance(client):
    with client.websocket_connect("/ws") as a, client.websocket_connect("/ws") as b:
        a_id, _, _ = signup(a)
        b_id, _, b_name = signup(b)
        befriend(a, b, a_id, b_name)
        party_up(a, b, b_id)
        view = main._party_view(main.parties.of(a_id))
        assert [m["entry"] for m in view["members"]] == ["entry:classic", "entry:classic"]


# ── party → game ─────────────────────────────────────────────────────────

def test_party_start_seats_everyone_with_their_look(client):
    with ExitStack() as sa, ExitStack() as sb:
        a, b, a_id, b_id, game, _ = start(client, sa, sb, mode="ranked")
        state = game.get_state_for_player(b_id)
        assert {p["character"] for p in state["players"]} == {"char:m-Casual"}
        assert (state["mode"], state["felt"], state["deck_back"]) == ("ranked", "felt:green", "back:classic")
        assert game.host_player_id == a_id


def test_uno_call_does_not_reset_turn_clock(client):
    with ExitStack() as sa, ExitStack() as sb:
        a, b, a_id, b_id, game, _ = start(client, sa, sb)
        current = game.players[game.current_player_index].id
        caller_ws, caller_id = (b, b_id) if current == a_id else (a, a_id)
        game._find_player(caller_id).hand = game._find_player(caller_id).hand[:1]
        deadline = game.turn_deadline_ms
        time.sleep(0.02)
        caller_ws.send_json({"type": "call_uno"})
        assert recv(caller_ws, "game_state")["state"]["turn_deadline"] == deadline


def test_state_reports_time_left_on_turn(client):
    with ExitStack() as sa, ExitStack() as sb:
        _, _, a_id, _, game, _ = start(client, sa, sb)
        assert 0 < game.get_state_for_player(a_id)["turn_ms_left"] <= 30_000


def test_first_turn_clock_starts_after_the_countdown(client, monkeypatch):
    monkeypatch.setattr(core.session, "COUNTDOWN_S", 3)
    with ExitStack() as sa, ExitStack() as sb:
        _, _, a_id, _, game, _ = start(client, sa, sb)
        state = game.get_state_for_player(a_id)
        assert state["countdown_ms_left"] > 2_000
        assert 32_000 < state["turn_ms_left"] <= 33_000     # a full 30 s once play opens


def test_turn_timeout_reaches_clients(client):
    with ExitStack() as sa, ExitStack() as sb:
        a, *_ = start(client, sa, sb, turn_seconds=0.2)
        time.sleep(0.35)
        states = [m["state"] for m in drain(a) if m["type"] == "game_state"]
        assert any("ran out of time" in s["last_action"] for s in states)


# ── leaving, reconnecting, rewards ───────────────────────────────────────

def test_dropped_player_keeps_seat_during_grace(client):
    with ExitStack() as sa:
        sb = ExitStack()
        a, b, a_id, b_id, game, _ = start(client, sa, sb)
        sb.close()
        time.sleep(0.1)
        assert game.status.value == "playing" and game._find_player(b_id).is_connected
        time.sleep(0.5)
        assert game.status.value == "finished" and game.winner_id == a_id
        assert main.parties.of(a_id).members == [a_id]       # gone from the party too


def test_signing_back_in_within_grace_keeps_game_going(client):
    with ExitStack() as sa:
        sb = ExitStack()
        a, b, a_id, b_id, game, (_, b_tok) = start(client, sa, sb)
        sb.close()
        with client.websocket_connect("/ws") as b2:
            b2.send_json({"type": "auth", "token": b_tok})
            recv(b2, "joined")
            time.sleep(0.5)
            assert game.status.value == "playing" and game._find_player(b_id).is_connected


def test_signing_back_in_to_a_finished_game_gets_its_state(client):
    with ExitStack() as sa:
        sb = ExitStack()
        a, b, a_id, b_id, game, (_, b_tok) = start(client, sa, sb)
        sb.close()
        time.sleep(0.5)
        assert game.status.value == "finished"
        main.room_manager.register_player_in_room(b_id, game.room_id)   # still seated at the table
        with client.websocket_connect("/ws") as b2:
            b2.send_json({"type": "auth", "token": b_tok})
            assert any(m["type"] == "game_state" and m["state"]["status"] == "finished" for m in drain(b2))


def test_leaving_on_your_turn_ends_game_and_pays_out(client):
    with ExitStack() as sa, ExitStack() as sb:
        a, b, a_id, b_id, game, _ = start(client, sa, sb)
        current = game.players[game.current_player_index].id
        leaver, stayer, stayer_id, leaver_id = (a, b, b_id, a_id) if current == a_id else (b, a, a_id, b_id)
        leaver.send_json({"type": "leave_room"})
        drain(leaver)
        msgs = drain(stayer)
        assert [m for m in msgs if m["type"] == "game_state"][-1]["state"]["status"] == "finished"
        reward = next(m for m in msgs if m["type"] == "game_rewards")["rewards"]
        assert reward["coins"] == 50 and reward["placement"] == 1
        assert game.rewards[leaver_id]["coins"] == 0
        assert main.accounts.profile(stayer_id)["coins"] == 250


def test_rewards_are_paid_exactly_once(client):
    with ExitStack() as sa, ExitStack() as sb:
        a, b, a_id, b_id, game, _ = start(client, sa, sb, mode="ranked")
        socks = {a_id: a, b_id: b}
        winner = win_now(game, socks)
        drain(a), drain(b)
        assert game.status.value == "finished" and game.rewards[winner]["rp"] == 30
        coins = main.accounts.profile(winner)["coins"]
        loser_ws = socks[a_id if winner == b_id else b_id]
        loser_ws.send_json({"type": "leave_room"})   # re-broadcasts the finished table
        drain(loser_ws), drain(socks[winner])
        assert main.accounts.profile(winner)["coins"] == coins


def test_back_to_lobby_after_the_end_does_not_reopen_the_results(client):
    with ExitStack() as sa, ExitStack() as sb:
        a, b, a_id, b_id, game, _ = start(client, sa, sb)
        win_now(game, {a_id: a, b_id: b})
        drain(a), drain(b)
        a.send_json({"type": "leave_room"})
        assert not any(m["type"] == "game_state" for m in drain(a))


def test_leaving_mid_game_does_not_show_you_the_end(client):
    with ExitStack() as sa, ExitStack() as sb:
        a, b, a_id, b_id, game, _ = start(client, sa, sb)
        a.send_json({"type": "leave_room"})
        assert not any(m["type"] in ("game_state", "player_left") for m in drain(a))
        assert [m for m in drain(b) if m["type"] == "game_state"][-1]["state"]["status"] == "finished"


def test_play_again_deals_immediately(client):
    with ExitStack() as sa, ExitStack() as sb:
        a, b, a_id, b_id, game, _ = start(client, sa, sb)
        win_now(game, {a_id: a, b_id: b})
        drain(a), drain(b)
        a.send_json({"type": "rematch"})
        drain(a)
        assert game.status.value == "playing" and game.rewards == {}


# ── in game: where each player is looking ────────────────────────────────

def test_looking_around_is_shown_to_the_rest_of_the_table(client):
    with ExitStack() as sa, ExitStack() as sb:
        a, b, a_id, b_id, game, _ = start(client, sa, sb)
        a.send_json({"type": "look", "yaw": 0.5, "pitch": -0.2})
        msg = recv(b, "look")
        assert (msg["id"], msg["yaw"], msg["pitch"]) == (a_id, 0.5, -0.2)
        assert not any(m["type"] == "look" for m in drain(a))            # not echoed back


def test_look_is_clamped_and_validated(client):
    with ExitStack() as sa, ExitStack() as sb:
        a, b, a_id, b_id, game, _ = start(client, sa, sb)
        a.send_json({"type": "look", "yaw": 9, "pitch": -9})
        msg = recv(b, "look")
        assert (msg["yaw"], msg["pitch"]) == (1.0, -0.6)
        a.send_json({"type": "look", "yaw": "left", "pitch": 0})
        assert recv(a, "error")


def test_look_needs_a_game(client):
    with client.websocket_connect("/ws") as a:
        signup(a)
        a.send_json({"type": "look", "yaw": 0.1, "pitch": 0})
        assert "not in a game" in recv(a, "error")["message"]


# ── leaderboard ──────────────────────────────────────────────────────────

def test_leaderboard_reply_includes_your_own_row(client):
    with client.websocket_connect("/ws") as ws:
        aid, _, _ = signup(ws)
        ws.send_json({"type": "leaderboard", "board": "wins", "scope": "friends"})
        msg = recv(ws, "leaderboard")
        assert (msg["board"], msg["scope"], msg["me"]["id"]) == ("wins", "friends", aid)
        assert [r["id"] for r in msg["rows"]] == [aid]


# ── admin ────────────────────────────────────────────────────────────────

def test_admin_gives_coins_and_the_player_sees_them(client, monkeypatch):
    with client.websocket_connect("/ws") as a, client.websocket_connect("/ws") as b:
        _, _, admin = signup(a)
        _, _, player = signup(b)
        drain(b)
        monkeypatch.setattr(main.accounts, "admins", {admin})
        a.send_json({"type": "admin_give_coins", "username": player, "amount": 10000})
        assert any(m["type"] == "notice" and "10,000" in m["message"] for m in drain(a))
        assert [m for m in drain(b) if m["type"] == "profile"][-1]["profile"]["coins"] == 10200


def test_only_admins_can_give_coins(client):
    with client.websocket_connect("/ws") as a:
        _, _, me = signup(a)
        a.send_json({"type": "admin_give_coins", "username": me, "amount": 5})
        assert "admin" in recv(a, "error")["message"].lower()


# ── rate limits ──────────────────────────────────────────────────────────

def test_wrong_passwords_lock_the_username_on_any_connection(client, monkeypatch):
    monkeypatch.setattr(main, "failed_signins", Limiter(3, 600))
    with client.websocket_connect("/ws") as ws:
        _, _, name = signup(ws)
    for _ in range(3):
        with client.websocket_connect("/ws") as ws:
            ws.send_json({"type": "signin", "username": name, "password": "wrong-pass"})
            recv(ws, "auth_error")
    with client.websocket_connect("/ws") as ws:          # even the right password waits now
        ws.send_json({"type": "signin", "username": name, "password": "password1"})
        assert "too many" in recv(ws, "auth_error")["message"].lower()


def test_new_accounts_per_address_are_limited(client, monkeypatch):
    monkeypatch.setattr(main, "signups_per_address", Limiter(2, 3600))
    with client.websocket_connect("/ws") as a, client.websocket_connect("/ws") as b,             client.websocket_connect("/ws") as c:
        signup(a)
        signup(b)
        c.send_json({"type": "signup", "username": f"@t_extra{next(_seq)}", "password": "password1",
                     "character": "char:m-Casual"})
        assert "too many" in recv(c, "auth_error")["message"].lower()


def test_flooding_one_connection_is_slowed_down(client, monkeypatch):
    monkeypatch.setattr(main, "messages_per_socket", Limiter(5, 60))
    with client.websocket_connect("/ws") as ws:
        signup(ws)
        for _ in range(6):
            ws.send_json({"type": "leaderboard", "board": "rp", "scope": "friends"})
        assert "slow down" in recv(ws, "error")["message"].lower()


# ── chat ─────────────────────────────────────────────────────────────────

def test_global_chat_reaches_everyone_and_is_replayed(client):
    with client.websocket_connect("/ws") as a, client.websocket_connect("/ws") as b:
        signup(a, "Ana")
        signup(b)
        a.send_json({"type": "gchat", "text": "  hello   world "})
        assert recv(b, "gchat")["message"]["text"] == "hello world"
        with client.websocket_connect("/ws") as c:
            signup(c)
            history = recv(c, "gchat_history")["messages"]
            assert history[-1]["text"] == "hello world" and history[-1]["from"]["display_name"] == "Ana"


# ── lobby emotes ─────────────────────────────────────────────────────────

def test_emote_plays_for_the_whole_party(client):
    with client.websocket_connect("/ws") as a, client.websocket_connect("/ws") as b:
        a_id, _, _ = signup(a)
        b_id, _, b_name = signup(b)
        befriend(a, b, a_id, b_name)
        party_up(a, b, b_id)
        a.send_json({"type": "emote", "emote": "wave"})
        assert recv(b, "emote") == {"type": "emote", "id": a_id, "emote": "wave"}
        assert recv(a, "emote")["id"] == a_id                            # you see your own too


def test_party_emotes_need_their_pack(client):
    with client.websocket_connect("/ws") as a:
        a_id, _, _ = signup(a)
        assert {"id": "dance", "pack": "emotes:party"} in recv(a, "catalog")["emotes"]
        a.send_json({"type": "emote", "emote": "dance"})
        assert "Party emotes" in recv(a, "error")["message"]
        main.accounts.accounts[a_id]["inventory"].append("emotes:party")   # the First game milestone
        a.send_json({"type": "emote", "emote": "dance"})
        assert recv(a, "emote")["emote"] == "dance"


def test_shrug_is_a_basic_emote_everyone_has(client):
    with client.websocket_connect("/ws") as a:
        signup(a)
        assert {"id": "shrug", "pack": "emotes:basic"} in recv(a, "catalog")["emotes"]
        a.send_json({"type": "emote", "emote": "shrug"})
        assert recv(a, "emote")["emote"] == "shrug"


def test_unknown_emotes_and_floods_are_refused(client):
    with client.websocket_connect("/ws") as a:
        signup(a)
        a.send_json({"type": "emote", "emote": ["wave"]})
        assert recv(a, "error")["message"] == "Unknown emote."
        a.send_json({"type": "emote", "emote": "wave"})
        a.send_json({"type": "emote", "emote": "cheer"})                 # inside EMOTE_GAP_S: dropped
        assert [m["emote"] for m in drain(a) if m["type"] == "emote"] == ["wave"]


# ── Add friend search ────────────────────────────────────────────────────

def test_user_search_finds_players_by_name_with_public_fields_only(client):
    with client.websocket_connect("/ws") as a, client.websocket_connect("/ws") as b:
        a_id, _, _ = signup(a)
        b_id, _, b_name = signup(b, "Gamer Bo")
        a.send_json({"type": "user_search", "q": "gamer"})
        res = recv(a, "user_results")
        assert res["q"] == "gamer" and [u["id"] for u in res["users"]] == [b_id]
        assert set(res["users"][0]) == {"id", "username", "display_name", "character", "status", "rank_label"}
        assert res["users"][0]["status"] == "online"
        a.send_json({"type": "user_search", "q": ""})                   # empty box: suggestions, never yourself
        ids = [u["id"] for u in recv(a, "user_results")["users"]]
        assert b_id in ids and a_id not in ids


def test_user_search_is_rate_limited(client, monkeypatch):
    monkeypatch.setattr(main, "searches_per_account", Limiter(2, 60))
    with client.websocket_connect("/ws") as a:
        signup(a)
        for _ in range(2):
            a.send_json({"type": "user_search", "q": "x"})
            recv(a, "user_results")
        a.send_json({"type": "user_search", "q": "x"})
        assert "too fast" in recv(a, "error")["message"]


def test_server_rank_lists_every_player_first_to_last(client):
    with client.websocket_connect("/ws") as a, client.websocket_connect("/ws") as b:
        a_id, _, _ = signup(a)
        b_id, _, _ = signup(b)
        main.accounts.accounts[b_id]["rp"]["uno"] = 120          # b out-ranks a; a never played
        a.send_json({"type": "leaderboard", "board": "rp", "scope": "server"})
        msg = recv(a, "leaderboard")
        ids = [r["id"] for r in msg["rows"]]
        assert len(ids) == len(main.accounts.accounts) and ids.index(b_id) < ids.index(a_id)
        assert [r["place"] for r in msg["rows"]] == list(range(1, len(ids) + 1))
        assert msg["me"]["id"] == a_id and msg["me"]["place"] == ids.index(a_id) + 1


# ── Raja Mantri Chor Sipahi ──────────────────────────────────────────────

def roles_state(ws, until=lambda st: True):
    while True:
        st = recv(ws, "roles_state")["state"]
        if until(st):
            return st


def start_roles(client, stack, friends=0):
    """A party (leader + `friends`) starts a roles table; returns sockets, ids and the match."""
    socks = [stack.enter_context(client.websocket_connect("/ws")) for _ in range(friends + 1)]
    ids = [signup(ws)[0] for ws in socks]
    for ws, aid in zip(socks[1:], ids[1:]):
        befriend(socks[0], ws, ids[0], main.accounts.accounts[aid]["username"])
        party_up(socks[0], ws, aid)
    socks[0].send_json({"type": "party_set", "game": "roles"})
    socks[0].send_json({"type": "party_start"})
    states = [roles_state(ws) for ws in socks]
    return socks, ids, states, main._roles_of(ids[0])


def test_roles_solo_table_fills_with_bots_and_hides_roles(client):
    with ExitStack() as stack:
        (a,), (a_id,), (st,), match = start_roles(client, stack)
        assert st["phase"] == "pick" and st["round"] == 1 and st["me"] == a_id
        assert sum(s["bot"] for s in st["seats"]) == 3 and st["ms_left"] is None   # no timer: you must pick
        match.due.clear()                                    # the bots wait, so the test drives every pick
        for s in match.seats:
            if s.bot:
                match.pick(s.id, next(i for i in range(4) if i not in match.taken))
        a.send_json({"type": "roles_pick", "slot": next(i for i in range(4) if i not in match.taken)})
        st = roles_state(a, lambda x: x["phase"] == "raja")
        seen = {s["id"]: s["role"] for s in st["seats"]}
        assert seen[a_id] == match.role[a_id]
        assert all(r in (None, "raja") for sid, r in seen.items() if sid != a_id)   # only the Raja is public
        a.send_json({"type": "roles_guess", "target": a_id})
        assert "isn't time" in recv(a, "error")["message"]


def test_roles_mantri_fires_at_the_chor_and_the_match_pays_out(client, monkeypatch):
    for phase in ("raja", "mantri", "result"):
        monkeypatch.setitem(core.roles.TIMES, phase, 0.05)
    with ExitStack() as stack:
        (a,), (a_id,), _, match = start_roles(client, stack)
        match.rounds = 1
        match.due.clear()
        mantri_slot = match.slips.index("mantri")
        for s in match.seats:
            if s.bot:
                match.pick(s.id, next(i for i in range(4) if i not in match.taken and i != mantri_slot))
        coins = main.accounts.profile(a_id)["coins"]
        a.send_json({"type": "roles_pick", "slot": mantri_slot})
        st = roles_state(a, lambda x: x["phase"] == "guess")
        chor = match.holder("chor")
        assert set(st["suspects"]) == {chor, match.holder("sipahi")}
        a.send_json({"type": "roles_aim", "target": chor})
        assert roles_state(a)["aim"] == chor                 # everyone sees where the blaster points
        a.send_json({"type": "roles_guess", "target": chor})
        st = roles_state(a, lambda x: x["phase"] == "result")
        assert st["last"]["correct"] and st["last"]["points"][a_id] == 800
        st = roles_state(a, lambda x: x["phase"] == "finished")
        assert st["standings"][0]["id"] == match.holder("raja") and st["reward"]["coins"] > 0
        assert recv(a, "game_rewards")["rewards"] == st["reward"]
        assert main.accounts.profile(a_id)["coins"] == coins + st["reward"]["coins"]


def route_state(ws, until=lambda st: True):
    while True:
        st = recv(ws, "route_state")["state"]
        if until(st):
            return st


def start_route(client, stack, friends=0):
    """A party (leader + `friends`) starts an Ang Mang Chok Chang table."""
    socks = [stack.enter_context(client.websocket_connect("/ws")) for _ in range(friends + 1)]
    ids = [signup(ws)[0] for ws in socks]
    for ws, aid in zip(socks[1:], ids[1:]):
        befriend(socks[0], ws, ids[0], main.accounts.accounts[aid]["username"])
        party_up(socks[0], ws, aid)
    socks[0].send_json({"type": "party_set", "game": "route"})
    socks[0].send_json({"type": "party_start"})
    states = [route_state(ws) for ws in socks]
    return socks, ids, states, main._route_of(ids[0])


def test_route_match_starts_and_pushes_personal_state(client):
    with ExitStack() as stack:
        (a,), (a_id,), (st,), match = start_route(client, stack)
        assert len(st["seats"]) == 4 and sum(s["bot"] for s in st["seats"]) == 3
        assert st["seats"][st["you"]]["id"] == a_id and st["rules"] == "traditional"


def test_route_throw_and_move_round_trip(client):
    with ExitStack() as stack:
        (a,), (a_id,), _, match = start_route(client, stack)
        match.pauses = False
        match.turn, match.phase, match.owed, match.afk = match.index_of(a_id), "throw", 1, False
        match.deadline = float("inf")
        p = match.pawns[a_id][0]
        p.state, p.index = "active", 2                          # every throw has a legal move
        a.send_json({"type": "route_throw"})
        st = route_state(a, lambda x: x["moves"])
        a.send_json({"type": "route_move", "pawn": 9})
        assert "can't move" in recv(a, "error")["message"]
        a.send_json({"type": "route_move", "pawn": st["moves"][0]["pawn"]})
        route_state(a, lambda x: any(e["kind"] in ("moved", "entered") and e["seat"] == a_id for e in x["events"]))


def test_route_leaving_and_the_last_human_closes_the_table(client):
    with ExitStack() as stack:
        (a, b), (a_id, b_id), _, match = start_route(client, stack, friends=1)
        b.send_json({"type": "route_leave"})
        recv(b, "route_left")
        assert route_state(a, lambda x: any(s["left"] for s in x["seats"]))
        a.send_json({"type": "route_leave"})
        recv(a, "route_left")
        assert match.id not in main.route_matches


def test_route_finished_player_who_leaves_sees_their_coins(client):
    with ExitStack() as stack:
        (a,), (a_id,), _, match = start_route(client, stack)
        match.places.append(a_id)                               # their place is fixed (as on finishing)
        a.send_json({"type": "route_leave"})
        recv(a, "route_left")
        assert any(m["type"] == "profile" for m in drain(a))    # the lobby balance updates right away


def test_route_seat_survives_a_reconnect(client):
    with ExitStack() as stack:
        a = stack.enter_context(client.websocket_connect("/ws"))
        a_id, token, _ = signup(a)
        a.send_json({"type": "party_set", "game": "route"})
        a.send_json({"type": "party_start"})
        route_state(a)
    with client.websocket_connect("/ws") as a2:              # back within the grace period
        a2.send_json({"type": "auth", "token": token})
        st = route_state(a2)
        assert st["seats"][st["you"]]["id"] == a_id and main._route_of(a_id) is not None


def test_roles_table_chat_and_leaving(client):
    with ExitStack() as stack:
        (a, b), (a_id, b_id), (sa, sb), match = start_roles(client, stack, friends=1)
        assert sa["id"] == sb["id"] and sum(s["bot"] for s in sa["seats"]) == 2
        b.send_json({"type": "chat", "text": "not me!"})
        assert recv(a, "chat")["text"] == "not me!"
        b.send_json({"type": "roles_leave"})
        recv(b, "roles_left")
        assert roles_state(a, lambda x: any(s["left"] for s in x["seats"]))   # b's seat now plays itself
        a.send_json({"type": "roles_leave"})
        recv(a, "roles_left")
        assert match.id not in main.role_matches                              # last human out closes it

