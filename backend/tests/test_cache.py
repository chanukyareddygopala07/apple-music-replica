"""Bounded TTL cache: expiry, eviction, hit accounting, negative entries."""

from __future__ import annotations

import time

from app.cache import TTLCache, cache_miss


def test_set_then_get_counts_a_hit() -> None:
    cache: TTLCache = TTLCache(max_entries=4, ttl_s=60, negative_ttl_s=5)
    assert cache.get("k") is cache_miss()
    cache.set("k", ["value"])
    assert cache.get("k") == ["value"]
    assert cache.stats == {"entries": 1, "hits": 1, "misses": 1, "max": 4}


def test_entries_expire_after_their_ttl() -> None:
    cache: TTLCache = TTLCache(max_entries=4, ttl_s=0.01, negative_ttl_s=0.01)
    cache.set("k", "v")
    time.sleep(0.02)
    assert cache.get("k") is cache_miss()


def test_negative_entries_expire_on_their_own_shorter_ttl() -> None:
    cache: TTLCache = TTLCache(max_entries=4, ttl_s=60, negative_ttl_s=0.01)
    cache.set("missing", None, negative=True)
    assert cache.get("missing") is None  # cached "not found"
    time.sleep(0.02)
    assert cache.get("missing") is cache_miss()  # re-queries upstream


def test_eviction_is_bounded_and_prefers_the_oldest() -> None:
    cache: TTLCache = TTLCache(max_entries=2, ttl_s=60, negative_ttl_s=5)
    cache.set("a", 1)
    cache.set("b", 2)
    cache.set("c", 3)
    assert cache.stats["entries"] == 2
    assert cache.get("a") is cache_miss()
    assert cache.get("b") == 2
    assert cache.get("c") == 3
