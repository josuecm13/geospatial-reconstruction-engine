import math
import uuid

import pytest

from app.domain.block import Block
from app.domain.bounding_box import Coordinate
from app.domain.generation import BlockEligibility, eligibility

_RING = (Coordinate(0, 0), Coordinate(0, 1), Coordinate(1, 1), Coordinate(0, 0))


def _block(**overrides) -> Block:
    fields = dict(
        id=uuid.uuid4(),
        import_area_id=uuid.uuid4(),
        boundary=_RING,
        area_square_meters=1000.0,
        buildable_area=(_RING,),
        buildable_area_square_meters=500.0,
    )
    fields.update(overrides)
    return Block(**fields)


def test_a_whole_block_with_room_is_eligible():
    assert eligibility(_block()) is BlockEligibility.ELIGIBLE


def test_clipped_wins_over_every_other_reason():
    block = _block(is_clipped=True, is_median=True, buildable_area=None)
    assert eligibility(block) is BlockEligibility.CLIPPED


def test_median_wins_over_no_buildable_area():
    assert eligibility(_block(is_median=True, buildable_area=None)) is BlockEligibility.MEDIAN


@pytest.mark.parametrize("area", [None, ()])
def test_no_buildable_area(area):
    block = _block(buildable_area=area, buildable_area_square_meters=0.0)
    expected = BlockEligibility.NO_BUILDABLE_AREA
    assert eligibility(block) is expected


def test_buildable_area_under_30_square_meters_is_not_eligible():
    assert eligibility(_block(buildable_area_square_meters=29.9)) is BlockEligibility.NO_BUILDABLE_AREA
    assert eligibility(_block(buildable_area_square_meters=30.0)) is BlockEligibility.ELIGIBLE


# --- fingerprints and defaults ---

from app.domain.enums import RoadClassification  # noqa: E402
from app.domain.generation import (  # noqa: E402
    BuildingMeasure,
    RoadClassGroup,
    SettlementStyle,
    coverage_ratio,
    default_fingerprint,
    fingerprint_of,
    iqr,
    median,
    qualifies_as_exemplar,
    side_gaps,
    strongest_road_group,
    union_length,
)


def test_a_row_of_five_attached_houses_has_no_gaps_and_covers_the_whole_edge():
    intervals = [(8.0 * index, 8.0 * (index + 1)) for index in range(5)]

    assert side_gaps(intervals) == [0.0, 0.0, 0.0, 0.0]
    assert coverage_ratio(union_length(intervals), 40.0) == pytest.approx(1.0)


def test_detached_houses_have_a_gap_equal_to_the_spacing():
    intervals = [(10.0 + 8.0 * index, 16.0 + 8.0 * index) for index in range(5)]

    assert side_gaps(intervals) == [2.0, 2.0, 2.0, 2.0]


def test_gaps_ignore_input_order_and_floor_overlaps_at_zero():
    assert side_gaps([(20.0, 30.0), (0.0, 12.0), (10.0, 15.0)]) == [0.0, 5.0]


def test_union_length_counts_overlaps_once():
    assert union_length([(0.0, 10.0), (5.0, 12.0), (20.0, 25.0)]) == 17.0
    assert union_length([]) == 0.0


def test_median_and_iqr():
    assert median([1.0, 3.0, 2.0]) == 2.0
    assert iqr([1.0, 2.0, 3.0, 4.0, 5.0]) == 2.0
    assert iqr([7.0]) == 0.0


@pytest.mark.parametrize(
    ("coverage", "count", "expected"),
    [(0.70, 3, True), (0.69, 3, False), (1.0, 2, False), (0.9, 5, True)],
)
def test_exemplar_needs_70_percent_coverage_and_three_buildings(coverage, count, expected):
    assert qualifies_as_exemplar(BlockEligibility.ELIGIBLE, coverage, count) is expected


def test_an_ineligible_block_is_never_an_exemplar():
    assert qualifies_as_exemplar(BlockEligibility.CLIPPED, 1.0, 10) is False


def test_fingerprint_of_measures():
    measures = [
        BuildingMeasure(0, 8.0 * i, 8.0 * i + width, width, 10.0, 4.0, width * 10.0, levels)
        for i, (width, levels) in enumerate([(6.0, 2), (8.0, None), (10.0, 4)])
    ]

    result = fingerprint_of(measures, [2.0, 2.0], 0.8, SettlementStyle.REGULAR)

    assert result.width.median == 8.0
    assert result.depth.iqr == 0.0
    assert result.front_setback.median == 4.0
    assert result.side_gap.median == 2.0
    assert result.median_levels == 3.0
    assert result.coverage == 0.8
    assert result.style is SettlementStyle.REGULAR


def test_fingerprint_without_levels_or_gaps():
    measures = [BuildingMeasure(0, 0.0, 6.0, 6.0, 8.0, 3.0, 48.0, None)]

    result = fingerprint_of(measures, [], 0.3, SettlementStyle.REGULAR)

    assert result.median_levels is None
    assert result.side_gap.median == 0.0


def _numbers(fingerprint):
    return (
        fingerprint.width.median,
        fingerprint.depth.median,
        fingerprint.front_setback.median,
        fingerprint.side_gap.median,
        fingerprint.median_levels,
    )


@pytest.mark.parametrize(
    ("group", "expected"),
    [
        (RoadClassGroup.LOCAL, (10.0, 12.0, 4.0, 3.0, 2.0)),
        (RoadClassGroup.COLLECTOR, (14.0, 16.0, 2.0, 1.0, 3.0)),
        (RoadClassGroup.ARTERIAL, (18.0, 20.0, 1.0, 0.0, 5.0)),
    ],
)
def test_defaults_by_road_class(group, expected):
    result = default_fingerprint(group, SettlementStyle.REGULAR)

    assert _numbers(result) == expected
    assert result.coverage is None


def test_sparse_defaults_stretch_the_gap_four_times():
    result = default_fingerprint(RoadClassGroup.LOCAL, SettlementStyle.SPARSE)

    assert result.side_gap.median == 12.0
    assert result.width.median == 10.0


@pytest.mark.parametrize("group", list(RoadClassGroup))
def test_informal_defaults_ignore_the_road_class(group):
    result = default_fingerprint(group, SettlementStyle.INFORMAL)

    assert _numbers(result) == (6.0, 7.0, 0.5, 0.5, 1.0)
    assert result.style is SettlementStyle.INFORMAL


def test_strongest_bounding_road_decides_the_group():
    classes = [RoadClassification.RESIDENTIAL, RoadClassification.SECONDARY, RoadClassification.SERVICE]

    assert strongest_road_group(classes) is RoadClassGroup.COLLECTOR
    assert strongest_road_group([RoadClassification.TRUNK, RoadClassification.PRIMARY]) is RoadClassGroup.ARTERIAL
    assert strongest_road_group([RoadClassification.UNCLASSIFIED]) is RoadClassGroup.LOCAL
    assert strongest_road_group([]) is RoadClassGroup.LOCAL


# --- matching ---

from app.domain.generation import (  # noqa: E402
    MatchProfile,
    ReferenceCandidate,
    best_reference,
    match_score,
)

_SUBJECT = MatchProfile(RoadClassGroup.LOCAL, 4000.0, SettlementStyle.REGULAR)


def _candidate(block_id, distance_m=100.0, group=RoadClassGroup.LOCAL, area=4000.0, style=SettlementStyle.REGULAR):
    return ReferenceCandidate(block_id, distance_m, MatchProfile(group, area, style))


def test_a_perfect_neighbour_at_the_same_spot_scores_zero():
    assert match_score(_SUBJECT, _candidate(uuid.uuid4(), distance_m=0.0)) == 0.0


def test_score_adds_distance_class_area_and_style_terms():
    candidate = _candidate(uuid.uuid4(), distance_m=250.0, group=RoadClassGroup.ARTERIAL, area=8000.0, style=SettlementStyle.SPARSE)

    score = match_score(_SUBJECT, candidate)

    assert score == pytest.approx(0.5 + 1.0 + math.log(2) + 1.0)


def test_scoring_prefers_near_same_class_similar_area_same_style():
    ids = [uuid.UUID(int=n) for n in range(1, 6)]
    best = _candidate(ids[0], distance_m=50.0)
    farther = _candidate(ids[1], distance_m=300.0)
    other_class = _candidate(ids[2], distance_m=50.0, group=RoadClassGroup.COLLECTOR)
    other_area = _candidate(ids[3], distance_m=50.0, area=40000.0)
    other_style = _candidate(ids[4], distance_m=50.0, style=SettlementStyle.INFORMAL)

    chosen = best_reference(_SUBJECT, [other_style, other_area, other_class, farther, best])

    assert chosen is best
    for worse in (farther, other_class, other_area, other_style):
        assert match_score(_SUBJECT, worse) > match_score(_SUBJECT, best)


def test_equal_scores_break_on_the_lowest_block_id():
    low, high = uuid.UUID(int=1), uuid.UUID(int=2)

    assert best_reference(_SUBJECT, [_candidate(high), _candidate(low)]).block_id == low
    assert best_reference(_SUBJECT, [_candidate(low), _candidate(high)]).block_id == low


def test_no_candidate_within_500_metres_means_defaults():
    assert best_reference(_SUBJECT, []) is None
    assert best_reference(_SUBJECT, [_candidate(uuid.uuid4(), distance_m=500.1)]) is None
    assert best_reference(_SUBJECT, [_candidate(uuid.uuid4(), distance_m=500.0)]) is not None


from app.domain.generation import (  # noqa: E402
    BlockFeedback,
    InvalidBlockFeedback,
    StaleReason,
    fingerprint_from_dict,
    fingerprint_to_dict,
    road_graph_hash,
    stale_reasons,
)


def test_block_feedback_needs_exactly_one_of_count_or_no_buildings():
    block_id, area_id = uuid.uuid4(), uuid.uuid4()
    assert BlockFeedback(block_id, area_id, building_count=0).target_count == 0
    assert BlockFeedback(block_id, area_id, no_buildings=True).target_count == 0
    for kwargs in ({}, {"building_count": 2, "no_buildings": True}, {"building_count": -1}):
        with pytest.raises(InvalidBlockFeedback):
            BlockFeedback(block_id, area_id, **kwargs)


def test_the_road_graph_hash_ignores_order_and_changes_with_the_block_set():
    first, second = uuid.uuid4(), uuid.uuid4()
    assert road_graph_hash([first, second]) == road_graph_hash([second, first])
    assert road_graph_hash([first, second]) != road_graph_hash([first])


def test_a_run_is_stale_when_its_blocks_or_its_terrain_differ():
    same = dict(run_road_graph_hash="a", current_road_graph_hash="a")
    assert stale_reasons(**same, run_elevation_version=None, current_elevation_version=None) == []
    assert stale_reasons(
        run_road_graph_hash="a", current_road_graph_hash="b", run_elevation_version=1, current_elevation_version=2
    ) == [StaleReason.ROADS_CHANGED, StaleReason.TERRAIN_CHANGED]
    assert stale_reasons(**same, run_elevation_version=None, current_elevation_version=1) == [StaleReason.TERRAIN_CHANGED]


def test_sampled_dimensions_are_seeded_and_clamped_to_half_and_one_and_a_half_times_the_median():
    import random

    from app.domain.generation import Spread, sample_dimension

    wide = Spread(10.0, 100.0)  # a huge spread: draws hit the clamps
    draws = [sample_dimension(random.Random(f"s:{index}"), wide) for index in range(200)]
    assert min(draws) == 5.0 and max(draws) == 15.0
    assert sample_dimension(random.Random("a"), wide) == sample_dimension(random.Random("a"), wide)
    assert sample_dimension(random.Random("a"), Spread(0.0, 0.0)) == 0.0


def test_evenly_spaced_indices_are_distinct_ordered_and_spread_out():
    from app.domain.generation import evenly_spaced_indices

    assert evenly_spaced_indices(10, 3) == [1, 5, 8]
    assert evenly_spaced_indices(4, 4) == [0, 1, 2, 3]
    assert evenly_spaced_indices(3, 9) == [0, 1, 2]
    assert evenly_spaced_indices(5, 0) == []


def test_the_calibration_factor_needs_two_blocks_and_is_clamped():
    from app.domain.generation import calibration_factor, with_narrower_lots

    assert calibration_factor([4], [2]) is None
    assert calibration_factor([4, 2], [2, 2]) == pytest.approx(1.5)
    assert calibration_factor([40, 20], [2, 2]) == 2.0
    assert calibration_factor([1, 0], [8, 8]) == 0.5
    assert calibration_factor([1, 1], [0, 0]) is None

    base = default_fingerprint(RoadClassGroup.LOCAL, SettlementStyle.REGULAR)
    narrower = with_narrower_lots(base, 2.0)
    assert narrower.width.median == base.width.median / 2 and narrower.depth == base.depth


def test_a_fingerprint_survives_its_json_form():
    original = default_fingerprint(RoadClassGroup.COLLECTOR, SettlementStyle.SPARSE)
    assert fingerprint_from_dict(fingerprint_to_dict(original)) == original
