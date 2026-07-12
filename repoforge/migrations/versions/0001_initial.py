"""initial schema + pgvector

Revision ID: 0001_initial
Revises:
Create Date: 2026-07-12

The first migration bootstraps the full normalized schema from the ORM metadata
and enables pgvector. Subsequent migrations are explicit, hand-written DDL —
production schema changes never rely on ORM ``create_all``.
"""

from __future__ import annotations

from alembic import op

from app.database.base import Base

# Ensure all models are imported/registered before create_all runs.
import app.database.models  # noqa: F401

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    # pgvector must exist before any vector column is created.
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    Base.metadata.create_all(bind=bind)
    # Add the native pgvector column alongside the JSONB fallback. Dimension
    # 768 matches common local embedding models (nomic-embed-text etc.).
    op.execute("ALTER TABLE embeddings ADD COLUMN IF NOT EXISTS vector vector(768)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_embeddings_vector "
        "ON embeddings USING ivfflat (vector vector_cosine_ops) WITH (lists = 100)"
    )


def downgrade() -> None:
    bind = op.get_bind()
    op.execute("DROP INDEX IF EXISTS ix_embeddings_vector")
    Base.metadata.drop_all(bind=bind)
    op.execute("DROP EXTENSION IF EXISTS vector")
