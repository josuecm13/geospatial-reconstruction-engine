## ADDED Requirements

### Requirement: The API SHALL report and set the landing theme
The API SHALL return the landing theme, as a theme id and a time-of-day preset, or none when it is unset. Setting it SHALL accept a theme id and a preset, or none, where none clears the setting, and SHALL return the stored value. A theme id or preset the client does not offer SHALL be rejected as invalid, with the stored value unchanged.

#### Scenario: Reading when unset
- **WHEN** no landing theme has been set
- **THEN** the API returns none

#### Scenario: Setting the landing theme
- **WHEN** a user sets the landing theme to Realistic at golden hour
- **THEN** the API returns that theme and preset, and reading the setting returns the same

#### Scenario: An unknown theme
- **WHEN** a user sets the landing theme to a theme id the client does not offer
- **THEN** the request is rejected as invalid and the stored value is unchanged

### Requirement: The landing stage SHALL use the landing theme
The landing page's 3D stage SHALL draw the featured place in the landing theme and its time of day, and in Night clay when the setting is none.

#### Scenario: Nothing set
- **WHEN** the landing theme is none
- **THEN** the landing stage looks as it did before themes

#### Scenario: A theme chosen
- **WHEN** the owner has used **Use on landing** with Blueprint selected
- **THEN** the landing stage draws the featured place in Blueprint
