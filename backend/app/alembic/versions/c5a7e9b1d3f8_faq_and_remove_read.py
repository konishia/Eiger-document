"""FAQテーブルを追加し、既読の記録を廃止

Revision ID: c5a7e9b1d3f8
Revises: b3f6d8a2e4c7
Create Date: 2026-09-27 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c5a7e9b1d3f8"
down_revision: str | Sequence[str] | None = "b3f6d8a2e4c7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "faq_entries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("url", sa.String(length=700), nullable=False),
        sa.Column("category", sa.String(length=100), nullable=False),
        sa.Column("question", sa.String(length=300), nullable=False),
        sa.Column("answer", sa.Text(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("url"),
    )
    op.create_index(op.f("ix_faq_entries_id"), "faq_entries", ["id"], unique=False)

    op.drop_column("comments", "read_at")
    op.drop_column("inquiries", "support_read_at")


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column("inquiries", sa.Column("support_read_at", sa.DateTime(), nullable=True))
    op.add_column("comments", sa.Column("read_at", sa.DateTime(), nullable=True))
    op.drop_index(op.f("ix_faq_entries_id"), table_name="faq_entries")
    op.drop_table("faq_entries")
