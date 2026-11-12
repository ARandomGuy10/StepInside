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

## Controls

Walking:

- Click an empty part of the room to look around with the mouse. Esc
  releases the mouse. Holding the right mouse button also looks around.
- W A S D (or the arrow keys) to walk. Hold Shift to walk faster.
- T switches between the walk view and the top view.

Furniture (with the mouse released, in either view):

- Click a piece to select it. Drag it to move it along the floor. It
  stops at walls and slides along them.
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

Nothing is saved yet: reloading the page returns to the scene file.
Saving and loading layouts is step 5.

## Status

| Step | What | State |
| --- | --- | --- |
| 1 | Scaffold and one hard-coded room you can walk in | done |
| 2 | Scene JSON schema, loader and the real floor plan | done |
| 3 | Furniture panel, plus the top view toggle | done |
| 4 | Paint panel, plus adding pieces and wall-hung decoration | done |
| 5 | Save and load | next |

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
              edits.ts     edits: move, turn, take out, add, paint, reset
              catalogue.ts the pieces that can be added from the panel
              history.ts   undo and redo
src/render/   Everything that draws: meshes, lights, camera controls.
              models.ts    furniture built from simple shapes in code
              textures.ts  planks, tiles, fabric and paintings drawn in code
src/ui/       The HTML panels.
src/main.ts   Wires it all together: state, mouse and keyboard.
public/models glTF furniture models. See the README in that folder.
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
