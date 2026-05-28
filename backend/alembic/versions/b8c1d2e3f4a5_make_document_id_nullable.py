"""make document_id nullable for auto chat sessions

Revision ID: b8c1d2e3f4a5
Revises: 05b7ef7d2e3a
Create Date: 2026-05-23 15:14:00.000000
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'b8c1d2e3f4a5'
down_revision = '05b7ef7d2e3a'
branch_labels = None
depends_on = None


def upgrade():
    # Drop the existing NOT NULL constraint and re-add as nullable
    op.alter_column('chat_sessions', 'document_id',
                     existing_type=sa.String(36),
                     nullable=True)


def downgrade():
    # Restore NOT NULL constraint (set empty string for existing nulls first)
    op.execute("UPDATE chat_sessions SET document_id = '' WHERE document_id IS NULL")
    op.alter_column('chat_sessions', 'document_id',
                     existing_type=sa.String(36),
                     nullable=False)
