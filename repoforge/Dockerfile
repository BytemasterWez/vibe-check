FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# System deps kept minimal; psycopg[binary] ships its own libpq.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first for layer caching.
COPY pyproject.toml ./
RUN pip install --upgrade pip \
    && pip install "fastapi>=0.110" "uvicorn[standard]>=0.29" "pydantic>=2.6" \
       "pydantic-settings>=2.2" "httpx>=0.27" "sqlalchemy>=2.0" "alembic>=1.13" \
       "psycopg[binary]>=3.1" "pgvector>=0.2.5" "apscheduler>=3.10" "jinja2>=3.1" \
       "python-dotenv>=1.0"

COPY . .
RUN pip install -e . --no-deps

# Non-root user (spec requirement). It owns the app dir but not host volumes.
RUN useradd --create-home --uid 10001 repoforge \
    && chown -R repoforge:repoforge /app
USER repoforge

EXPOSE 18765

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:18765/health || exit 1

ENTRYPOINT ["/app/docker/entrypoint.sh"]
