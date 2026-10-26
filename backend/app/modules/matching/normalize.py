"""Stage 0 of the matching cascade: normalisation, transliteration and reference extraction (blueprint §14.2).

Pure functions with no database access; shared by intake, the matching worker and the benchmark harness.
"""

from __future__ import annotations

import re
import unicodedata

ZERO_WIDTH = re.compile(r"[​-‏⁠﻿]")
DEVANAGARI = re.compile(r"[ऀ-ॿ]")
DEV_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")

ABBREVIATIONS = {
    "inst": "institute",
    "instt": "institute",
    "insti": "institute",
    "institue": "institute",
    "institutes": "institute",
    "engg": "engineering",
    "eng": "engineering",
    "engineeing": "engineering",
    "tech": "technology",
    "techn": "technology",
    "technol": "technology",
    "coll": "college",
    "clg": "college",
    "colg": "college",
    "univ": "university",
    "mgmt": "management",
    "mgt": "management",
    "sci": "science",
    "pharm": "pharmacy",
    "poly": "polytechnic",
    "res": "research",
    "govt": "government",
    "edu": "education",
    "acad": "academy",
    "&": "and",
}
LEGAL_SUFFIXES = {"pvt", "ltd", "private", "limited", "trust", "society", "the", "regd", "registered"}

# Hindi institution vocabulary → English, applied before transliteration so names compare across scripts.
HINDI_WORDS = {
    "इंस्टीट्यूट": "institute",
    "इंस्टिट्यूट": "institute",
    "संस्थान": "institute",
    "इंजीनियरिंग": "engineering",
    "अभियांत्रिकी": "engineering",
    "कॉलेज": "college",
    "महाविद्यालय": "college",
    "विश्वविद्यालय": "university",
    "यूनिवर्सिटी": "university",
    "प्रौद्योगिकी": "technology",
    "टेक्नोलॉजी": "technology",
    "तकनीकी": "technical",
    "ऑफ": "of",
    "एंड": "and",
    "और": "and",
    "प्रबंधन": "management",
    "मैनेजमेंट": "management",
    "फार्मेसी": "pharmacy",
    "पॉलिटेक्निक": "polytechnic",
    "वैली": "valley",
    "साइंस": "science",
    "विज्ञान": "science",
    "अनुसंधान": "research",
    "रिसर्च": "research",
    "एकेडमी": "academy",
}

_CONSONANTS = {
    "क": "k",
    "ख": "kh",
    "ग": "g",
    "घ": "gh",
    "ङ": "n",
    "च": "ch",
    "छ": "chh",
    "ज": "j",
    "झ": "jh",
    "ञ": "n",
    "ट": "t",
    "ठ": "th",
    "ड": "d",
    "ढ": "dh",
    "ण": "n",
    "त": "t",
    "थ": "th",
    "द": "d",
    "ध": "dh",
    "न": "n",
    "प": "p",
    "फ": "ph",
    "ब": "b",
    "भ": "bh",
    "म": "m",
    "य": "y",
    "र": "r",
    "ल": "l",
    "व": "v",
    "श": "sh",
    "ष": "sh",
    "स": "s",
    "ह": "h",
    "ळ": "l",
}
_NUKTA = {"ड": "r", "ढ": "rh", "फ": "f", "ज": "z", "क": "q", "ख": "kh", "ग": "g"}
_VOWELS = {
    "अ": "a",
    "आ": "a",
    "इ": "i",
    "ई": "i",
    "उ": "u",
    "ऊ": "u",
    "ए": "e",
    "ऐ": "ai",
    "ओ": "o",
    "औ": "au",
    "ऋ": "ri",
    "ऑ": "o",
    "ऍ": "e",
}
_MATRAS = {
    "ा": "a",
    "ि": "i",
    "ी": "i",
    "ु": "u",
    "ू": "u",
    "े": "e",
    "ै": "ai",
    "ो": "o",
    "ौ": "au",
    "ृ": "ri",
    "ॉ": "o",
    "ॅ": "e",
}
_MODIFIERS = {"ं": "n", "ँ": "n", "ः": "h"}
VIRAMA, NUKTA = "्", "़"


def transliterate(text: str) -> str:
    """Rough Devanagari → Latin transliteration for name comparison (schwa dropped at word end)."""
    out: list[str] = []
    chars = list(text)
    i = 0
    while i < len(chars):
        ch = chars[i]
        if ch in _CONSONANTS:
            base = _CONSONANTS[ch]
            nxt = chars[i + 1] if i + 1 < len(chars) else ""
            if nxt == NUKTA:
                base = _NUKTA.get(ch, base)
                i += 1
                nxt = chars[i + 1] if i + 1 < len(chars) else ""
            if nxt == VIRAMA:
                out.append(base)
                i += 2
                continue
            if nxt in _MATRAS:
                out.append(base + _MATRAS[nxt])
                i += 2
                continue
            after = nxt
            word_end = not after or not DEVANAGARI.match(after) or after in _MODIFIERS
            out.append(base if word_end and after not in _MODIFIERS else base + "a")
            i += 1
            continue
        if ch in _VOWELS:
            out.append(_VOWELS[ch])
        elif ch in _MODIFIERS:
            out.append(_MODIFIERS[ch])
        elif ch in _MATRAS or ch in (VIRAMA, NUKTA):
            pass
        else:
            out.append(ch)
        i += 1
    return "".join(out)


def base_clean(text: str) -> str:
    text = unicodedata.normalize("NFKC", text or "")
    text = ZERO_WIDTH.sub("", text).translate(DEV_DIGITS)
    return text.lower()


def normalize_name(name: str) -> str:
    """Canonical institution name: lower case, abbreviations expanded, legal suffixes dropped, Latin script."""
    text = base_clean(name)
    for hi, en in HINDI_WORDS.items():
        text = text.replace(hi, f" {en} ")
    if DEVANAGARI.search(text):
        text = transliterate(text)
    text = text.replace("&", " and ")
    text = re.sub(r"[^\w\s]", " ", text)
    tokens = []
    for tok in text.split():
        tok = ABBREVIATIONS.get(tok, tok)
        if tok in LEGAL_SUFFIXES:
            continue
        tokens.append(tok)
    return " ".join(tokens)


def acronym(norm_name: str) -> str:
    stop = {"of", "and", "for", "the", "in"}
    return "".join(t[0] for t in norm_name.split() if t not in stop)


def detect_language(text: str) -> str:
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return "en"
    dev = sum(1 for c in letters if DEVANAGARI.match(c))
    return "hi" if dev / len(letters) > 0.3 else "en"


# --- Reference and entity extraction -------------------------------------------------------------------------------

RE_CPGRAMS = re.compile(r"\b([A-Z]{2,10}/[A-Z]/\d{4}/\d{5,8})\b")
RE_PERMANENT_ID = re.compile(r"\b(1-\d{7,10})\b")
RE_COURT = re.compile(
    r"\b(W\.?\s?P\.?\s?\(\s?C\s?\)|C\.?W\.?P\.?|W\.?P\.?|O\.?A\.?)\s*(?:No\.?)?\s*(\d{1,6})\s*/\s*(\d{4})",
    re.IGNORECASE,
)
RE_FILE_NO = re.compile(r"\bF\.?\s?No\.?\s*([A-Z0-9][A-Z0-9\-/().]{4,40}[A-Z0-9)])", re.IGNORECASE)
RE_AMOUNT = re.compile(
    r"(?:₹|\brs\.?|\binr|रु\.?)\s*([\d,]+(?:\.\d+)?)|([\d,]{3,}(?:\.\d+)?)\s*(?:/-)?\s*(?:रुपये|rupees)", re.IGNORECASE
)
RE_DATE = re.compile(r"\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b")
PROGRAMMES = {
    "btech": re.compile(r"\bb\.?\s?tech\b|बी\.?\s?टेक", re.IGNORECASE),
    "be": re.compile(r"\bb\.e\.?(?=\s|$|,)", re.IGNORECASE),
    "mtech": re.compile(r"\bm\.?\s?tech\b|एम\.?\s?टेक", re.IGNORECASE),
    "mba": re.compile(r"\bmba\b|एमबीए", re.IGNORECASE),
    "mca": re.compile(r"\bmca\b|एमसीए", re.IGNORECASE),
    "pharmacy": re.compile(r"\b[bd]\.?\s?pharm\b|फार्मेसी", re.IGNORECASE),
    "diploma": re.compile(r"\bdiploma\b|डिप्लोमा", re.IGNORECASE),
    "phd": re.compile(r"\bph\.?\s?d\b|पीएचडी", re.IGNORECASE),
}


def _court_norm(m: re.Match) -> str:
    kind = re.sub(r"[\s.]", "", m.group(1)).upper()
    kind = {"WP(C)": "WP(C)", "WP": "WP", "CWP": "CWP", "OA": "OA"}.get(kind, kind)
    return f"{kind} {int(m.group(2))}/{m.group(3)}"


def extract_refs(text: str) -> dict[str, list[str]]:
    t = unicodedata.normalize("NFKC", text or "").translate(DEV_DIGITS)
    return {
        "cpgrams": sorted({m.upper() for m in RE_CPGRAMS.findall(t)}),
        "permanent_ids": sorted(set(RE_PERMANENT_ID.findall(t))),
        "court_cases": sorted({_court_norm(m) for m in RE_COURT.finditer(t)}),
        "file_nos": sorted({m.upper().rstrip(".") for m in RE_FILE_NO.findall(t)}),
    }


def extract_entities(text: str) -> set[str]:
    """Amounts, dates and programmes as comparable tokens (for the entity-overlap feature)."""
    t = unicodedata.normalize("NFKC", text or "").translate(DEV_DIGITS)
    found: set[str] = set()
    for m in RE_AMOUNT.finditer(t):
        raw = (m.group(1) or m.group(2) or "").replace(",", "")
        try:
            value = int(float(raw))
        except ValueError:
            continue
        if value >= 100:
            found.add(f"amt:{value}")
    for d, mth, y in RE_DATE.findall(t):
        try:
            found.add(f"date:{int(y):04d}-{int(mth):02d}-{int(d):02d}")
        except ValueError:
            continue
    for name, rx in PROGRAMMES.items():
        if rx.search(t):
            found.add(f"prog:{name}")
    return found


STOPWORDS = {
    "the",
    "a",
    "an",
    "of",
    "and",
    "or",
    "to",
    "in",
    "is",
    "are",
    "was",
    "were",
    "for",
    "on",
    "by",
    "with",
    "my",
    "our",
    "we",
    "i",
    "me",
    "this",
    "that",
    "it",
    "be",
    "has",
    "have",
    "had",
    "not",
    "from",
    "at",
    "as",
    "sir",
    "madam",
    "please",
    "kindly",
    "respected",
    "dear",
    "regarding",
    "subject",
    "complaint",
    "institute",
    "college",
    "का",
    "की",
    "के",
    "है",
    "हैं",
    "में",
    "से",
    "को",
    "और",
    "यह",
    "वह",
    "पर",
    "भी",
    "था",
    "थी",
    "थे",
    "कि",
    "मेरा",
    "मेरी",
    "हम",
    "मैं",
    "कृपया",
    "महोदय",
    "विषय",
    "शिकायत",
    "एक",
    "तो",
    "ने",
    "लिए",
    "गया",
    "गई",
    "कर",
    "रहा",
    "रही",
}


def text_tokens(text: str) -> list[str]:
    t = base_clean(text)
    t = re.sub(r"[^\w\s]", " ", t)
    return [w for w in t.split() if w not in STOPWORDS and len(w) > 1]


def similarity_text(text: str, institution_names: list[str | None], places: list[str | None]) -> str:
    """Complaint text with the institution's own name and city removed.

    Institution identity is scored as its own feature; leaving the name in the text would make every pair of
    complaints about one institution look textually similar.
    """
    drop: set[str] = set()
    for value in [*institution_names, *places]:
        if value:
            drop.update(text_tokens(value))
            drop.update(normalize_name(value).split())
    return " ".join(t for t in text_tokens(text) if t not in drop)
