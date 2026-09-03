"""The token bucket, driven by an injected clock so nothing has to sleep."""

from __future__ import annotations

import pytest

from app.ratelimit import TokenBucketLimiter


def test_a_full_bucket_allows_the_whole_burst():
    limiter = TokenBucketLimiter(3, 60)

    assert [limiter.check("ana", now=0).allowed for _ in range(3)] == [True] * 3
    assert limiter.check("ana", now=0).allowed is False


def test_the_remaining_count_counts_down():
    limiter = TokenBucketLimiter(3, 60)
    assert [limiter.check("ana", now=0).remaining for _ in range(3)] == [2, 1, 0]


def test_tokens_come_back_over_time():
    limiter = TokenBucketLimiter(2, 60)  # one token every 30s
    for _ in range(2):
        limiter.check("ana", now=0)

    assert limiter.check("ana", now=10).allowed is False
    assert limiter.check("ana", now=30).allowed is True


def test_the_retry_hint_is_long_enough_to_be_worth_waiting():
    limiter = TokenBucketLimiter(2, 60)
    for _ in range(2):
        limiter.check("ana", now=0)

    blocked = limiter.check("ana", now=0)
    assert blocked.retry_after >= 1
    # Waiting exactly that long has to actually work.
    assert limiter.check("ana", now=blocked.retry_after).allowed is True


def test_a_bucket_never_fills_past_its_capacity():
    limiter = TokenBucketLimiter(2, 60)
    limiter.check("ana", now=0)

    # An hour of silence must not bank an hour of requests.
    assert [limiter.check("ana", now=3600).allowed for _ in range(3)] == [
        True,
        True,
        False,
    ]


def test_keys_are_independent():
    limiter = TokenBucketLimiter(1, 60)
    limiter.check("ana", now=0)

    assert limiter.check("bruno", now=0).allowed is True


def test_idle_keys_are_evicted_instead_of_accumulating():
    limiter = TokenBucketLimiter(5, 10, max_keys=4)
    for i in range(4):
        limiter.check(f"caller-{i}", now=0)

    # Every existing bucket has refilled by now, so none of them is worth
    # remembering when a new caller arrives.
    limiter.check("caller-new", now=100)
    assert len(limiter._buckets) <= 4


def test_a_nonsense_budget_is_refused_up_front():
    with pytest.raises(ValueError):
        TokenBucketLimiter(0, 60)
    with pytest.raises(ValueError):
        TokenBucketLimiter(10, 0)
