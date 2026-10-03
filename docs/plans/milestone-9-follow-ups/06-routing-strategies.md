# 06 — List routing strategies (#109)

## Goal

`GH_TOKEN=$(gh auth token --user josuecm13) gh issue view 109`

No endpoint lists the registered routing strategies. To fill its strategy picker, the client sends a
route request that names a strategy no server registers, then reads `registered_strategies` from the
422 `unknown_routing_strategy` details. Add `GET /routing-strategies`, which returns the registered
names and the default. The client then uses it and drops the probe.

The issue's claims hold against the current code. The probe is `ApiClient.routingStrategies` in
`client/src/api/client.ts:111-135`, with `PROBE_STRATEGY` at line 32.

## Code to read first

- `server/app/routing/strategies.py` (31 lines): the registry. `DEFAULT_STRATEGY_NAME = "distance"`
  (line 12). `STRATEGIES: dict[str, type[RoutingStrategy]]` holds one entry, `distance` (lines 14-16).
  `UnknownRoutingStrategy.registered_names` is `sorted(STRATEGIES)` (line 22). `resolve_strategy`
  falls back to the default when `name` is `None` (lines 26-31).
- `server/app/api/routers/route_planning.py` (62 lines): `POST /import-areas/{id}/routes`. It maps
  `UnknownRoutingStrategy` to 422 `unknown_routing_strategy` with
  `details.registered_strategies` (lines 39-44). Keep that error contract as it is.
- `server/app/api/schemas.py`: `RouteRequest.strategy: str | None` (line 178) and `RouteOut.strategy`
  (line 186). The new response schema goes here.
- `server/app/api/routers/__init__.py` and `server/app/main.py`: how routers are registered. The new
  endpoint can live in `route_planning.py`, so no new router is needed.
- `client/src/api/client.ts`: `PROBE_STRATEGY` (line 32) and `routingStrategies(areaId)`
  (lines 111-135). Today the method fetches the area, sends a route request with `PROBE_STRATEGY` from
  the bbox centre to itself, and reads `details.registered_strategies` off the error. It caches the
  result per area and returns `[]` on any other failure.
- `client/src/api/client.test.ts`: `describe("routingStrategies")` (lines 86-123) has three probe
  tests: the names come off the error, the probe runs once per area, and any other failure gives `[]`.
- `client/src/scene/routePanel.ts`: `RoutingDeps.api.routingStrategies(areaId)` (line 11), and
  `loadStrategies` (lines 95-107). The latter re-asks whenever the area changes (`strategiesFor`), and
  falls back to a single "server default" option (value `SERVER_DEFAULT = ""`, line 20) when the list
  is empty. `setWorld` resets `strategiesFor` (line 157). `client/src/views/sceneView.ts:27,72`
  passes the deps through.
- `client/src/api/types.ts`: `Route` (around line 123) is where the new response type belongs.

## Design

**Server.** Add `GET /routing-strategies` to `route_planning.py`:

```python
class RoutingStrategiesOut(BaseModel):   # schemas.py
    strategies: list[str]   # sorted, the same order as UnknownRoutingStrategy.registered_names
    default: str

@router.get("/routing-strategies", response_model=RoutingStrategiesOut)
def list_routing_strategies() -> RoutingStrategiesOut:
    return RoutingStrategiesOut(strategies=sorted(STRATEGIES), default=DEFAULT_STRATEGY_NAME)
```

Decisions:

- **Not scoped to an import area.** The registry is global, and the issue names
  `/routing-strategies`. The endpoint needs no session and no area, so it can't fail with
  `import_area_not_found` or `import_area_not_ready`.
- **Read the registry, don't copy it.** Expose a small helper in `app/routing/strategies.py` (for
  example `registered_strategy_names() -> list[str]`), and have both the endpoint and
  `UnknownRoutingStrategy` use it. Then the list and the 422 details can't drift apart.
- The 422 `unknown_routing_strategy` error and its `registered_strategies` details stay unchanged.
  They are part of the error contract.

**Client.**

- Add `export interface RoutingStrategies { strategies: string[]; default: string }` to `types.ts`.
- Replace `routingStrategies(areaId)` with `routingStrategies(): Promise<RoutingStrategies | null>`,
  which calls `GET /routing-strategies`. Cache the first successful answer for the client's
  lifetime. Return `null` on any failure, and don't cache a failure, so a later open can try again.
  Delete `PROBE_STRATEGY` and the doc comment that explains the probe.
- `routePanel.ts`: change `RoutingDeps.api.routingStrategies` to the new signature. Load the list
  once, when the toggle is first turned on, instead of once per area. Then drop `strategiesFor`, or
  keep it only as a "loaded" flag, whichever reads more simply. Pre-select `default` rather than the
  first option. When the answer is `null`, keep today's single "server default" option, which sends no
  `strategy`.
- What's left to the implementer: whether a selection that equals `default` sends `strategy`
  explicitly or omits it. Both produce the same route. Sending the selected name matches today.

## Tests

- `server/tests/api/test_routes.py`: add
  `test_routing_strategies_lists_the_registered_names_and_the_default`. `GET /routing-strategies`
  answers 200 with `{"strategies": ["distance"], "default": "distance"}`. Add a second test that
  monkeypatches `app.routing.strategies.STRATEGIES` to add a second entry, then checks that the
  endpoint and the 422 details from `test_unknown_strategy_lists_registered_names` both list it. That
  proves both read the same registry. Neither test needs an imported area.
- `client/src/api/client.test.ts`: replace the three probe tests in `describe("routingStrategies")`:
  - it calls `GET {base}/routing-strategies` and returns the parsed body,
  - a second call makes no new request (cached),
  - a 503 returns `null`, and a later call asks again (no cached failure).
- `routePanel.ts` needs WebGL and has no test today, so add none. If you pull the option-building
  logic out into a pure function, test that function.
- Guard tests can't be mutation-checked without local runs. Say so in the commit body and the
  Outcome.

## Docs and specs

- `openspec/specs/route-api/spec.md`: add `### Requirement: The API SHALL list the registered routing
  strategies`. `GET /routing-strategies` SHALL return the registered strategy names and the default
  used when a route request names none. Add a scenario: WHEN a client lists the strategies, THEN the
  response holds every name `POST …/routes` accepts and the default `distance`, and the same names
  appear in an `unknown_routing_strategy` error's details.
- `openspec/specs/showcase-client/spec.md`, the route requirement at line 85: the picker SHALL list
  the strategies from `GET /routing-strategies`, with the default pre-selected, and send no strategy
  when that list cannot be read. Replace the sentence about reading `unknown_routing_strategy`
  details.
- `docs/client-features.md` → Routing: add a row "List registered strategies and the default |
  `GET /routing-strategies` | shipped | done | The route picker". In the "Named strategy" row
  (line 62), change the client note to say the picker is read from `GET /routing-strategies`, and drop
  the "build it from `details.registered_strategies`" note.
- `docs/architecture.md`, the endpoint list (around lines 94-95): add a bullet for
  `GET /routing-strategies`.
- `HOW_TO_RUN.md` has curl examples. Adding a one-line example is optional.

## Outcome

## Tangents found
