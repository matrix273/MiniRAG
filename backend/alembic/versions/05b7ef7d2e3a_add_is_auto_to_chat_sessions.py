revision = '05b7ef7d2e3a'
down_revision = 'bd4a43697605'
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa


def upgrade():
    op.add_column('chat_sessions', sa.Column('is_auto', sa.Boolean(), server_default='false', nullable=False))


def downgrade():
    op.drop_column('chat_sessions', 'is_auto')
