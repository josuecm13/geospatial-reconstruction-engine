## ADDED Requirements

### Requirement: The client SHALL generate or regenerate an area's blocks from the scene
The scene view SHALL offer **Generate** when the open area has no run, and **Regenerate** when it has one, highlighted when the run is stale. Regenerate SHALL request a new seed chosen at random, and Generate SHALL request the server's default seed. While the job runs, the client SHALL show its progress from the area's event stream, and on completion it SHALL reload the map data.

#### Scenario: An area with no run
- **WHEN** a user opens the scene of an area with no generation run
- **THEN** the scene offers Generate

#### Scenario: A stale run
- **WHEN** a user opens the scene of an area whose run is stale
- **THEN** the scene offers Regenerate, highlighted

#### Scenario: Regenerating
- **WHEN** a user chooses Regenerate
- **THEN** the request carries a new random seed, progress is shown, and the map data reloads when the run completes

### Requirement: The client SHALL show or hide generated buildings
The scene SHALL offer a Show generated toggle that is checked by default when the area has a run, and that shows or hides the generated buildings. The glTF export SHALL include generated buildings only while they are shown.

#### Scenario: Hiding generated buildings
- **WHEN** a user unchecks Show generated
- **THEN** the generated buildings leave the scene and are not part of a glTF export

#### Scenario: Default with a run
- **WHEN** a user opens the scene of an area with a run
- **THEN** Show generated is checked

### Requirement: The client SHALL draw generated buildings in their own colour
Generated buildings SHALL be drawn in a colour distinct from measured and defaulted buildings, in the 3D scene and in the 2D overlay, and that colour SHALL come from the design tokens.

#### Scenario: A generated and a measured building side by side
- **WHEN** the scene shows a generated building next to a measured one
- **THEN** the two are drawn in different colours

### Requirement: The client SHALL outline blocks by eligibility
The scene and the 2D map SHALL draw each block as an outline inset 1.5 metres inside its boundary, in the Show blocks layer. An `eligible` block SHALL be a crisp dashed outline, the other eligibility values SHALL be faint dotted outlines, and a selected block SHALL be a solid, highlighted outline. In the 3D scene the outline SHALL be draped on the terrain.

#### Scenario: An eligible block next to a median
- **WHEN** Show blocks is on and the area has an eligible block and a median
- **THEN** the eligible block is a crisp dashed outline and the median a faint dotted one

#### Scenario: Selecting a block
- **WHEN** a user selects a block
- **THEN** its outline is solid and highlighted

### Requirement: The client SHALL show a block's counts and let the owner correct it
Clicking a block in the 3D scene or on the 2D map SHALL open a panel reading `Block · real: N · generated: M · reference: <short id or "defaults"> · style: …`. The panel SHALL offer an input for the actual number of buildings, a **No buildings here** action, and **Clear feedback**. Each action SHALL store or clear the block's feedback, and after a change the panel SHALL state that it applies on the next Generate.

#### Scenario: Entering a count
- **WHEN** a user enters 5 in the actual-number input and confirms
- **THEN** the block's feedback is stored as 5 and the panel reads that it applies on the next Generate

#### Scenario: Marking a block empty
- **WHEN** a user chooses No buildings here
- **THEN** the block's feedback is stored as no buildings

#### Scenario: Clearing feedback
- **WHEN** a user chooses Clear feedback
- **THEN** the block's feedback is removed

### Requirement: The client SHALL shade generation zones by reason
When Show blocks is on, the client SHALL shade each generation zone by its reason, so that water, steep ground, land use and setbacks are distinguishable.

#### Scenario: Zones with different reasons
- **WHEN** Show blocks is on and the run has a water zone and a setback zone
- **THEN** the two zones are shaded differently

### Requirement: The client SHALL offer a Set point tool shared by fly and walk
The client SHALL offer a **Set point** tool, with the shortcut `P`, and double-clicking the ground SHALL also drop a pin on the terrain. Fly mode SHALL ease its orbit target to the pin over about 400 milliseconds, instantly under reduced motion, keeping its distance and angle. Walk mode SHALL start at the pin at eye height, facing the camera's horizontal direction, and a pin inside a building SHALL move to the nearest open point. **Reset to centre** SHALL clear the pin. The pin SHALL be excluded from picking and from the glTF export. The Set point and Route tools SHALL NOT be armed together: arming one SHALL disarm the other.

#### Scenario: Dropping a pin in fly mode
- **WHEN** a user double-clicks the ground in fly mode
- **THEN** a pin appears on the terrain and the view eases its target to it, keeping its distance

#### Scenario: Walking from a pin
- **WHEN** a user starts walk mode with a pin set
- **THEN** the viewer starts at the pin at eye height

#### Scenario: A pin inside a building
- **WHEN** the pin would fall inside a building's footprint in walk mode
- **THEN** the viewer starts at the nearest open point instead

#### Scenario: Resetting the pin
- **WHEN** a user chooses Reset to centre
- **THEN** the pin is removed and the view returns to the centre

### Requirement: The client SHALL feature a place on the landing page
Each location card for a completed area SHALL offer **Show on landing**, which sets the featured place. The featured card SHALL show a badge. The landing page SHALL choose its featured place from the featured-place setting first, then the build configuration, then the most recent import.

#### Scenario: Setting the featured place
- **WHEN** a user chooses Show on landing on a completed area's card
- **THEN** that card shows the featured badge and the landing page features that area

### Requirement: The landing journey SHALL end with the generated context
The landing page's step-by-step build of the featured place SHALL end with a **Generated context** step, after the buildings step, in which the generated buildings rise in their own colour on top of everything shown before. The hero SHALL show the finished place including the generated layer when the featured place has a generation run. When it has none, the step SHALL still appear, raise nothing, and say the place hasn't been generated yet, linking to it, and the hero SHALL show the place without a generated layer.

#### Scenario: A featured place with a generation run
- **WHEN** a user scrolls from the buildings step to the generated-context step
- **THEN** only the generated buildings rise, in their own colour, and the hero shows the place with them

#### Scenario: A featured place without a run
- **WHEN** the featured place has never been generated
- **THEN** the generated-context step raises nothing and says the place hasn't been generated yet, with a link to open it

## MODIFIED Requirements

### Requirement: The client SHALL build a low-poly 3D scene from map-data
The scene view SHALL show the open area, or its selected boundary, as a low-poly 3D world built from `GET /import-areas/{id}/map-data`, in meters from the response's projection origin. It SHALL draw area features and roads (once per two-way road, at `width_meters`) as flat shapes and buildings extruded to their height, and SHALL offer a **Show blocks** toggle, hidden by default, which replaces the buildable-area toggle. The flat layers SHALL draw in a fixed order that doesn't depend on camera distance: the ground, then area features (water over green), then roads (wider lane types over narrower), then the blocks' buildable overlay. A building's height SHALL be `height_meters` when known, else its levels at 3.2 m each, else a default by category; a height taken from the category default SHALL be visibly marked (a paler material). The scene SHALL reload when the selection changes while it is shown, and SHALL ignore a response that is no longer the latest request.

#### Scenario: A building with no height or levels
- **WHEN** map-data contains a building whose `height_meters` and `levels` are both null
- **THEN** the scene draws it with its category's default height, in the paler material, flagged as defaulted

#### Scenario: Zoomed out over a junction of a wide and a normal road
- **WHEN** the camera is zoomed out to its farthest over an area with a wide road crossing a normal one
- **THEN** the junction shows the wide road whole, with no flicker

#### Scenario: Switching boundary while the scene is shown
- **WHEN** the selection changes to another boundary while a previous request is still loading
- **THEN** only the response for the latest selection is drawn
