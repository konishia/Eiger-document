"""従業員名簿と、監査ログの従業員コードを追加する

Revision ID: b9d3f5a7c2e8
Revises: a8c2e4f6b1d3
Create Date: 2026-10-08 15:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b9d3f5a7c2e8"
down_revision: str | Sequence[str] | None = "a8c2e4f6b1d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "employees",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(length=20), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )
    op.create_index(op.f("ix_employees_id"), "employees", ["id"], unique=False)

    op.add_column(
        "audit_logs", sa.Column("employee_code", sa.String(length=20), nullable=False, server_default="")
    )
    op.create_index(op.f("ix_audit_logs_employee_code"), "audit_logs", ["employee_code"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_audit_logs_employee_code"), table_name="audit_logs")
    op.drop_column("audit_logs", "employee_code")
    op.drop_index(op.f("ix_employees_id"), table_name="employees")
    op.drop_table("employees")
