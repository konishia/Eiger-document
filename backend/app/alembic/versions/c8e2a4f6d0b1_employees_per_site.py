"""従業員名簿を、現場スタッフ用とサポートチーム用に分ける

Revision ID: c8e2a4f6d0b1
Revises: b9d3f5a7c2e8
Create Date: 2026-10-16 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c8e2a4f6d0b1"
down_revision: str | Sequence[str] | None = "b9d3f5a7c2e8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # これまでの名簿は現場スタッフ用として残す
    op.add_column(
        "employees", sa.Column("site", sa.String(length=20), nullable=False, server_default="staff")
    )
    op.drop_constraint("code", "employees", type_="unique")
    op.create_unique_constraint("uq_employees_site_code", "employees", ["site", "code"])


def downgrade() -> None:
    """Downgrade schema."""
    # サポートチーム用の名簿は消える（同じ従業員コードが2つあると、1つの名簿に戻せないため）
    op.execute("DELETE FROM employees WHERE site <> 'staff'")
    op.drop_constraint("uq_employees_site_code", "employees", type_="unique")
    op.create_unique_constraint("code", "employees", ["code"])
    op.drop_column("employees", "site")
