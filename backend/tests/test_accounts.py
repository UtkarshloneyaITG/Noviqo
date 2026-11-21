"""
Accounts, catalog maths, friends and per-game rewards (pure logic, no DB).
Run from backend/:  python -m pytest tests/ -v
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from core import catalog
from core.accounts import Accounts, AccountError

DAY = 24 * 3600 * 1000


class Clock:
    def __init__(self):
        self.ms = 1_800_000_000_000

    def __call__(self):
        return self.ms


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def acc(clock):
    return Accounts(now_ms=clock)


def new(acc, name="@alex", pw="hunter222", **kw):
    return acc.signup(name, pw, kw.get("display_name"), kw.get("character", "char:m-Casual"))


# ── catalog maths ────────────────────────────────────────────────────────

class TestRankMaths:
    def test_four_player_points(self):
        assert [catalog.rp_delta(r, 4) for r in (1, 2, 3, 4)] == [30, 10, -5, -15]

    def test_two_player_points(self):
        assert [catalog.rp_delta(r, 2) for r in (1, 2)] == [30, -15]

    def test_labels(self):
        assert catalog.rank_info(0)["label"] == "Bronze III"
        assert catalog.rank_info(250)["label"] == "Bronze I"
        assert catalog.rank_info(650)["label"] == "Gold III"
        assert catalog.rank_info(899)["label"] == "Gold I"
        assert catalog.rank_info(1500)["label"] == "Master"
        assert catalog.rank_info(1500)["next_label"] is None

    def test_progress_within_division(self):
        info = catalog.rank_info(740)
        assert (info["label"], info["into"], info["span"], info["next_label"]) == ("Gold II", 40, 100, "Gold I")

    def test_coins_by_placement(self):
        assert [catalog.coins_for(r) for r in (1, 2, 3, 4, 7)] == [50, 30, 20, 10, 10]

    def test_catalog_is_consistent(self):
        ids = {i["id"] for i in catalog.ITEMS}
        assert len(ids) == len(catalog.ITEMS)
        assert sum(1 for i in catalog.ITEMS if i["kind"] == "character") == 21
        for m in catalog.MILESTONES:
            assert m["reward"] in ids
        for i in catalog.ITEMS:
            # every item is exactly one of: starter, milestone reward, shop item
            assert [i["starter"], i["milestone"] is not None, i["price"] is not None].count(True) == 1, i["id"]


# ── sign up / sign in / sessions ─────────────────────────────────────────

class TestSignup:
    def test_signup_returns_profile_and_token(self, acc):
        a, token = new(acc, display_name="Alex")
        p = acc.profile(a["id"])
        assert p["username"] == "@alex" and p["display_name"] == "Alex"
        assert p["coins"] == 200
        assert p["equipped"] == {"character": "char:m-Casual", "card_back": "back:classic", "felt": "felt:green",
                                 "lobby": "lobby:rooftop", "entry": "entry:classic"}
        assert "char:w-Worker" in p["inventory"] and "emotes:basic" in p["inventory"]
        assert acc.auth(token)["id"] == a["id"]

    def test_display_name_defaults_to_username(self, acc):
        a, _ = new(acc, name="@Night_Owl")
        assert acc.profile(a["id"])["username"] == "@night_owl"
        assert acc.profile(a["id"])["display_name"] == "night_owl"

    @pytest.mark.parametrize("bad", ["alex", "@al", "@" + "a" * 21, "@al ex", "@alex!", ""])
    def test_bad_usernames_rejected(self, acc, bad):
        with pytest.raises(AccountError):
            new(acc, name=bad)

    def test_short_password_rejected(self, acc):
        with pytest.raises(AccountError):
            new(acc, pw="short")

    def test_username_unique_ignoring_case(self, acc):
        new(acc, name="@alex")
        with pytest.raises(AccountError):
            new(acc, name="@ALEX")

    def test_character_must_be_a_starter(self, acc):
        with pytest.raises(AccountError):
            new(acc, character="char:m-King")

    def test_password_not_stored_in_plain_text(self, acc):
        a, _ = new(acc, pw="hunter222")
        assert "hunter222" not in repr(acc.accounts[a["id"]])


class TestSignin:
    def test_signin_with_right_password(self, acc):
        a, _ = new(acc)
        b, token = acc.signin("@ALEX", "hunter222")
        assert b["id"] == a["id"] and acc.auth(token)["id"] == a["id"]

    def test_wrong_password_rejected(self, acc):
        new(acc)
        with pytest.raises(AccountError):
            acc.signin("@alex", "nope-nope")

    def test_unknown_user_rejected(self, acc):
        with pytest.raises(AccountError):
            acc.signin("@ghost", "whatever1")


class TestSessions:
    def test_session_expires_after_14_days(self, acc, clock):
        _, token = new(acc)
        clock.ms += 14 * DAY - 1000
        assert acc.auth(token) is not None
        clock.ms += 2000
        assert acc.auth(token) is None

    def test_using_a_session_does_not_extend_it(self, acc, clock):
        _, token = new(acc)
        clock.ms += 10 * DAY
        acc.auth(token)
        clock.ms += 5 * DAY
        assert acc.auth(token) is None

    def test_signout_ends_session(self, acc):
        _, token = new(acc)
        acc.signout(token)
        assert acc.auth(token) is None

    def test_garbage_token(self, acc):
        assert acc.auth("not-a-token") is None and acc.auth(None) is None


# ── profile, shop, equip ─────────────────────────────────────────────────

class TestProfile:
    def test_change_display_name(self, acc):
        a, _ = new(acc)
        acc.set_display_name(a["id"], "  Lexi  ")
        assert acc.profile(a["id"])["display_name"] == "Lexi"

    @pytest.mark.parametrize("bad", ["", "   ", "x" * 21])
    def test_bad_display_names_rejected(self, acc, bad):
        a, _ = new(acc)
        with pytest.raises(AccountError):
            acc.set_display_name(a["id"], bad)

    def test_buy_deducts_coins_and_adds_item(self, acc):
        a, _ = new(acc)
        acc.buy(a["id"], "back:crimson")
        p = acc.profile(a["id"])
        assert p["coins"] == 50 and "back:crimson" in p["inventory"]

    def test_cannot_afford(self, acc):
        a, _ = new(acc)
        with pytest.raises(AccountError):
            acc.buy(a["id"], "char:m-Swat")  # 600

    def test_cannot_buy_milestone_items_or_owned_items(self, acc):
        a, _ = new(acc)
        with pytest.raises(AccountError):
            acc.buy(a["id"], "back:gold")
        acc.buy(a["id"], "back:ocean")
        with pytest.raises(AccountError):
            acc.buy(a["id"], "back:ocean")

    def test_equip_owned_item_by_slot(self, acc):
        a, _ = new(acc)
        acc.equip(a["id"], "char:w-Worker")
        acc.buy(a["id"], "back:ocean")
        acc.equip(a["id"], "back:ocean")
        eq = acc.profile(a["id"])["equipped"]
        assert eq["character"] == "char:w-Worker" and eq["card_back"] == "back:ocean"

    def test_cannot_equip_unowned(self, acc):
        a, _ = new(acc)
        with pytest.raises(AccountError):
            acc.equip(a["id"], "felt:violet")


# ── friends ──────────────────────────────────────────────────────────────

class TestFriends:
    def test_request_then_accept(self, acc):
        a, _ = new(acc, name="@alex")
        b, _ = new(acc, name="@bea")
        acc.friend_request(a["id"], "@BEA")
        assert acc.accounts[b["id"]]["incoming"] == [a["id"]]
        acc.friend_accept(b["id"], a["id"])
        assert acc.are_friends(a["id"], b["id"])
        assert acc.accounts[a["id"]]["outgoing"] == [] and acc.accounts[b["id"]]["incoming"] == []

    def test_crossed_requests_become_friends(self, acc):
        a, _ = new(acc, name="@alex")
        b, _ = new(acc, name="@bea")
        acc.friend_request(a["id"], "@bea")
        acc.friend_request(b["id"], "@alex")
        assert acc.are_friends(a["id"], b["id"])

    def test_decline_and_remove(self, acc):
        a, _ = new(acc, name="@alex")
        b, _ = new(acc, name="@bea")
        acc.friend_request(a["id"], "@bea")
        acc.friend_decline(b["id"], a["id"])
        assert not acc.are_friends(a["id"], b["id"]) and acc.accounts[a["id"]]["outgoing"] == []
        acc.friend_request(a["id"], "@bea")
        acc.friend_accept(b["id"], a["id"])
        acc.friend_remove(a["id"], b["id"])
        assert not acc.are_friends(a["id"], b["id"])

    @pytest.mark.parametrize("target", ["@alex", "@nobody"])
    def test_bad_requests(self, acc, target):
        new(acc, name="@alex")
        with pytest.raises(AccountError):
            acc.friend_request(acc.find_username("@alex")["id"], target)


# ── rewards after a game ─────────────────────────────────────────────────

class TestRewards:
    def test_casual_win_pays_coins_and_unlocks_first_milestones(self, acc):
        a, _ = new(acc)
        r = acc.record_game(a["id"], placement=1, players=4, ranked=False, left_early=False)
        assert r["coins"] == 50 and r["rp"] == 0 and r["placement"] == 1
        assert set(r["unlocked"]) == {"emotes:party", "back:gold"}       # first game + first win
        p = acc.profile(a["id"])
        assert p["coins"] == 250 and p["stats"]["games"] == 1 and p["stats"]["wins"] == 1
        assert {"emotes:party", "back:gold"} <= set(p["inventory"])

    def test_ranked_points_and_floor_at_zero(self, acc):
        a, _ = new(acc)
        r = acc.record_game(a["id"], placement=4, players=4, ranked=True, left_early=False)
        assert r["rp"] == 0 and acc.profile(a["id"])["rank"]["rp"] == 0     # can't go below 0
        r = acc.record_game(a["id"], placement=1, players=4, ranked=True, left_early=False)
        assert r["rp"] == 30 and r["rank_label"] == "Bronze III"
        assert "char:w-Witch" in r["unlocked"]                              # first ranked win

    def test_leaving_early_pays_nothing_and_counts_last(self, acc):
        a, _ = new(acc)
        acc.accounts[a["id"]]["rp"]["uno"] = 100
        r = acc.record_game(a["id"], placement=1, players=4, ranked=True, left_early=True)
        assert r["coins"] == 0 and r["rp"] == -15 and acc.profile(a["id"])["rank"]["rp"] == 85

    def test_milestone_progress_in_profile(self, acc):
        a, _ = new(acc)
        for _ in range(3):
            acc.record_game(a["id"], placement=2, players=3, ranked=False, left_early=False)
        ms = {m["id"]: m for m in acc.profile(a["id"])["milestones"]}
        assert ms["games_10"]["progress"] == 3 and not ms["games_10"]["unlocked"]
        assert ms["first_game"]["unlocked"] and not ms["first_win"]["unlocked"]

    def test_unlock_happens_once(self, acc):
        a, _ = new(acc)
        acc.record_game(a["id"], placement=1, players=2, ranked=False, left_early=False)
        r = acc.record_game(a["id"], placement=1, players=2, ranked=False, left_early=False)
        assert r["unlocked"] == []


# ── lobby backgrounds ────────────────────────────────────────────────────

class TestLobbyBackgrounds:
    def test_backgrounds_rooftop_free_rest_priced(self):
        lobbies = {i["id"]: i for i in catalog.ITEMS if i["kind"] == "lobby"}
        assert set(lobbies) == {"lobby:rooftop", "lobby:synthwave", "lobby:beach", "lobby:aurora", "lobby:station", "lobby:sakura"}
        assert lobbies["lobby:rooftop"]["starter"]
        assert all(i["price"] for k, i in lobbies.items() if k != "lobby:rooftop")

    def test_new_accounts_own_and_wear_the_rooftop(self, acc):
        a, _ = new(acc)
        p = acc.profile(a["id"])
        assert "lobby:rooftop" in p["inventory"] and p["equipped"]["lobby"] == "lobby:rooftop"

    def test_buy_and_equip_a_background(self, acc):
        a, _ = new(acc)
        acc.accounts[a["id"]]["coins"] = 1000
        acc.buy(a["id"], "lobby:aurora")
        acc.equip(a["id"], "lobby:aurora")
        assert acc.profile(a["id"])["equipped"]["lobby"] == "lobby:aurora"

    def test_older_accounts_get_new_starters_and_slots_on_load(self, clock):
        old = {"_id": "x1", "id": "x1", "username": "@oldie", "display_name": "Oldie",
               "inventory": ["char:m-Casual", "back:classic", "felt:green", "emotes:basic"],
               "equipped": {"character": "char:m-Casual", "card_back": "back:classic", "felt": "felt:green"}}
        fresh = Accounts(now_ms=clock)
        fresh.load([old], [])
        p = fresh.profile("x1")
        assert "lobby:rooftop" in p["inventory"] and p["equipped"]["lobby"] == "lobby:rooftop"
        assert "x1" in fresh.dirty_accounts                   # the upgrade gets saved


# ── persistence round trip ───────────────────────────────────────────────

class TestLeaderboard:
    @staticmethod
    def player(acc, name, rp=0, wins=0, games=1):
        aid = new(acc, name)[0]["id"]
        d = acc.accounts[aid]
        d["rp"]["uno"], d["stats"]["wins"], d["stats"]["games"] = rp, wins, games
        return aid

    def test_points_board_orders_by_rank_points(self, acc):
        a = self.player(acc, "@ana", rp=120, wins=1)
        b = self.player(acc, "@bob", rp=300)
        c = self.player(acc, "@cyd", wins=9)
        rows = acc.leaderboard(a, "rp", "global")["rows"]
        assert [r["id"] for r in rows] == [b, a, c]
        assert rows[1] == {"place": 2, "id": a, "username": "@ana", "display_name": "ana",
                           "character": "char:m-Casual", "rank_label": "Bronze II", "rp": 120, "wins": 1}

    def test_wins_board_orders_by_wins(self, acc):
        a = self.player(acc, "@ana", rp=120, wins=1)
        b = self.player(acc, "@bob", rp=300)
        c = self.player(acc, "@cyd", wins=9)
        assert [r["id"] for r in acc.leaderboard(a, "wins", "global")["rows"]] == [c, a, b]

    def test_global_board_leaves_out_players_who_never_played(self, acc):
        a = self.player(acc, "@ana", wins=1)
        fresh = new(acc, "@newbie")[0]["id"]
        board = acc.leaderboard(fresh, "wins", "global")
        assert [r["id"] for r in board["rows"]] == [a]
        assert board["me"]["id"] == fresh and board["me"]["place"] is None

    def test_friends_board_is_you_and_your_friends(self, acc):
        a = self.player(acc, "@ana", wins=1)
        b = self.player(acc, "@bob", wins=2)
        self.player(acc, "@cyd", wins=5)
        acc.friend_request(a, "@bob")
        acc.friend_accept(b, a)
        assert [r["id"] for r in acc.leaderboard(a, "wins", "friends")["rows"]] == [b, a]

    def test_your_place_is_reported_when_you_are_off_the_list(self, acc):
        self.player(acc, "@ana", wins=5)
        self.player(acc, "@bob", wins=4)
        me = self.player(acc, "@cyd", wins=1)
        board = acc.leaderboard(me, "wins", "global", limit=2)
        assert len(board["rows"]) == 2 and board["me"]["place"] == 3

    def test_unknown_board_rejected(self, acc):
        a = self.player(acc, "@ana")
        with pytest.raises(AccountError):
            acc.leaderboard(a, "coins", "global")


class TestAdmin:
    def test_profile_says_who_is_an_admin(self, acc):
        ana = new(acc, "@ana")[0]["id"]
        bob = new(acc, "@bob")[0]["id"]
        acc.admins = {"@ana"}
        assert acc.profile(ana)["admin"] is True and acc.profile(bob)["admin"] is False

    def test_give_coins_adds_to_the_named_player(self, acc):
        ana = new(acc, "@ana")[0]["id"]
        before = acc.profile(ana)["coins"]
        acc.dirty_accounts.clear()
        assert acc.give_coins("@ANA", 10000) == ana
        assert acc.profile(ana)["coins"] == before + 10000
        assert ana in acc.dirty_accounts                      # saved on the next flush

    @pytest.mark.parametrize("amount", [0, -5, 1_000_001, 2.5, "10", True, None])
    def test_give_coins_rejects_bad_amounts(self, acc, amount):
        new(acc, "@ana")
        with pytest.raises(AccountError):
            acc.give_coins("@ana", amount)

    def test_give_coins_needs_a_real_player(self, acc):
        with pytest.raises(AccountError):
            acc.give_coins("@nobody", 10)


class TestEntrances:
    def test_new_players_start_with_the_classic_entrance(self, acc):
        p = new(acc, "@ana")[0]
        assert p["equipped"]["entry"] == "entry:classic" and "entry:classic" in p["inventory"]

    def test_ten_entrances_are_for_sale(self):
        assert len([i for i in catalog.ITEMS if i["kind"] == "entry" and i["price"]]) == 10

    def test_buy_and_equip_an_entrance(self, acc):
        aid = new(acc, "@ana")[0]["id"]
        acc.accounts[aid]["coins"] = 5000
        acc.buy(aid, "entry:skydrop")
        acc.equip(aid, "entry:skydrop")
        assert acc.profile(aid)["equipped"]["entry"] == "entry:skydrop"

    def test_accounts_saved_before_entrances_get_one(self, acc, clock):
        aid = new(acc, "@ana")[0]["id"]
        doc = acc.account_doc(aid)
        doc["inventory"].remove("entry:classic")
        del doc["equipped"]["entry"]
        fresh = Accounts(now_ms=clock)
        fresh.load([doc], [])
        assert fresh.profile(aid)["equipped"]["entry"] == "entry:classic"
        assert "entry:classic" in fresh.profile(aid)["inventory"] and aid in fresh.dirty_accounts


class TestPersistence:
    def test_dirty_tracking_and_reload(self, acc, clock):
        a, token = new(acc)
        assert a["id"] in acc.dirty_accounts and acc.dirty_sessions
        docs = [acc.account_doc(i) for i in acc.dirty_accounts]
        sessions = [acc.session_doc(h) for h in acc.dirty_sessions]
        fresh = Accounts(now_ms=clock)
        fresh.load(docs, sessions)
        assert fresh.auth(token)["id"] == a["id"]
        fresh.signin("@alex", "hunter222")


def uid(acc, name, **kw):
    return new(acc, name, **kw)[0]["id"]


class TestSearch:
    def test_ranks_exact_then_prefix_then_contains(self, acc):
        me = uid(acc, "@meme")
        for u in ("@endgame", "@gamith", "@game", "@gamer", "@other"):
            uid(acc, u)
        names = lambda q: [acc.accounts[i]["username"] for i in acc.search(me, q)[1]]
        assert acc.search(me, "  @GAME ")[0] == "game"
        assert names("  @GAME ") == ["@game", "@gamer", "@endgame"]
        assert names("ga") == ["@game", "@gamer", "@gamith", "@endgame"]

    def test_matches_display_names_and_never_you(self, acc):
        me = uid(acc, "@gamer_me")
        bo = uid(acc, "@bobby", display_name="Game Master")
        assert acc.search(me, "game")[1] == [bo]

    def test_caps_results_and_query_length(self, acc):
        me = uid(acc, "@meme")
        for n in range(15):
            uid(acc, f"@player{n:02d}")
        q, ids = acc.search(me, "player" + "x" * 50)
        assert len(q) == 20 and ids == []
        assert len(acc.search(me, "player")[1]) == acc.SEARCH_MAX

    def test_empty_box_suggests_strangers_online_first(self, acc):
        me = uid(acc, "@meme")
        friend, on, off = uid(acc, "@palpal"), uid(acc, "@onliner"), uid(acc, "@offline")
        acc.friend_request(me, "@palpal")
        acc.friend_accept(friend, me)
        q, ids = acc.search(me, "", online=lambda aid: aid == on)
        assert (q, ids) == ("", [on, off])
