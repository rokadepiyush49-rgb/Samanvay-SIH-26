"""Text-similarity backends for complaint text (blueprint §14.1).

* ngram  — character-trigram cosine over content words. No model download; same-script only, so a Hindi/English
           pair is reported as "text not compared" rather than scored as dissimilar.
* embedding — multilingual sentence embeddings (sentence-transformers), which also compare Hindi with English.
              Loaded lazily; if unavailable the engine falls back to ngram and says so in the reasons.
"""

from __future__ import annotations

import hashlib
import logging
import math
import threading
from collections import Counter
from functools import lru_cache

from app.core.config import get_settings
from app.modules.matching.normalize import text_tokens

log = logging.getLogger("samanvay.matching")


def text_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


class NgramBackend:
    name = "ngram3-v1"
    cross_lingual = False
    # Thresholds for the text feature, tuned on the synthetic benchmark (see docs/IMPLEMENTATION_STATUS.md).
    bands = (0.46, 0.36, 0.26)

    @staticmethod
    @lru_cache(maxsize=20000)
    def _profile(text: str) -> tuple[dict[str, int], float]:
        grams: Counter[str] = Counter()
        for tok in text_tokens(text):
            padded = f" {tok} "
            for i in range(len(padded) - 2):
                grams[padded[i : i + 3]] += 1
        norm = math.sqrt(sum(v * v for v in grams.values()))
        return dict(grams), norm

    def similarity(self, a: str, b: str, lang_a: str, lang_b: str, vec_a=None, vec_b=None) -> float | None:
        if lang_a != lang_b:
            return None
        pa, na = self._profile(a)
        pb, nb = self._profile(b)
        if not na or not nb:
            return None
        if len(pa) > len(pb):
            pa, pb = pb, pa
        dot = sum(v * pb.get(k, 0) for k, v in pa.items())
        return dot / (na * nb)

    def vector(self, text: str):
        return None


class EmbeddingBackend:
    cross_lingual = True
    bands = (0.85, 0.75, 0.60)
    # Hindi–English pairs score lower than same-language paraphrases. Chosen on the calibration seed (2027) only: at
    # 0.65 no unrelated cross-language candidate pair scores as high; at 0.55, 4% do while 86% of true pairs pass.
    cross_bands = (0.65, 0.55, 0.48)

    def __init__(self, model_name: str) -> None:
        from sentence_transformers import SentenceTransformer  # optional dependency

        try:  # cached copy first, so a demo laptop with no network still matches Hindi with English
            self.model = SentenceTransformer(model_name, device="cpu", local_files_only=True)
        except OSError:
            self.model = SentenceTransformer(model_name, device="cpu")
        self.name = f"st:{model_name.split('/')[-1]}"
        self._lock = threading.Lock()

    def vectors(self, texts: list[str]) -> list[list[float]]:
        with self._lock:
            arr = self.model.encode(texts, batch_size=32, normalize_embeddings=True, show_progress_bar=False)
        return [list(map(float, v)) for v in arr]

    def vector(self, text: str) -> list[float]:
        return self.vectors([text])[0]

    def similarity(self, a: str, b: str, lang_a: str, lang_b: str, vec_a=None, vec_b=None) -> float | None:
        va = vec_a if vec_a is not None else self.vector(a)
        vb = vec_b if vec_b is not None else self.vector(b)
        return float(sum(x * y for x, y in zip(va, vb, strict=False)))


_backend = None
_backend_lock = threading.Lock()


def get_backend():
    """The configured backend; falls back to ngram (logged) if the embedding model cannot be loaded."""
    global _backend
    with _backend_lock:
        if _backend is not None:
            return _backend
        settings = get_settings()
        if settings.text_backend == "embedding":
            try:
                _backend = EmbeddingBackend(settings.embedding_model)
            except Exception as exc:  # noqa: BLE001 - any load failure means "use the fallback"
                log.warning("embedding backend unavailable, using ngram: %s", exc)
                _backend = NgramBackend()
        else:
            _backend = NgramBackend()
        return _backend


def set_backend(backend) -> None:
    global _backend
    with _backend_lock:
        _backend = backend
