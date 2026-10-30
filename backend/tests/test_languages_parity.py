"""Cross-stack parity: the Python language table mirrors the TypeScript one.

The frontend decides which sources may serve a language; the backend applies
the same truth table. A drift between the two tables would let a user's
language filter silently stop applying, so this test fails loudly instead.
"""

from __future__ import annotations

import re

from app.languages import LANGUAGES, language_by_code, normalize_language

from .conftest import REPO_ROOT

TS_PATH = REPO_ROOT / "src" / "data" / "languages.ts"

_ENTRY = re.compile(
    r"\{\s*code:\s*(?:(?:ALL_LANGUAGES)|'([^']+)'),\s*label:\s*'([^']*)'"
    r"(?:,\s*iso:\s*'([^']+)')?(?:,\s*relevance:\s*'([^']+)')?\s*\}"
)


def parse_frontend_languages() -> list[tuple[str, str, str | None, str | None]]:
    source = TS_PATH.read_text()
    rows: list[tuple[str, str, str | None, str | None]] = []
    for code, label, iso, relevance in _ENTRY.findall(source):
        actual_code = code or "all"  # ALL_LANGUAGES constant expands to 'all'
        rows.append((actual_code, label, iso or None, relevance or None))
    return rows


def test_the_frontend_table_parses_into_the_same_shape() -> None:
    rows = parse_frontend_languages()
    assert len(rows) >= 70, "languages.ts entry parsing broke — update the regex"
    assert ("all", "All languages", None, None) in rows
    assert ("other", "Other languages", None, None) in rows
    assert ("zh-Hans", "Chinese (Simplified)", "zh", "zh-Hans") in rows


def test_every_code_and_iso_value_matches_the_frontend_exactly() -> None:
    frontend = {
        code: (label, iso, relevance) for code, label, iso, relevance in parse_frontend_languages()
    }
    backend = {option.code: (option.label, option.iso, option.relevance) for option in LANGUAGES}
    assert backend == frontend


def test_language_truth_table_matches_the_frontend_contract() -> None:
    # Jamendo and YouTube can only filter with a real ISO value.
    assert language_by_code("fr") is not None and language_by_code("fr").iso == "fr"
    assert language_by_code("all").iso is None
    assert language_by_code("other").iso is None
    # Chinese script variants keep their YouTube relevance hints.
    assert language_by_code("zh-Hans").relevance == "zh-Hans"
    assert language_by_code("zh-Hant").iso == "zh"


def test_unknown_codes_normalise_to_all_on_both_sides() -> None:
    # The frontend's normalizeLanguage maps unknowns to 'all'; the backend
    # agrees, so a stale URL can never send a junk filter to a provider.
    for raw in ("", None, "xx", "English", "ALL"):
        assert normalize_language(raw) == "all"
