import uuid

import pytest

from app.domain.block_identity import BlockKeyInput, block_id_for, block_ids_for

AREA = uuid.UUID("11111111-1111-1111-1111-111111111111")
OTHER_AREA = uuid.UUID("22222222-2222-2222-2222-222222222222")
S1, S2, S3 = (uuid.UUID(f"00000000-0000-0000-0000-00000000000{n}") for n in (1, 2, 3))


@pytest.mark.parametrize(
    ("first", "second", "same"),
    [
        ((AREA, frozenset({S1, S2})), (AREA, frozenset({S2, S1})), True),
        ((AREA, frozenset({S1, S2})), (AREA, frozenset({S1, S2, S3})), False),
        ((AREA, frozenset({S1, S2})), (OTHER_AREA, frozenset({S1, S2})), False),
    ],
    ids=["order-independent", "one-more-segment", "other-area"],
)
def test_block_id_depends_on_area_and_segment_set_only(first, second, same):
    assert (block_id_for(*first) == block_id_for(*second)) is same


def test_block_id_is_stable_across_calls():
    assert block_id_for(AREA, frozenset({S1, S2})) == block_id_for(AREA, frozenset({S1, S2}))


def test_faces_with_the_same_segments_get_distinct_ids_independent_of_input_order():
    south = BlockKeyInput(frozenset({S1}), (-84.0, 9.0))
    north = BlockKeyInput(frozenset({S1}), (-84.0, 9.1))
    other = BlockKeyInput(frozenset({S2, S3}), (-83.0, 9.0))

    forward = block_ids_for(AREA, [south, north, other])
    backward = block_ids_for(AREA, [other, north, south])

    assert len(set(forward)) == 3
    assert forward == [backward[2], backward[1], backward[0]]
    assert forward[2] == block_id_for(AREA, frozenset({S2, S3}))
