"""Cross-stack parity: the Python language table mirrors the TypeScript one.

The frontend decides which sources may serve a language; the backend applies
the same truth table. A drift between the two tables would let a user's
language filter silently stop applying, so this test fails loudly instead.
"""

from __future__ import annotations

import re

from app.languages import LANGUAGES, language_by_code, normalize_language, track_language

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
    # The three languages the Home "Explore by Language" shelves lead with.
    for code, label in (("hi", "Hindi"), ("ta", "Tamil"), ("te", "Telugu")):
        option = language_by_code(code)
        assert option is not None and option.label == label and option.iso == code


def test_unknown_codes_normalise_to_all_on_both_sides() -> None:
    # The frontend's normalizeLanguage maps unknowns to 'all'; the backend
    # agrees, so a stale URL can never send a junk filter to a provider.
    for raw in ("", None, "xx", "English", "ALL"):
        assert normalize_language(raw) == "all"


def test_track_language_maps_provider_tags_to_app_codes() -> None:
    # BCP-47 tags from `defaultAudioLanguage` collapse onto app codes:
    # exact codes first, then the base subtag — no script/region guessing.
    assert track_language("te") == "te"
    assert track_language("hi") == "hi"
    assert track_language("ta") == "ta"
    assert track_language("ta-LK") == "ta"
    assert track_language("EN") == "en"
    assert track_language("pt-BR") == "pt"
    assert track_language("zh-Hans") == "zh-Hans"
    assert track_language("zh-hans-CN") == "zh-Hans"
    assert track_language("zh-TW") == "zh"  # dialect unknown → plain Chinese


def test_track_language_refuses_to_invent_languages() -> None:
    # Codes outside the catalogue (and junk values) stay unlabelled: the
    # track is preserved without a language rather than mislabelled.
    for raw in (None, "", "  ", "all", "other", "ceb", "haw"):
        assert track_language(raw) is None
    assert track_language(123) is None  # type: ignore[arg-type]
