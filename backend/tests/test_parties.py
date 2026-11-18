"""Parties: invites, join requests, leaving, kicking, ready and start rules."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from core.parties import Parties, PartyError


@pytest.fixture
def pt():
    return Parties()


def solo(pt, *ids):
    for i in ids:
        pt.ensure(i)


class TestParties:
    def test_everyone_starts_in_a_solo_party(self, pt):
        p = pt.ensure("a")
        assert p.leader_id == "a" and p.members == ["a"] and pt.ensure("a") is p

    def test_invite_and_accept(self, pt):
        solo(pt, "a", "b")
        pid = pt.invite("a", "b")
        old = pt.of("b")
        pt.accept("b", pid)
        assert pt.of("b").members == ["a", "b"] and pt.of("b") is pt.of("a")
        assert old.id not in pt.parties                 # the empty solo party is gone

    def test_accept_without_invite_rejected(self, pt):
        solo(pt, "a", "b")
        with pytest.raises(PartyError):
            pt.accept("b", pt.of("a").id)

    def test_request_and_admit(self, pt):
        solo(pt, "a", "b")
        leader = pt.request("b", "a")
        assert leader == "a"
        pt.admit("a", "b")
        assert pt.of("a").members == ["a", "b"]

    def test_only_leader_admits(self, pt):
        solo(pt, "a", "b", "c")
        pt.accept("b", pt.invite("a", "b"))
        pt.request("c", "b")
        with pytest.raises(PartyError):
            pt.admit("b", "c")

    def test_party_is_capped_at_five(self, pt):
        solo(pt, *"abcdef")
        for x in "bcde":
            pt.accept(x, pt.invite("a", x))
        with pytest.raises(PartyError):
            pt.invite("a", "f")

    def test_leave_creates_solo_party_and_hands_over_leader(self, pt):
        solo(pt, "a", "b", "c")
        for x in "bc":
            pt.accept(x, pt.invite("a", x))
        pt.leave("a")
        assert pt.of("a").members == ["a"]
        assert pt.of("b").leader_id == "b" and pt.of("b").members == ["b", "c"]

    def test_kick(self, pt):
        solo(pt, "a", "b")
        pt.accept("b", pt.invite("a", "b"))
        pt.kick("a", "b")
        assert pt.of("a").members == ["a"] and pt.of("b").members == ["b"]

    def test_ready_and_start_rules(self, pt):
        solo(pt, "a", "b")
        with pytest.raises(PartyError):
            pt.check_start("a")                         # alone
        pt.accept("b", pt.invite("a", "b"))
        with pytest.raises(PartyError):
            pt.check_start("a")                         # b not ready
        pt.set_ready("b", True)
        with pytest.raises(PartyError):
            pt.check_start("b")                         # not the leader
        assert pt.check_start("a").members == ["a", "b"]

    def test_settings_leader_only_and_validated(self, pt):
        solo(pt, "a", "b")
        pt.accept("b", pt.invite("a", "b"))
        pt.configure("a", {"mode": "ranked", "turn_seconds": 15, "stack_draw_cards": True})
        p = pt.of("a")
        assert (p.mode, p.turn_seconds, p.stack_draw_cards) == ("ranked", 15, True)
        with pytest.raises(PartyError):
            pt.configure("b", {"mode": "casual"})
        with pytest.raises(PartyError):
            pt.configure("a", {"turn_seconds": 7})

    def test_new_member_keeps_others_ready(self, pt):
        solo(pt, "a", "b", "c")
        pt.accept("b", pt.invite("a", "b"))
        pt.set_ready("b", True)
        pt.accept("c", pt.invite("a", "c"))
        assert pt.of("a").ready == {"b"}
