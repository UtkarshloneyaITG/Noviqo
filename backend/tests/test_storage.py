"""
Persistence tests against an in-memory stand-in for the MongoDB collections
(the real database is never touched — see conftest.py).
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient

import main
from core.accounts import Accounts
from core.channel_manager import RoomManager
from core.member import Player
from core.session import GameState, GameStatus
from storage import Storage


class FakeCollection:
    """The handful of async collection methods Storage uses."""

    def __init__(self, docs=None, fail_times=0):
        self.docs = dict(docs or {})
        self.inserted = []
        self.writes = 0
        self.fail_times = fail_times

    def _maybe_fail(self):
        if self.fail_times:
            self.fail_times -= 1
            raise ConnectionError("network blip")

    async def replace_one(self, flt, doc, upsert=False):
        self._maybe_fail()
        self.writes += 1
        self.docs[flt["_id"]] = doc

    async def delete_one(self, flt):
        self._maybe_fail()
        self.docs.pop(flt["_id"], None)

    async def insert_one(self, doc):
        self._maybe_fail()
        self.inserted.append(doc)

    def find(self, flt=None):
        async def gen():
            for d in list(self.docs.values()):
                yield d
        return gen()


def live_game():
    rm = RoomManager()
    rid = rm.create_room()
    for name in ("A", "B"):
        rm.add_player_to_room(rid, Player(name=name))
    game = rm.get_room(rid)
    game.start_game()
    return rm, game


def run(coro):
    return asyncio.run(coro)


def test_marked_room_is_saved_once():
    rm, game = live_game()
    st = Storage(FakeCollection(), FakeCollection())
    st.mark(game)
    st.mark(game)  # rapid changes coalesce
    run(st.flush(rm))
    assert st.channels.writes == 1
    assert st.channels.docs[game.room_id]["room_id"] == game.room_id
    run(st.flush(rm))  # nothing new marked
    assert st.channels.writes == 1


def test_deleted_room_is_removed_from_db():
    rm, game = live_game()
    st = Storage(FakeCollection({game.room_id: {"_id": game.room_id}}), FakeCollection())
    rm.delete_room(game.room_id)
    st.mark(game)
    run(st.flush(rm))
    assert game.room_id not in st.channels.docs


def test_finished_game_logged_to_history_once():
    rm, game = live_game()
    st = Storage(FakeCollection(), FakeCollection())
    game.players[1].is_connected = False
    game._auto_skip_offline()  # A wins by default
    assert game.status == GameStatus.FINISHED
    st.mark(game)
    run(st.flush(rm))
    st.mark(game)
    run(st.flush(rm))
    assert len(st.history.inserted) == 1
    rec = st.history.inserted[0]
    assert rec["winner_id"] == game.players[0].id
    assert [p["rank"] for p in rec["placements"]] == [1, 2]
    assert st.channels.docs[game.room_id]["history_logged"] is True


def test_failed_write_is_retried_next_flush():
    rm, game = live_game()
    st = Storage(FakeCollection(fail_times=1), FakeCollection())
    st.mark(game)
    run(st.flush(rm))  # network blip
    assert game.room_id not in st.channels.docs
    run(st.flush(rm))
    assert game.room_id in st.channels.docs


def test_load_all_rebuilds_games():
    rm, game = live_game()
    st = Storage(FakeCollection({game.room_id: {"_id": game.room_id, **game.to_doc()}}), FakeCollection())
    [restored] = run(st.load_all())
    assert isinstance(restored, GameState)
    assert restored.room_id == game.room_id
    assert [c.id for c in restored.players[0].hand] == [c.id for c in game.players[0].hand]


def test_accounts_sessions_and_chat_flush_and_reload():
    acc = Accounts()
    a, token = acc.signup("@flusher", "password1", None, "char:m-Casual")
    cols = {k: FakeCollection() for k in ("accounts", "sessions", "chat")}
    st = Storage(FakeCollection(), FakeCollection(), **cols)
    st.mark_chat([{"id": "m1", "text": "hi"}])
    run(st.flush(RoomManager(), acc))
    assert a["id"] in cols["accounts"].docs and len(cols["sessions"].docs) == 1
    assert "expire_at" in next(iter(cols["sessions"].docs.values()))      # TTL index field
    docs, sessions, chat = run(st.load_accounts())
    fresh = Accounts()
    fresh.load(docs, sessions)
    assert fresh.auth(token)["id"] == a["id"] and chat == [{"id": "m1", "text": "hi"}]
    acc.signout(token)
    run(st.flush(RoomManager(), acc))
    assert cols["sessions"].docs == {}


def test_server_restores_accounts_and_games_on_startup(monkeypatch):
    acc = Accounts()
    a, token = acc.signup("@restore_a", "password1", None, "char:m-Casual")
    b, _ = acc.signup("@restore_b", "password1", None, "char:w-Casual")
    rm = RoomManager()
    rid = rm.create_room()
    for x in (a, b):
        rm.add_player_to_room(rid, Player(name=x["display_name"], id=x["id"]))
    game = rm.get_room(rid)
    game.start_game()
    me = game._find_player(a["id"])
    cols = {
        "accounts": FakeCollection({i: acc.account_doc(i) for i in acc.dirty_accounts}),
        "sessions": FakeCollection({k: acc.session_doc(k) for k in acc.dirty_sessions}),
        "chat": FakeCollection(),
    }
    channels = FakeCollection({rid: {"_id": rid, **game.to_doc()}})
    monkeypatch.setattr(main, "_make_storage", lambda: Storage(channels, FakeCollection(), **cols))
    monkeypatch.setattr(main, "accounts", Accounts())          # empty, as after a restart
    monkeypatch.setattr(main, "room_manager", RoomManager())

    with TestClient(main.app) as client:
        with client.websocket_connect("/ws") as ws:
            ws.send_json({"type": "auth", "token": token})
            states = []
            ws.send_json({"type": "ping"})  # its error reply marks the end
            while (msg := ws.receive_json())["type"] != "error":
                if msg["type"] == "game_state":
                    states.append(msg["state"])
            assert states, "signing back in after a restart gave no game_state"
            assert states[-1]["my_hand"] == [c.to_dict() for c in me.hand]
