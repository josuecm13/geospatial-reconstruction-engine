## Purpose

Exposes the persisted road network as a directed, provider-neutral graph whose legal moves already honour recorded turn restrictions, so traversal and routing can consume it without touching SQL, OSM types, or restriction semantics.

## ADDED Requirements

### Requirement: The graph SHALL be built from persisted data without provider-specific types
The system SHALL build a road graph for an import area from the persisted road segments and turn movements. The graph interface SHALL expose only domain types; callers SHALL NOT need SQLAlchemy sessions, persistence rows, or OSM identifiers to traverse it.

#### Scenario: Graph built for an imported area
- **WHEN** a road graph is built for an import area holding persisted segments and turn movements
- **THEN** the graph exposes its nodes and edges as domain types, with no provider-specific or persistence types in its interface

#### Scenario: Graph scoped to its import area
- **WHEN** a road graph is built for one import area while another import area also holds segments
- **THEN** the graph contains only the segments and movements of the requested import area

### Requirement: A graph edge SHALL correspond to one directed road segment and expose its persisted distance
Each graph edge SHALL correspond to exactly one persisted road segment, preserving that segment's direction, and SHALL expose the segment's already-persisted `distance_meters` as its traversal cost. The graph SHALL NOT recompute or substitute that distance.

#### Scenario: Edge direction follows its segment
- **WHEN** a one-way road has been persisted as a single directed segment
- **THEN** the graph exposes exactly one corresponding edge, traversable only in that segment's direction

#### Scenario: Edge cost comes from the segment
- **WHEN** a graph edge is inspected
- **THEN** its traversal cost equals its road segment's persisted `distance_meters` and is non-negative

### Requirement: Traversal SHALL offer only movements recorded as allowed
When continuing from an incoming segment through an intersection, the graph SHALL offer exactly those outgoing segments whose turn movement is recorded as allowed. A movement recorded as not allowed SHALL NOT be offered as a legal move, regardless of the restriction kind that caused it.

#### Scenario: A prohibited turn
- **WHEN** traversal continues from an incoming segment whose turn movement to a given outgoing segment is recorded as not allowed
- **THEN** that outgoing segment is not offered as a legal move

#### Scenario: An only-turn restriction
- **WHEN** an only-turn restriction has marked the competing movements from an incoming segment as not allowed
- **THEN** traversal from that incoming segment offers only the permitted outgoing segment

#### Scenario: An unrestricted intersection
- **WHEN** traversal continues from an incoming segment at an intersection carrying no prohibiting restrictions
- **THEN** every outgoing segment whose movement is recorded as allowed is offered

### Requirement: Departing from a node SHALL not require an incoming segment
Traversal starting at a navigable node, rather than continuing from an incoming segment, SHALL offer every outgoing segment of that node, because no turn is being made.

#### Scenario: Starting at an intersection
- **WHEN** traversal starts at a navigable node that has several outgoing segments
- **THEN** all of its outgoing segments are offered, including any that would be prohibited as a turn from some incoming segment

### Requirement: Traversal SHALL exclude segments not accessible to vehicles
The graph SHALL omit road segments persisted as not vehicle-accessible, so they are never offered as legal moves.

#### Scenario: A segment marked not vehicle-accessible
- **WHEN** a road segment is persisted as not vehicle-accessible
- **THEN** the graph exposes no edge for it

### Requirement: Traversal SHALL preserve network connectivity and disconnection
Reachability through the graph SHALL follow the persisted network: nodes joined by allowed movements SHALL be reachable from one another, and nodes in separate components SHALL NOT be.

#### Scenario: Connected intersections
- **WHEN** two navigable nodes are joined by a chain of segments with allowed movements
- **THEN** traversal from the first reaches the second

#### Scenario: Disconnected components
- **WHEN** an import area contains two groups of segments that share no navigable node
- **THEN** traversal from a node in one group never reaches a node in the other
