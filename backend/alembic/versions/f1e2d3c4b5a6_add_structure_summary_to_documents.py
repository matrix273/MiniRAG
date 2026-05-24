revision = 'f1e2d3c4b5a6'
down_revision = 'b8c1d2e3f4a5'
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa


def upgrade():
    op.add_column('documents', sa.Column('structure_summary', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('documents', 'structure_summary')