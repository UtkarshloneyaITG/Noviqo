"""Sliding-window limiter used for sign-in, sign-up and message rate limits."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from core.limits import Limiter


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def test_allows_up_to_the_limit_inside_the_window():
    clock = Clock()
    lim = Limiter(3, 10, clock)
    assert [lim.hit("a") for _ in range(4)] == [True, True, True, False]
    assert lim.hit("b")                       # keys are independent


def test_window_slides():
    clock = Clock()
    lim = Limiter(2, 10, clock)
    lim.hit("a"), lim.hit("a")
    clock.t += 9.9
    assert not lim.hit("a")
    clock.t += 0.2                            # the first two hits are now older than 10 s
    assert lim.hit("a")


def test_blocked_checks_without_counting():
    clock = Clock()
    lim = Limiter(2, 10, clock)
    lim.hit("a")
    assert not lim.blocked("a") and not lim.blocked("a")
    lim.hit("a")
    assert lim.blocked("a")


def test_forget_clears_a_key():
    lim = Limiter(1, 10, Clock())
    lim.hit("a")
    lim.forget("a")
    assert lim.hit("a")


def test_old_keys_are_pruned():
    clock = Clock()
    lim = Limiter(1, 10, clock)
    for i in range(50):
        lim.hit(i)
    clock.t += 11
    lim.prune()
    assert lim.hits == {}
