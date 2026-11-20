"""
Sliding-window rate limiter: at most `limit` hits per `window_s` seconds for
each key (a socket, an address, a username). In memory, per server process.
"""
import time
from collections import deque
from typing import Callable, Dict, Hashable

PRUNE_EVERY = 1000      # hits between sweeps of keys whose window has emptied


class Limiter:
    def __init__(self, limit: int, window_s: float, clock: Callable[[], float] = time.monotonic) -> None:
        self.limit, self.window, self.clock = limit, window_s, clock
        self.hits: Dict[Hashable, deque] = {}
        self._since_prune = 0

    def _recent(self, key: Hashable) -> deque:
        q = self.hits.setdefault(key, deque())
        now = self.clock()
        while q and now - q[0] >= self.window:
            q.popleft()
        return q

    def hit(self, key: Hashable) -> bool:
        """Count one hit; False (and not counted) when the key is over its limit."""
        self._since_prune += 1
        if self._since_prune >= PRUNE_EVERY:
            self.prune()
        q = self._recent(key)
        if len(q) >= self.limit:
            return False
        q.append(self.clock())
        return True

    def blocked(self, key: Hashable) -> bool:
        """Would the next hit be refused? (Doesn't count one.)"""
        return len(self._recent(key)) >= self.limit

    def forget(self, key: Hashable) -> None:
        self.hits.pop(key, None)

    def prune(self) -> None:
        self._since_prune = 0
        now = self.clock()
        self.hits = {k: q for k, q in self.hits.items() if q and now - q[-1] < self.window}
