"""
WebSocket-level tests for main.py: turn clock, disconnect grace, leaving,
reconnecting. Run from backend/:  python -m pytest tests/ -v
"""
import os
import sys
import time
from contextlib import ExitStack

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient

import main


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main, "GRACE_SECONDS", 0.3)
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


def start(client, a_stack, b_stack, turn_seconds=None):
    a = a_stack.enter_context(client.websocket_connect("/ws"))
    b = b_stack.enter_context(client.websocket_connect("/ws"))
    a.send_json({"type": "create_room", "player_name": "A"})
    joined = recv(a, "joined")
    b.send_json({"type": "join_room", "room_id": joined["room_id"], "player_name": "B"})
    b_id = recv(b, "joined")["player_id"]
    game = main.room_manager.get_room(joined["room_id"])
    if turn_seconds:
        game.settings["turn_seconds"] = turn_seconds
    a.send_json({"type": "start_game"})
    recv(a, "game_state")
    recv(b, "game_state")
    return a, b, joined["player_id"], b_id, game


def test_uno_call_does_not_reset_turn_clock(client):
    with ExitStack() as sa, ExitStack() as sb:
        a, b, a_id, b_id, game = start(client, sa, sb)
        current = game.players[game.current_player_index].id
        caller_ws, caller_id = (b, b_id) if current == a_id else (a, a_id)
        caller = game._find_player(caller_id)
        caller.hand = caller.hand[:1]
        deadline = game.turn_deadline_ms
        time.sleep(0.02)
        caller_ws.send_json({"type": "call_uno"})
        state = recv(caller_ws, "game_state")["state"]
        assert state["turn_deadline"] == deadline


def test_state_reports_time_left_on_turn(client):
    with ExitStack() as sa, ExitStack() as sb:
        a, b, a_id, b_id, game = start(client, sa, sb)
        state = game.get_state_for_player(a_id)
        assert 0 < state["turn_ms_left"] <= 30_000


def test_turn_timeout_reaches_clients(client):
    with ExitStack() as sa, ExitStack() as sb:
        a, b, *_ = start(client, sa, sb, turn_seconds=0.2)
        time.sleep(0.35)
        states = [m["state"] for m in drain(a) if m["type"] == "game_state"]
        assert any("ran out of time" in s["last_action"] for s in states)


def test_dropped_player_keeps_seat_during_grace(client):
    with ExitStack() as sa:
        sb = ExitStack()
        a, b, a_id, b_id, game = start(client, sa, sb)
        sb.close()  # B's socket drops (refresh / network blip)
        time.sleep(0.1)
        assert game.status.value == "playing"
        assert game._find_player(b_id).is_connected
        time.sleep(0.5)  # grace (0.3s) runs out
        assert game.status.value == "finished"
        assert game.winner_id == a_id


def test_reconnect_within_grace_keeps_game_going(client):
    with ExitStack() as sa:
        sb = ExitStack()
        a, b, a_id, b_id, game = start(client, sa, sb)
        sb.close()
        with client.websocket_connect("/ws") as b2:
            b2.send_json({"type": "join_room", "room_id": game.room_id,
                          "player_name": "B", "player_id": b_id})
            recv(b2, "joined")
            time.sleep(0.5)  # well past the grace window
            assert game.status.value == "playing"
            assert game._find_player(b_id).is_connected


def test_reconnect_to_finished_game_gets_game_state(client):
    with ExitStack() as sa:
        sb = ExitStack()
        a, b, a_id, b_id, game = start(client, sa, sb)
        sb.close()
        time.sleep(0.5)  # grace expires → A wins by default
        assert game.status.value == "finished"
        with client.websocket_connect("/ws") as b2:
            b2.send_json({"type": "join_room", "room_id": game.room_id,
                          "player_name": "B", "player_id": b_id})
            msgs = drain(b2)
            assert any(m["type"] == "game_state" and m["state"]["status"] == "finished"
                       for m in msgs)


def test_leaving_on_your_turn_updates_the_table(client):
    with ExitStack() as sa, ExitStack() as sb:
        a, b, a_id, b_id, game = start(client, sa, sb)
        current = game.players[game.current_player_index].id
        leaver, stayer = (a, b) if current == a_id else (b, a)
        leaver.send_json({"type": "leave_room"})
        drain(leaver)  # leave handler (and its broadcasts) has finished
        states = [m["state"] for m in drain(stayer) if m["type"] == "game_state"]
        assert states and states[-1]["status"] == "finished"


def test_player_name_is_capped(client):
    with client.websocket_connect("/ws") as a:
        a.send_json({"type": "create_room", "player_name": "x" * 500})
        players = recv(a, "joined")["room_state"]["players"]
        assert len(players[0]["name"]) <= 20
