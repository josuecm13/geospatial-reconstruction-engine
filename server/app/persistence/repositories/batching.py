from collections.abc import Iterable, Iterator, Sequence
from typing import TypeVar

T = TypeVar("T")

# Keeps an `IN (...)` prefetch well under the driver's bind-parameter limit.
_CHUNK_SIZE = 5000


def chunked(values: Iterable[T], size: int = _CHUNK_SIZE) -> Iterator[Sequence[T]]:
    batch: list[T] = []
    for value in values:
        batch.append(value)
        if len(batch) == size:
            yield batch
            batch = []
    if batch:
        yield batch
