# route-planning Specification

## Purpose

Produces a vehicle route between two coordinates over the imported road network through a substitutable strategy, honouring turn legality and reporting an explicit outcome when no legal route exists.

## Requirements

### Requirement: A route request SHALL be prepared by snapping coordinates to navigable entry points
The system SHALL accept arbitrary origin and destination coordinates and resolve each to its nearest navigable node within the import area before searching. When an import area holds no navigable node to snap to, the request SHALL fail with an actionable error rather than returning an empty route.

#### Scenario: Coordinates that do not fall on a node
- **WHEN** a route is requested between two coordinates that do not coincide with any navigable node
- **THEN** each coordinate is resolved to its nearest navigable node and the search runs between those nodes

#### Scenario: Import area with no navigable nodes
- **WHEN** a route is requested within an import area that holds no navigable nodes
- **THEN** the system returns an actionable error stating that the coordinates could not be snapped to the network

### Requirement: A route SHALL only traverse legal movements
A produced route SHALL never contain a transition whose turn movement is recorded as not allowed. When the only shorter path requires a prohibited turn, the system SHALL return a longer legal route instead of the prohibited one.

#### Scenario: A shorter path requires a prohibited turn
- **WHEN** the shortest geometric path between origin and destination requires a turn movement recorded as not allowed, and a longer legal alternative exists
- **THEN** the returned route follows the legal alternative and contains no prohibited transition

#### Scenario: Every alternative is prohibited
- **WHEN** every path to the destination requires a prohibited turn
- **THEN** the system reports that no route exists rather than returning a route containing that turn

### Requirement: A successful route SHALL report its nodes, segments, geometry, and total distance
A route result SHALL contain the ordered navigable nodes visited, the ordered road segments traversed, the route geometry, and the total distance in meters. The reported total distance SHALL equal the sum of the traversed segments' distances.

#### Scenario: Route result contents
- **WHEN** a route is found between two nodes
- **THEN** the result contains the ordered nodes, the ordered traversed segments, the route geometry, and a total distance in meters

#### Scenario: Total distance is consistent with the traversed segments
- **WHEN** a route traverses several segments
- **THEN** its reported total distance equals the sum of those segments' distances

### Requirement: An unreachable destination SHALL produce an explicit no-route outcome
When no legal path exists between the prepared origin and destination, the system SHALL report that outcome explicitly. It SHALL NOT return an empty or zero-length route that a caller could mistake for a successful result.

#### Scenario: Destination in a disconnected component
- **WHEN** the destination lies in a part of the network with no legal path from the origin
- **THEN** the system reports an explicit no-route outcome distinguishable from a successful route

### Requirement: The first strategy SHALL minimise total travelled distance
The initial routing strategy SHALL select, among legal routes, one whose total distance in meters is minimal, using each segment's persisted distance as its cost.

#### Scenario: Two legal routes of different lengths
- **WHEN** two legal routes connect origin and destination with different total distances
- **THEN** the strategy returns the route with the smaller total distance

### Requirement: Routing strategies SHALL be substitutable without changing the engine
The routing engine SHALL depend on a strategy contract rather than a specific algorithm, so an alternate strategy can be supplied without modifying the engine. Routing SHALL depend only on the graph abstraction, not on SQL, persistence models, or provider-specific types.

#### Scenario: An alternate strategy is supplied
- **WHEN** a different strategy implementing the contract is supplied to the engine
- **THEN** the engine produces that strategy's route without any change to the engine itself

#### Scenario: Repeated identical requests
- **WHEN** the same route request is issued twice against unchanged data
- **THEN** the system returns the same route both times
