"""返信（コメント）に写真を付けられるようにする

Revision ID: d6b8f0c2e4a9
Revises: c5a7e9b1d3f8
Create Date: 2026-09-28 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d6b8f0c2e4a9"
down_revision: str | Sequence[str] | None = "c5a7e9b1d3f8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("attachments", sa.Column("comment_id", sa.Integer(), nullable=True))
    op.create_index(op.f("ix_attachments_comment_id"), "attachments", ["comment_id"], unique=False)
    op.create_foreign_key(
        "fk_attachments_comment_id", "attachments", "comments", ["comment_id"], ["id"], ondelete="CASCADE"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("fk_attachments_comment_id", "attachments", type_="foreignkey")
    op.drop_index(op.f("ix_attachments_comment_id"), table_name="attachments")
    op.drop_column("attachments", "comment_id")
