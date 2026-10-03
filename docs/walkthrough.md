# Walkthrough: a real place, from the map to Blender

One area of Berlin Mitte, under 1 km², from picking it on the map to opening it in Blender. Setup is in
[`runbook.md`](runbook.md); start there if the API and client aren't running.

The rectangle used here is `13.3930821,52.526332 → 13.4090037,52.5344644` (about 1 km²). A smaller one
imports faster, and the public Overpass instance is shared, so import it once.

## 1. Pick the area on the 2D map

Open <http://localhost:55173/explore>. The map opens with no area. In the **Import a place** panel, press
**Draw rectangle** and drag on the map. The readout shows the rectangle's size. Drag its body to move
it, or its edges to resize it.

![2D picker](walkthrough/01-picker.png) <!-- TODO(screenshot): the 2D map at /explore over Berlin Mitte with the selection rectangle drawn and the import panel open, the area readout and the enabled "Import from OpenStreetMap" button visible -->

## 2. Watch the staged build

Press **Import from OpenStreetMap** and switch to the 3D tab. The server imports in the background and
streams each stage, and the scene builds as they arrive: the ground, then roads, then blocks, then
buildings, in rings from the centre outward. The import is one transaction, so a failure leaves nothing
behind.

![Build animation](walkthrough/02-build.png) <!-- TODO(screenshot): the 3D tab partway through the build, with roads and blocks drawn and the buildings filling in as a ring around the centre -->

## 3. Fly over it

The scene opens in fly mode (orbit controls): drag to orbit, scroll to zoom, right-drag to pan. The
low-poly scene shows buildings extruded to their source heights where OSM has them, with roads at their
generated widths.

![Flying](walkthrough/03-fly.png) <!-- TODO(screenshot): a high oblique view of the whole imported area in fly mode -->

## 4. Walk a street

Press **Walk** (or `V`). Click the scene to capture the mouse, then `WASD` to move, `Shift` to run, `Esc`
to release the mouse. You stand 1.7 m above the ground and building walls stop you. Press **Fly** (or `V`)
to get back up.

![Walking](walkthrough/04-walk.png) <!-- TODO(screenshot): the first-person view down a street at eye height, building walls on both sides and the walk help overlay visible -->

## 5. Trace a boundary and scope to it

On the Map tab, the **Boundaries** panel traces a shape inside the imported rectangle. Choose a tracing
mode (**Click vertices** or **Freehand**), press **Trace boundary**, draw the shape, give it a name, and
press **Save boundary**. `Esc` cancels a trace. Then pick the boundary in **Scope**: the map and the 3D
scene show only what it covers, and the choice is kept in the URL. Pick the whole area in **Scope** to go
back.

## 6. Route between two points

In the 3D tab, tick **Route**, click the origin, then the destination. The route is drawn on the roads,
with its length and strategy beside the toggle. `Esc` clears it. The strategy list comes from the server.

## 7. Export and open in Blender

Press **Download glTF**. In Blender, **File → Import → glTF 2.0** and pick the `.glb`. The scene is in
meters with y up, one mesh per entity, named `<layer>:<entity id>`.

![In Blender](walkthrough/05-blender.png) <!-- TODO(screenshot): the exported .glb open in Blender's viewport, the outliner showing the layer groups (ground, roads, blocks, buildings) -->

## Screenshots to take

These need a human at a browser and Blender; each placeholder above describes the capture.

- [ ] `walkthrough/01-picker.png`
- [ ] `walkthrough/02-build.png`
- [ ] `walkthrough/03-fly.png`
- [ ] `walkthrough/04-walk.png`
- [ ] `walkthrough/05-blender.png`
