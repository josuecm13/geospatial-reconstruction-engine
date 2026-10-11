# site-settings Specification

## Purpose

Stores the small site-wide choices the showcase needs, starting with the featured import area that the landing page opens on. The setting names a completed area and is cleared when that area is deleted, so the landing page never points at a place that no longer exists.

## Requirements

### Requirement: The API SHALL report and set the featured import area
The API SHALL return the featured import area's id, or none when no area is featured. Setting it SHALL accept an import area id or none, where none clears the setting, and SHALL return the stored value. Setting an area that does not exist SHALL be rejected as not found. Setting an area that is not completed SHALL be rejected as not ready.

#### Scenario: Reading when nothing is featured
- **WHEN** no area has been featured
- **THEN** the API returns no import area id

#### Scenario: Featuring a completed area
- **WHEN** a user sets the featured area to a completed import area
- **THEN** the API returns that area's id, and reading the setting returns the same id

#### Scenario: Featuring an area still importing
- **WHEN** a user sets the featured area to an area that has not completed its import
- **THEN** the request is rejected as not ready and the stored value is unchanged

#### Scenario: Clearing the setting
- **WHEN** a user sets the featured area to none
- **THEN** the stored value becomes none

### Requirement: Deleting the featured area SHALL clear the setting
When the featured import area is deleted, the featured setting SHALL be cleared, so that no later read names it.

#### Scenario: Deleting the featured area
- **WHEN** the featured import area is deleted
- **THEN** reading the featured setting returns no import area id

### Requirement: The landing page SHALL choose its featured place in a fixed order
The landing page SHALL feature the area named by the setting when one is set. Otherwise it SHALL feature the area named by the build-time configuration. Otherwise it SHALL feature the most recently imported completed area.

#### Scenario: A setting and a configured default
- **WHEN** the setting names an area and the build configuration names another
- **THEN** the landing page features the area named by the setting

#### Scenario: Nothing set
- **WHEN** the setting is none and the build configuration names no area
- **THEN** the landing page features the most recent completed import

#### Scenario: Setting cleared, configuration set
- **WHEN** the setting is none and the build configuration names an area
- **THEN** the landing page features the area named by the configuration
