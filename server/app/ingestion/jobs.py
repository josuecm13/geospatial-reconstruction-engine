"""In-process background import jobs and the stage events they publish.

No broker and no persistence: a job lives in this process's memory, and a server restart drops it.
That is safe because a job's work is one all-or-nothing transaction, so a lost job has committed
nothing. Subscribers follow a job by polling `events_after`; a job never depends on them.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from collections.abc import Callable
from concurrent.futures import Executor, ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

TERMINAL_STAGES = frozenset({"completed", "failed"})
RETENTION_SECONDS = 600.0


@dataclass(frozen=True)
class StageEvent:
    id: int  # 1, 2, 3, … within one job; an SSE client resumes after the last one it saw
    stage: str
    data: dict[str, Any]


class ImportAlreadyRunning(Exception):
    def __init__(self, area_id: uuid.UUID):
        super().__init__(f"an import of area {area_id} is already running")
        self.area_id = area_id


@dataclass
class ImportJob:
    area_id: uuid.UUID
    events: list[StageEvent] = field(default_factory=list)
    done: bool = False
    finished_at: float | None = None
    condition: threading.Condition = field(default_factory=threading.Condition, repr=False)

    def emit(self, stage: str, data: dict[str, Any]) -> None:
        with self.condition:
            self.events.append(StageEvent(id=len(self.events) + 1, stage=stage, data=data))
            if stage in TERMINAL_STAGES:
                self.done = True
                self.finished_at = time.monotonic()
            self.condition.notify_all()

    def events_after(self, last_event_id: int = 0) -> tuple[list[StageEvent], bool]:
        """The events with an id above `last_event_id`, and whether the job is finished."""
        with self.condition:
            return self.events[last_event_id:], self.done


class ImportJobRegistry:
    """The running and recently finished jobs, one per import area."""

    def __init__(
        self,
        executor: Executor | None = None,
        retention_seconds: float = RETENTION_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ):
        self._executor = executor or ThreadPoolExecutor(max_workers=2, thread_name_prefix="import-job")
        self._retention_seconds = retention_seconds
        self._clock = clock
        self._lock = threading.Lock()
        self._jobs: dict[uuid.UUID, ImportJob] = {}

    def start(self, area_id: uuid.UUID, work: Callable[[ImportJob], None]) -> ImportJob:
        """Runs `work(job)` in the background. `work` publishes its stages with `job.emit` and
        ends with `completed` or `failed`; if it raises without having done so, the job fails."""
        with self._lock:
            self._drop_expired()
            existing = self._jobs.get(area_id)
            if existing is not None and not existing.done:
                raise ImportAlreadyRunning(area_id)
            job = ImportJob(area_id=area_id)
            self._jobs[area_id] = job
        self._executor.submit(self._run, job, work)
        return job

    def get(self, area_id: uuid.UUID) -> ImportJob | None:
        with self._lock:
            self._drop_expired()
            return self._jobs.get(area_id)

    def is_running(self, area_id: uuid.UUID) -> bool:
        job = self.get(area_id)
        return job is not None and not job.done

    @staticmethod
    def _run(job: ImportJob, work: Callable[[ImportJob], None]) -> None:
        try:
            work(job)
        except Exception as exc:  # the work reports its own failures; this is the safety net
            logger.exception("import job for area %s crashed", job.area_id)
            if not job.done:
                job.emit("failed", {"code": "internal_error", "message": str(exc), "details": None})
        else:
            if not job.done:
                job.emit("failed", {"code": "internal_error", "message": "the import ended without a result", "details": None})

    def _drop_expired(self) -> None:
        now = self._clock()
        for area_id, job in list(self._jobs.items()):
            if job.finished_at is not None and now - job.finished_at > self._retention_seconds:
                del self._jobs[area_id]


_registry: ImportJobRegistry | None = None


def get_registry() -> ImportJobRegistry:
    """The process-wide registry, created on first use."""
    global _registry
    if _registry is None:
        _registry = ImportJobRegistry()
    return _registry
