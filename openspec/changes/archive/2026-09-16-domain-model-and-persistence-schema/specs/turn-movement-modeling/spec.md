## Purpose

Represents every plausible turn a vehicle can make at an intersection, so routing can determine legality with a single lookup instead of inferring it from absence of data.

## ADDED Requirements

### Requirement: Every geometrically plausible turn at an intersection SHALL have a turn movement record
For each navigable intersection node, the system SHALL persist one turn movement record for every geometrically plausible pairing of an incoming road segment (ending at the node) with an outgoing road segment (starting at the node).

#### Scenario: An intersection with multiple approaches
- **WHEN** an intersection node has two incoming segments and two outgoing segments
- **THEN** the system persists one turn movement record per incoming/outgoing pair

### Requirement: A turn movement SHALL be classified by its geometry
The system SHALL classify each turn movement as left, right, straight, or U-turn based on the relative bearing of its incoming and outgoing segments.

#### Scenario: A U-turn onto the opposite-direction segment
- **WHEN** a turn movement's outgoing segment is the opposite-direction segment of the same road as its incoming segment
- **THEN** the system classifies it as a U-turn

### Requirement: A turn movement SHALL default to allowed unless a source restriction states otherwise
The system SHALL mark a turn movement as allowed unless a source turn-restriction relation explicitly prohibits or restricts it, in which case the movement SHALL be marked not allowed with its restriction kind recorded.

#### Scenario: No matching source restriction
- **WHEN** a turn movement has no corresponding source turn-restriction relation
- **THEN** the system marks it allowed with restriction kind "none"

#### Scenario: A matching source restriction
- **WHEN** a turn movement corresponds to a source turn-restriction relation that prohibits it
- **THEN** the system marks it not allowed and records the restriction kind

### Requirement: A turn movement's segments SHALL meet at its stated intersection node
The system SHALL reject persisting a turn movement whose incoming segment does not end at its stated intersection node, or whose outgoing segment does not start at its stated intersection node.

#### Scenario: Incoming segment does not end at the intersection
- **WHEN** a turn movement is persisted whose incoming segment's `to_node` does not match the stated intersection node
- **THEN** the system rejects the write

#### Scenario: Outgoing segment does not start at the intersection
- **WHEN** a turn movement is persisted whose outgoing segment's `from_node` does not match the stated intersection node
- **THEN** the system rejects the write
