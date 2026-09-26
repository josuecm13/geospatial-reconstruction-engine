"""Named routing strategy registry (design.md Decision 7).

Adding a strategy is a one-line registration; the route endpoint looks a name
up here and passes the instance to `RoutingEngine`.
"""

from __future__ import annotations

from app.domain.routing import RoutingStrategy
from app.domain.routing_strategies import DistanceDijkstraStrategy

DEFAULT_STRATEGY_NAME = "distance"

STRATEGIES: dict[str, type[RoutingStrategy]] = {
    "distance": DistanceDijkstraStrategy,
}


class UnknownRoutingStrategy(ValueError):
    def __init__(self, name: str):
        self.name = name
        self.registered_names = sorted(STRATEGIES)
        super().__init__(f"unknown routing strategy {name!r}; registered strategies: {self.registered_names}")


def resolve_strategy(name: str | None) -> RoutingStrategy:
    strategy_name = name or DEFAULT_STRATEGY_NAME
    strategy_cls = STRATEGIES.get(strategy_name)
    if strategy_cls is None:
        raise UnknownRoutingStrategy(strategy_name)
    return strategy_cls()
