FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 gcc libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md ./
COPY engine ./engine
COPY adapters ./adapters
COPY services ./services
COPY scripts ./scripts
COPY contracts ./contracts
COPY db ./db

RUN pip install --no-cache-dir -e ".[storage]"

ENV PYTHONUNBUFFERED=1
