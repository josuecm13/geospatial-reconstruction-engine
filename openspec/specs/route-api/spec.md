# route-api Specification

## Purpose

Exposes turn-aware route planning over HTTP between two coordinates within an import area, with the search strategy chosen by name.

## Requirements

### Requirement: The API SHALL plan a route between two coordinates
The API SHALL expose `POST /import-areas/{id}/routes` taking an origin coordinate, a destination coordinate, and an optional strategy name, and SHALL return the route's ordered node ids, ordered segment ids, GeoJSON `LineString` geometry, total distance in meters, the strategy used, the node ids the origin and destination were snapped to, and the distance in meters from each requested coordinate to its snapped node. The API SHALL NOT reject a coordinate for being far from the road network.

#### Scenario: Reachable destination
- **WHEN** a client requests a route between two coordinates connected by legal moves
- **THEN** the response has status 200 and a route whose segments form a continuous path from the snapped origin node to the snapped destination node

#### Scenario: Snap distance is reported
- **WHEN** a client requests a route from a coordinate some distance away from the nearest navigable node
- **THEN** the response reports that coordinate's distance in meters to its snapped node

#### Scenario: Origin and destination snap to the same node
- **WHEN** a client requests a route whose origin and destination both snap to the same navigable node
- **THEN** the response has status 200, a single node id, no segment ids, a null geometry, and a total distance of zero

#### Scenario: Out-of-range coordinate
- **WHEN** a client requests a route with an origin or destination latitude outside [-90, 90] or longitude outside [-180, 180]
- **THEN** the response is a 422 error with code `invalid_coordinate`

#### Scenario: Deterministic result
- **WHEN** a client sends the same route request twice against unchanged data
- **THEN** both responses contain identical node ids, segment ids, and total distance

#### Scenario: Prohibited turn is avoided
- **WHEN** the shortest geometric path requires a turn the imported data prohibits
- **THEN** the returned route takes a legal alternative instead

### Requirement: The API SHALL let the caller select a routing strategy by name
The API SHALL accept a strategy name from a fixed set of registered strategies, SHALL default to `distance` when none is given, and SHALL reject a name that is not registered.

#### Scenario: Default strategy
- **WHEN** a client requests a route without naming a strategy
- **THEN** the route is computed with the `distance` strategy and the response reports `distance` as the strategy used

#### Scenario: Unknown strategy
- **WHEN** a client requests a route with a strategy name that is not registered
- **THEN** the response is a 422 error with code `unknown_routing_strategy` whose details list the registered strategy names

### Requirement: The API SHALL report unroutable requests distinctly
The API SHALL distinguish a request that cannot be snapped onto the road network from one whose snapped endpoints are not connected by any legal path.

#### Scenario: Disconnected destination
- **WHEN** a client requests a route to a coordinate whose nearest node is unreachable from the origin by legal moves
- **THEN** the response is a 422 error with code `no_route_found`

#### Scenario: No road network to snap onto
- **WHEN** a client requests a route in a completed import area with no navigable nodes
- **THEN** the response is a 422 error with code `no_navigable_node`

#### Scenario: Import area not ready
- **WHEN** a client requests a route in an import area that is unknown or not `completed`
- **THEN** the response is a 404 error with code `import_area_not_found` or a 409 error with code `import_area_not_ready` respectively
