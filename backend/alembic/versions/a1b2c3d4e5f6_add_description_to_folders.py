revision = 'a1b2c3d4e5f6'
down_revision = 'f1e2d3c4b5a6'
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa


def upgrade():
    op.add_column('folders', sa.Column('description', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('folders', 'description')