"""create enum types

Revision ID: 202609160002
Revises: 202609160001
Create Date: 2026-09-16
"""

from alembic import op

revision = "202609160002"
down_revision = "202609160001"
branch_labels = None
depends_on = None

ENUM_TYPES = {
    "import_status": ["pending", "importing", "completed", "failed"],
    "road_classification": [
        "motorway",
        "trunk",
        "primary",
        "secondary",
        "tertiary",
        "residential",
        "service",
        "unclassified",
    ],
    "building_category": ["residential", "commercial", "industrial", "civic", "unspecified"],
    "poi_category": ["food_and_drink", "shopping", "health", "education", "transit", "other"],
    "area_feature_kind": ["park", "water", "green_space"],
    "movement_kind": ["left", "right", "straight", "u_turn"],
    "restriction_kind": [
        "none",
        "no_left_turn",
        "no_right_turn",
        "no_straight_on",
        "no_u_turn",
        "only_left_turn",
        "only_right_turn",
        "only_straight_on",
    ],
}


def upgrade() -> None:
    for name, values in ENUM_TYPES.items():
        values_sql = ", ".join(f"'{value}'" for value in values)
        op.execute(f"CREATE TYPE {name} AS ENUM ({values_sql})")


def downgrade() -> None:
    for name in reversed(list(ENUM_TYPES)):
        op.execute(f"DROP TYPE {name}")
