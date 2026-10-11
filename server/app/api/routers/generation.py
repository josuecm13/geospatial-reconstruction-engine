"""Generated block content: generating an area's buildings in the background, reading and deleting
the run, and people's per-block feedback that the next generation applies (contract 8)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.api.background_import import generation_work
from app.api.dependencies import (
    SessionScope,
    completed_import_area,
    get_import_jobs,
    get_job_session_scope,
    get_session,
    import_area as import_area_dependency,
)
from app.api.errors import ApiError
from app.api.mappers import block_feedback_entry_out, block_feedback_out, generation_run_out
from app.api.routers.import_areas import _import_in_progress
from app.api.schemas import (
    BlockFeedbackIn,
    BlockFeedbackListOut,
    BlockFeedbackOut,
    GenerationRequest,
    GenerationRunOut,
    ImportStartedOut,
)
from app.domain.generation import BlockFeedback
from app.domain.import_area import ImportArea
from app.generation.run import stale_reasons
from app.ingestion.jobs import ImportAlreadyRunning, ImportJobRegistry
from app.persistence.repositories.block import BlockRepository
from app.persistence.repositories.generation import BlockFeedbackRepository, GenerationRepository

router = APIRouter(tags=["generation"])

DEFAULT_SEED = 1


@router.post(
    "/import-areas/{import_area_id}/generation",
    status_code=202,
    response_model=ImportStartedOut,
)
def generate(
    body: GenerationRequest | None = None,
    area: ImportArea = Depends(completed_import_area),
    session: Session = Depends(get_session),
    jobs: ImportJobRegistry = Depends(get_import_jobs),
    session_scope: SessionScope = Depends(get_job_session_scope),
) -> JSONResponse:
    """Generates the area's buildings in the background, replacing its current run in one
    transaction. Streams on `events_url`: one `generation` event (`block_count`, the eligible
    blocks), then `completed` (`run`) or `failed`. The seed is the body's, else the current run's,
    else 1. Imports, re-analyses and generations of one area share the job registry."""
    seed = body.seed if body is not None and body.seed is not None else None
    if seed is None:
        current = GenerationRepository(session).get_run(area.id)
        seed = current.seed if current is not None else DEFAULT_SEED
    try:
        jobs.start(area.id, generation_work(area, seed, session_scope))
    except ImportAlreadyRunning as exc:
        raise _import_in_progress(area.id) from exc
    started = ImportStartedOut(import_area_id=area.id, events_url=f"/import-areas/{area.id}/events")
    return JSONResponse(status_code=202, content=started.model_dump(mode="json"))


@router.get("/import-areas/{import_area_id}/generation", response_model=GenerationRunOut)
def get_generation(
    area: ImportArea = Depends(import_area_dependency), session: Session = Depends(get_session)
) -> GenerationRunOut:
    run = GenerationRepository(session).get_run(area.id)
    if run is None:
        raise _generation_not_found(area.id)
    return generation_run_out(run, stale_reasons(session, area, run))


@router.delete("/import-areas/{import_area_id}/generation", status_code=204)
def delete_generation(
    area: ImportArea = Depends(import_area_dependency),
    session: Session = Depends(get_session),
    jobs: ImportJobRegistry = Depends(get_import_jobs),
) -> Response:
    """Removes the area's run and every generated building and zone with it. Observed data is not
    touched. Refused while a job of the area is running, which would write the run back."""
    if jobs.is_running(area.id):
        raise _import_in_progress(area.id)
    if not GenerationRepository(session).delete(area.id):
        raise _generation_not_found(area.id)
    session.commit()
    return Response(status_code=204)


@router.put("/blocks/{block_id}/feedback", response_model=BlockFeedbackOut)
def put_block_feedback(
    block_id: uuid.UUID, body: BlockFeedbackIn, session: Session = Depends(get_session)
) -> BlockFeedbackOut:
    """How many buildings the block really has, or that it has none. It applies on the next
    generation, which uses it instead of the block's own count."""
    area_id = BlockRepository(session).get_import_area_id(block_id)
    if area_id is None:
        raise ApiError(404, "block_not_found", f"block {block_id} not found")
    stored = BlockFeedbackRepository(session).put(
        BlockFeedback(
            block_id=block_id,
            import_area_id=area_id,
            building_count=body.building_count,
            no_buildings=body.no_buildings is True,
        )
    )
    session.commit()
    return block_feedback_out(stored)


@router.delete("/blocks/{block_id}/feedback", status_code=204)
def delete_block_feedback(block_id: uuid.UUID, session: Session = Depends(get_session)) -> Response:
    if not BlockFeedbackRepository(session).delete(block_id):
        raise ApiError(404, "feedback_not_found", f"block {block_id} has no feedback")
    session.commit()
    return Response(status_code=204)


@router.get("/import-areas/{import_area_id}/feedback", response_model=BlockFeedbackListOut)
def list_feedback(
    area: ImportArea = Depends(import_area_dependency), session: Session = Depends(get_session)
) -> BlockFeedbackListOut:
    """The area's feedback, each entry flagged `orphaned` when its block no longer exists."""
    entries = BlockFeedbackRepository(session).list_for_import_area(area.id)
    return BlockFeedbackListOut(feedback=[block_feedback_entry_out(entry) for entry in entries])


def _generation_not_found(area_id) -> ApiError:
    return ApiError(404, "generation_not_found", f"import area {area_id} has no generation")
