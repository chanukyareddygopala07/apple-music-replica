"""App-level language codes mirrored from the frontend selector.

The codes are the app's own vocabulary (`all`, `en`, `zh-Hans`, …); each one
carries the wire values the providers actually accept:

- ``iso``      → Jamendo's documented 2-letter ``lang``
- ``relevance`` → YouTube's ``relevanceLanguage`` (defaults to ``iso``)

``all`` and ``other`` carry no ISO value: `other` is a UI-only bucket and a
source steps aside rather than guess. Codes exist only where a real ISO 639-1
value exists — nothing is invented. Unknown codes normalise to ``all``.

Kept in sync with `src/data/languages.ts`.
"""

from __future__ import annotations

from dataclasses import dataclass

ALL_LANGUAGES = "all"


@dataclass(frozen=True)
class LanguageOption:
    code: str
    label: str
    iso: str | None = None
    relevance: str | None = None


def _o(
    code: str, label: str, iso: str | None = None, relevance: str | None = None
) -> LanguageOption:
    return LanguageOption(code=code, label=label, iso=iso, relevance=relevance)


LANGUAGES: tuple[LanguageOption, ...] = (
    _o(ALL_LANGUAGES, "All languages"),
    _o("en", "English", "en"),
    _o("es", "Spanish", "es"),
    _o("fr", "French", "fr"),
    _o("de", "German", "de"),
    _o("it", "Italian", "it"),
    _o("pt", "Portuguese", "pt"),
    _o("nl", "Dutch", "nl"),
    _o("sv", "Swedish", "sv"),
    _o("no", "Norwegian", "no"),
    _o("da", "Danish", "da"),
    _o("fi", "Finnish", "fi"),
    _o("is", "Icelandic", "is"),
    _o("pl", "Polish", "pl"),
    _o("cs", "Czech", "cs"),
    _o("sk", "Slovak", "sk"),
    _o("hu", "Hungarian", "hu"),
    _o("ro", "Romanian", "ro"),
    _o("bg", "Bulgarian", "bg"),
    _o("el", "Greek", "el"),
    _o("sr", "Serbian", "sr"),
    _o("hr", "Croatian", "hr"),
    _o("sl", "Slovenian", "sl"),
    _o("lt", "Lithuanian", "lt"),
    _o("lv", "Latvian", "lv"),
    _o("et", "Estonian", "et"),
    _o("uk", "Ukrainian", "uk"),
    _o("ru", "Russian", "ru"),
    _o("tr", "Turkish", "tr"),
    _o("ar", "Arabic", "ar"),
    _o("he", "Hebrew", "he"),
    _o("fa", "Persian", "fa"),
    _o("ur", "Urdu", "ur"),
    _o("hi", "Hindi", "hi"),
    _o("bn", "Bengali", "bn"),
    _o("ta", "Tamil", "ta"),
    _o("te", "Telugu", "te"),
    _o("mr", "Marathi", "mr"),
    _o("gu", "Gujarati", "gu"),
    _o("kn", "Kannada", "kn"),
    _o("ml", "Malayalam", "ml"),
    _o("pa", "Punjabi", "pa"),
    _o("zh", "Chinese", "zh"),
    _o("zh-Hans", "Chinese (Simplified)", "zh", "zh-Hans"),
    _o("zh-Hant", "Chinese (Traditional)", "zh", "zh-Hant"),
    _o("ja", "Japanese", "ja"),
    _o("ko", "Korean", "ko"),
    _o("vi", "Vietnamese", "vi"),
    _o("th", "Thai", "th"),
    _o("id", "Indonesian", "id"),
    _o("ms", "Malay", "ms"),
    _o("tl", "Filipino / Tagalog", "tl"),
    _o("my", "Burmese", "my"),
    _o("km", "Khmer", "km"),
    _o("lo", "Lao", "lo"),
    _o("ka", "Georgian", "ka"),
    _o("hy", "Armenian", "hy"),
    _o("az", "Azerbaijani", "az"),
    _o("kk", "Kazakh", "kk"),
    _o("uz", "Uzbek", "uz"),
    _o("mn", "Mongolian", "mn"),
    _o("ne", "Nepali", "ne"),
    _o("sw", "Swahili", "sw"),
    _o("af", "Afrikaans", "af"),
    _o("am", "Amharic", "am"),
    _o("so", "Somali", "so"),
    _o("ha", "Hausa", "ha"),
    _o("yo", "Yoruba", "yo"),
    _o("ig", "Igbo", "ig"),
    _o("ca", "Catalan", "ca"),
    _o("eu", "Basque", "eu"),
    _o("gl", "Galician", "gl"),
    _o("other", "Other languages"),
)

_BY_CODE: dict[str, LanguageOption] = {opt.code: opt for opt in LANGUAGES}


def language_by_code(code: str | None) -> LanguageOption | None:
    if not code:
        return None
    return _BY_CODE.get(code)


def normalize_language(raw: str | None) -> str:
    """Valid app code, else ``all`` — an unknown value never reaches a provider."""
    return raw if raw in _BY_CODE else ALL_LANGUAGES


def jamendo_language(code: str) -> str | None:
    """Value for Jamendo's ``lang``; ``None`` = no filter (``all``)."""
    opt = _BY_CODE.get(code)
    return opt.iso if opt else None


def youtube_language(code: str) -> str | None:
    """Value for YouTube's ``relevanceLanguage``; ``None`` = no filter."""
    opt = _BY_CODE.get(code)
    if not opt:
        return None
    return opt.relevance or opt.iso
