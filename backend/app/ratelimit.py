"""A small in-process token-bucket limiter.

Deliberately not a distributed limiter: the state lives in one process, so on a
serverless host each warm instance enforces its own budget. That is still worth
having — it stops a single client from hammering one instance into a database
connection storm — but the numbers are a safety net, not a quota. A hard,
account-wide quota belongs in front of the app (the platform's WAF or a Redis
limiter), and the settings are shaped so it can be turned off there.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass


@dataclass(frozen=True)
class Decision:
    allowed: bool
    remaining: int
    retry_after: int


class TokenBucketLimiter:
    """``limit`` requests per ``window`` seconds, refilled continuously.

    A bucket refills at ``limit / window`` tokens per second and holds at most
    ``limit``, so a caller can burst up to the full budget and then settles into
    the steady rate instead of being cut off at a window boundary.
    """

    def __init__(self, limit: int, window_seconds: float, *, max_keys: int = 10_000):
        if limit < 1 or window_seconds <= 0:
            raise ValueError("limit must be >= 1 and window_seconds > 0")
        self.limit = limit
        self.window = float(window_seconds)
        self.rate = limit / float(window_seconds)
        self._max_keys = max_keys
        self._buckets: dict[str, tuple[float, float]] = {}
        self._lock = threading.Lock()

    def check(self, key: str, *, now: float | None = None) -> Decision:
        now = time.monotonic() if now is None else now

        with self._lock:
            if len(self._buckets) >= self._max_keys:
                self._evict(now)

            tokens, last_seen = self._buckets.get(key, (float(self.limit), now))
            tokens = min(float(self.limit), tokens + (now - last_seen) * self.rate)

            if tokens < 1.0:
                self._buckets[key] = (tokens, now)
                # Seconds until one whole token is back, rounded up.
                retry_after = max(1, int((1.0 - tokens) / self.rate) + 1)
                return Decision(False, 0, retry_after)

            tokens -= 1.0
            self._buckets[key] = (tokens, now)
            return Decision(True, int(tokens), 0)

    def reset(self) -> None:
        with self._lock:
            self._buckets.clear()

    def _evict(self, now: float) -> None:
        """Drop buckets that have refilled completely; they carry no state."""
        full_after = self.window
        stale = [k for k, (_, seen) in self._buckets.items() if now - seen >= full_after]
        for key in stale:
            del self._buckets[key]

        if len(self._buckets) >= self._max_keys:
            # Pathological cardinality (a spoofed-IP flood). Start over rather
            # than let the table grow without bound.
            self._buckets.clear()
