"""Small bounded TTL cache with negative caching.

No Redis, no Celery — one process, a dict with a hard entry cap and per-entry
expiry. Failures ("this track does not exist") are cached too, for a shorter
TTL, so a client retry loop cannot hammer a provider.

Never store credentials, authorization headers or anything user-specific here:
keys are built from provider + public identifiers only.
"""

from __future__ import annotations

import time
from collections import OrderedDict
from typing import Any, Generic, TypeVar

T = TypeVar("T")

_MISS = object()


class TTLCache(Generic[T]):
    """LRU-bounded cache: entries expire after `ttl_s`, oldest evicted first."""

    def __init__(
        self, max_entries: int = 512, ttl_s: float = 60.0, negative_ttl_s: float = 15.0
    ) -> None:
        self._max = max(1, int(max_entries))
        self._ttl = max(0.0, float(ttl_s))
        self._negative_ttl = max(0.0, float(negative_ttl_s))
        self._data: OrderedDict[str, tuple[float, T]] = OrderedDict()
        self.hits = 0
        self.misses = 0

    def get(self, key: str) -> Any:
        """Return the stored value, or the module `_MISS` sentinel."""
        entry = self._data.get(key)
        if entry is None:
            self.misses += 1
            return _MISS
        expires_at, value = entry
        if expires_at <= time.monotonic():
            del self._data[key]
            self.misses += 1
            return _MISS
        self._data.move_to_end(key)
        self.hits += 1
        return value

    def set(self, key: str, value: T, *, negative: bool = False) -> None:
        ttl = self._negative_ttl if negative else self._ttl
        if ttl <= 0:
            return
        self._data[key] = (time.monotonic() + ttl, value)
        self._data.move_to_end(key)
        while len(self._data) > self._max:
            self._data.popitem(last=False)

    def clear(self) -> None:
        self._data.clear()
        self.hits = 0
        self.misses = 0

    def __len__(self) -> int:
        return len(self._data)

    @property
    def stats(self) -> dict[str, int]:
        return {
            "entries": len(self._data),
            "hits": self.hits,
            "misses": self.misses,
            "max": self._max,
        }


def cache_miss() -> object:
    """Sentinel returned by :meth:`TTLCache.get` for an absent/expired key."""
    return _MISS
