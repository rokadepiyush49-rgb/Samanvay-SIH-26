# API and worker image (same image, different command).
# WITH_EMBEDDINGS=true adds the multilingual sentence-embedding backend (CPU-only torch) and bakes the model into the
# image, so Hindi–English matching works with no network at demo time. Set it to false for a slim image (n-gram text).
FROM python:3.12-slim AS base
ARG WITH_EMBEDDINGS=true
ARG EMBEDDING_MODEL=sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy HF_HOME=/srv/models
RUN pip install --no-cache-dir uv==0.12.10 && useradd --create-home --uid 10001 samanvay
WORKDIR /srv/backend
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project $([ "$WITH_EMBEDDINGS" = "true" ] && echo --extra embeddings)
COPY app ./app
COPY migrations ./migrations
COPY alembic.ini ./
RUN uv sync --frozen --no-dev $([ "$WITH_EMBEDDINGS" = "true" ] && echo --extra embeddings) \
    && mkdir -p /srv/var/documents /srv/ml/benchmark /srv/samples /srv/models \
    && if [ "$WITH_EMBEDDINGS" = "true" ]; then \
         .venv/bin/python -c "import sys; from sentence_transformers import SentenceTransformer; SentenceTransformer(sys.argv[1])" "$EMBEDDING_MODEL"; \
       fi \
    && chown -R samanvay /srv/var /srv/ml /srv/samples /srv/models
USER samanvay
ENV PATH="/srv/backend/.venv/bin:$PATH" STORAGE_PATH=/srv/var/documents HF_HUB_OFFLINE=1 EMBEDDING_MODEL=$EMBEDDING_MODEL
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health/live')"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
