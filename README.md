# Interior Walkthrough

Walk through a 3D model of a home in the browser, in first person, and
redesign the interior. A personal tool: a static site with no backend.

## Run it

You need Node.js 20 or newer.

```bash
npm install
npm run dev      # then open the URL it prints (http://localhost:5173)
```

If walking feels sluggish, open the app with `?fast` on the end of the
address (`http://localhost:5173/?fast`). That turns off the corner
shading effect, which is the most expensive part of the picture.

Other commands:

```bash
npm test         # unit tests for the scene logic
npm run build    # type-check and build a static site into dist/
npm run preview  # serve the built site
```

## On the internet

`.github/workflows/pages.yml` builds the site and publishes it to GitHub
Pages on every push to `main`. Switch it on once in the repository:
Settings > Pages > Source: **GitHub Actions**. The site is then at
`https://<user>.github.io/StepInside/`.

## Homes

The start screen lists the homes; pick one to walk through it. **Change
home** at the top of the panel goes back to the list. The address holds
the choice (`?home=villa`), so a home can be bookmarked.

| Home | Scene files | Notes |
| --- | --- | --- |
| Apartment | `scenes/home.json` | `scenes/home.md` |
| New house, design A | `scenes/villa-ground.json`, `scenes/villa-first.json` | `scenes/villa.md` |
| New house, design B | `scenes/villa-b-ground.json`, `scenes/villa-b-first.json` | `scenes/villa.md` |
| New house, design C | `scenes/villa-c-ground.json`, `scenes/villa-c-first.json`, `scenes/villa-c-roof.json` | `scenes/villa.md` |

A home opens on a view of the whole building from outside. Drag to turn
it, scroll to zoom, and use **Hide roof** to look inside. The bar at the
bottom switches between **Whole house**, a **plan** of each floor and
**Walk through**. Add `&view=walk` to the address to open straight in the
walk.

Homes with a `place` in `src/homes.ts` get a **Sun** panel at the top
right: pick a date and drag the time of day, and the sun moves along its
real path for that town (`src/core/sun.ts`), from sunrise to sunset and
into the night. `&date=2026-06-21&time=18.5` in the address opens at that
moment.

A floor plan is 3D too: the floor is seen from nearly overhead with its
ceiling off. Drag the background to turn or tilt it (tilt it all the way
up for a flat plan), and use **Hide dimensions** / **Show dimensions** to
switch the room names and sizes off and on. Sizes show in feet and inches
or in metres, set per home in `src/homes.ts`.

Furniture is solid. A piece cannot be put where another one stands; while
a drag is blocked the highlight turns red and the piece slides along
whatever is in its way. The exceptions: anything can stand on a rug, a
chair can be pushed in under a table, and small things (table lamp, vase,
small plant, books) stand on top of tables, desks, counters and TV units
and move along with them.

A home can have several designs to compare. Homes that share a
`design.group` in `src/homes.ts` appear once on the start screen, and a
dropdown at the top of the panel switches between them.

A home can have several storeys. Each storey is a scene file of its own,
and `src/homes.ts` stacks them: the height of each floor, where the
stairs are, and where the walk starts. The new house starts outside, at
the gate.

- Walk onto the first step of the stairs and keep walking to go up or down.
- The floor buttons at the top of the panel, or **Page Up** / **Page
  Down**, jump straight to a floor. **Outside** goes back to the gate.
- Furniture, paint, save and load act on the floor you are on. The top
  view shows that floor, with the floors below it visible through any
  opening.
- A room of kind `void` is a hole in a floor, such as a stairwell. A
  piece marked `fixed`, such as the staircase, can be painted but not moved.

To add a home, put its scene file in `scenes/` and list it in
`src/homes.ts`.

## Controls

Walking:

- Click an empty part of the room to look around with the mouse. Esc
  releases the mouse. Holding the right mouse button also looks around.
- W A S D (or the arrow keys) to walk. Hold Shift to walk faster.
- T switches between the walk view and the top view.

Furniture (with the mouse released, in either view):

- Click a piece to select it. Drag it to move it along the floor. It
  stops at walls and slides along them.
- The **W**, **D** and **H** boxes show the selected piece's width,
  depth and height in centimetres. Type a measured value and press Enter
  to resize it. A piece that grows into a wall is nudged clear of it.
- R turns the selected piece 15 degrees, Shift+R turns it back. The panel
  also has a quarter-turn button.
- Delete, or **Take out** in the panel, removes the piece from the home
  and lists it under **Taken out**. Drag it from that list onto the floor
  to put it back, or press **Put back** to return it to where it stood.
- **Empty the room** takes out everything in the room named in the panel:
  the selected piece's room, or the room you are standing in.
- **Reset layout** puts everything back as it is in the scene file.
- Ctrl/Cmd+Z undoes and Ctrl/Cmd+Shift+Z redoes. A whole drag is one step.

Decorating (the **Add a piece** list on the Furniture tab):

- A button adds that piece in front of where you stand, selected and
  ready to drag. **Reset layout** removes added pieces again.
- Paintings, mirrors and wall shelves hang on the wall you are looking
  at. Drag one along its wall, or up and down, in the walk view. The
  **Higher** and **Lower** buttons move it 5 cm at a time. In the top
  view a drag moves it to the nearest wall.

Paint (the **Paint** tab):

- Click a wall, floor, ceiling, built-in closet or piece of furniture to
  pick it. Then choose a colour from the swatches or the colour picker.
- **Use on all walls of this room** copies the colour to every wall of
  the picked wall's room.
- To look around while painting, hold the right mouse button, or
  double-click the view. While looking around, a click picks whatever
  the dot in the middle of the screen is on. Esc frees the mouse again.
- **Reset all colours** returns to the colours in the scene file. Paint
  and layout undo with the same Ctrl/Cmd+Z.

Materials (also on the **Paint** tab):

- Pick a floor and choose **Wood**, **Tiles**, **Large tiles**, **Stone**,
  **Concrete**, **Decking** or **Plain**. Pick a wall and choose **Paint**,
  **Stone**, **Wood panels** or **Tiles**. The colour stays, so a tiled
  wall can still be any colour.
- **Use this material on all walls of this room** does the whole room.

Styles (the **Style** tab):

- One click restyles the home: Modern, Scandinavian, Japandi, Industrial,
  Coastal, Mediterranean or Dark luxe. It sets the walls, ceilings, floors
  and their materials (tiles in bathrooms and kitchens), and the colours
  of sofas, beds, wooden furniture, kitchen units and rugs. Nothing moves,
  and balconies, terraces and gardens are left alone.
- With **All floors** ticked it does every storey, otherwise just the one
  you are on. Undo, or **Back to the original look**, undoes it.

Tour, sharing and saved views (the row above the view bar):

- **▶ Tour** walks through every room on its own, through the doorways,
  stopping in each to look round, then goes up to the next floor. Click
  the view or press any key to stop and carry on walking from there.
- **Share** copies a link that opens exactly this view: the whole house
  from this angle, this floor plan, or this spot in the walk. The link
  holds the view only, not furniture or colour changes; use Save for those.
- **Saved views** keeps views by name in this browser. Click one to go
  back to it, or **Link** to copy its link.
- A link looks like `?home=villa&view=walk&floor=1&at=4.2,7.9,90,-5`:
  `at` is x and y on the plan in metres, the facing and the up/down look
  in degrees. `view=plan` and `view=whole` take `cam=` instead.

Save and load (bottom of the panel):

- **Save** (or Ctrl/Cmd+S) downloads the current furniture and colours as
  `layout-<date>.json`. Keep as many as you like.
- **Load** opens such a file. Dropping the file onto the view also works.
  Loading is one undo step, so Ctrl/Cmd+Z brings the previous layout back.
- A saved file is a complete scene file. To make a layout the one the
  app starts with, copy it over `scenes/home.json` and commit it.
- A file only loads if its rooms, doors and windows match the home that
  is open. Reloading the page returns to `scenes/home.json`.

## Status

| Step | What | State |
| --- | --- | --- |
| 1 | Scaffold and one hard-coded room you can walk in | done |
| 2 | Scene JSON schema, loader and the real floor plan | done |
| 3 | Furniture panel, plus the top view toggle | done |
| 4 | Paint panel, plus adding pieces and wall-hung decoration | done |
| 5 | Save and load | done |

## The scene file

The whole home is described by `scenes/home.json`. The app builds every
wall, floor and window from it. `scenes/home.md` lists where each number
came from and every assumption. The plan it was read from is
`docs/floorplan.png`.

- Lengths are metres. Positions are `[x, y]` as on the floor plan, with x
  to the right and y down the page. Heights are separate fields.
- A **room** is the inside outline of its floor (`polygon`). Edge `i` of
  a room runs from point `i` to point `i + 1`, and each edge is one wall.
- Walls are not listed. A wall is the gap between two rooms, or the
  default outside thickness where no room is on the other side.
- An **opening** (door or window) sits on one room's edge, `offset`
  metres from the edge's first point. It is cut through to the room
  behind automatically, so each door is listed once.
- A **solid** is building mass that is not a room, such as a closet.
- A **light** is a lamp: a position, a height and a brightness.
- **Furniture** has a `model` name. The app uses `/models/<name>.glb` if
  that file exists, else a model built in code (`src/render/models.ts`),
  else a plain box of the piece's `size`. At rotation 0 the front of a
  piece faces up the page. A piece with `"mount": "wall"` hangs on a wall,
  with its bottom edge `elevation` metres above the floor.
- Colours are `#rrggbb`. A room can set `floor.color`, `ceiling.color`
  and a colour per wall (`walls: [{ "edge": 2, "color": "#7d8a74" }]`).
  Anything not set uses `defaults`. The Paint tab edits exactly these.
- A room with `"kind": "balcony"` gets railings and no ceiling.
- A floor's `material` is one of `laminate`, `tile`, `large-tile`, `stone`,
  `concrete`, `decking`, `lawn` or `setts`; without one it is plain. A
  wall can have a `material` too (`stone`, `wood` or `tile`), next to its
  colour in `walls`.

If the file is invalid, the app shows a list of problems, each with the
path of the offending field, for example
`scene.openings[3]: does not fit on its wall`.

## Layout

```
scenes/       The home as JSON, plus notes on where the numbers came from.
src/core/     Scene logic with no Three.js imports. Unit tested.
              scene.ts     file format and validation
              walls.ts     rooms to wall slabs, doorways and collision lines
              collision.ts walking into walls
              edits.ts     edits: move, turn, take out, add, paint, materials, reset
              styles.ts    the one-click styles
              tour.ts      the route of the automatic tour
              viewLink.ts  views in the page address, for links
              catalogue.ts the pieces that can be added from the panel
              layout.ts    saving and loading layouts
              history.ts   undo and redo
src/render/   Everything that draws: meshes, lights, camera controls.
              models.ts    furniture built from simple shapes in code
              textures.ts  drawn patterns, and photographed surfaces where there are some
src/ui/       The HTML panels.
src/homes.ts  The list of homes on the start screen.
src/main.ts   Wires it all together: state, mouse and keyboard.
scripts/      make-villa.py writes the new house's scene files from feet.
public/models glTF furniture models (CC0, Poly Haven). See the README there.
public/textures Photographed floor, stone and paving textures. README there.
public/env    The outdoor panorama that lights and reflects the scene.
tests/        Vitest unit tests for src/core.
```

The rule is that `src/core` never imports from `src/render` or from
Three.js, so the logic can be tested without a browser.

## A few terms, for readers new to 3D

- **Vite** is the dev server and bundler. It plays the role Maven or
  Gradle plus an embedded server would in a Java project.
- **Three.js** is a library over WebGL, the browser's GPU drawing API.
- A **scene** is a tree of objects. A **mesh** is one drawable object: a
  **geometry** (the triangles) plus a **material** (how the surface
  reacts to light).
- The **camera** is the viewpoint. The **renderer** draws what the camera
  sees, once per screen refresh, in the render loop.
- Three.js treats Y as up. The floor plan's (x, y) becomes 3D (x, height, z).
- A **texture** is an image wrapped onto a surface, such as floor planks.
- **Ambient occlusion** darkens corners and the floor under furniture.
  It is a post-processing pass: an effect applied to the finished picture.
- A **shadow map** is how real-time shadows work: the scene is drawn once
  from the sun's point of view, and anything the sun cannot see is in shadow.
