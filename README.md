# Step Inside

Send a floor plan, get a 3D model of the home that opens in the browser:
walk it in first person, see each floor as a plan with sizes, and redesign
the interior. A static site with no backend yet.

## The website

| Page | What it is |
| --- | --- |
| `index.html` | Landing page: sketch-to-model slider, what you get, how it works, the sample home |
| `signup.html`, `login.html` | Make an account, log in |
| `request.html` | Send a plan: a picture and notes (needs an account) |
| `account.html` | Your plans and where each one stands |
| `studio.html` | The viewer (it used to be `index.html`; old `?home=` and `?compare=` links are sent on to it) |

**Accounts and plan requests are a mock.** They are kept in the visitor's
browser (`localStorage`) and nothing is sent anywhere; the pages say so. Any
email and a password of 6 or more characters works. To see a request move,
open **Preview tools** at the bottom of the account page: it plays our side
of the desk (set a plan to building, needs info, or ready with a model).

The code is in `src/site/`. `store.ts` holds the three interfaces a real
backend replaces, and nothing else needs to change:

- `Accounts`: sign up, log in, log out, the current account.
- `PlanRequests`: submit, list, withdraw, update.
- `ModelBuilder`: what happens to a plan once it is submitted. Today that is
  `ManualBuilder`, which only marks it received for a person to build. A
  generator driven by an API key is another `ModelBuilder` that starts the
  job and reports `building`, then `ready` with the model's address.

The pictures on the landing page are rendered from Design D by
`node scripts/site-shots.cjs http://localhost:5173 <folder> fast` (with
`npm run dev` running) and `node scripts/site-shots-more.cjs` (the sun,
style, plan and compare pictures), then converted to WebP into `public/site/`. The look
(colours, type) is in `src/site/tokens.css`, shared with the viewer.

## Run it

You need Node.js 20 or newer.

```bash
npm install
npm run dev      # then open the URL it prints (http://localhost:5173)
```

If walking feels sluggish, open the app with `?fast` on the end of the
address (`http://localhost:5173/studio.html?fast`). That turns off the corner
shading effect, which is the most expensive part of the picture. The viewer
also does this by itself when it sees the pictures arriving slowly, and says
so. Two other things keep it light: shadows are redrawn only when the sun or
something in the home changes (not on every frame), and the Realistic light
code is downloaded only when that mode is first switched on.

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

`studio.html` lists the homes; pick one to walk through it. **All
homes** at the top of the panel goes back to the list. The address holds
the choice (`?home=villa`), so a home can be bookmarked.

| Home | Scene files | Notes |
| --- | --- | --- |
| Apartment | `scenes/home.json` | `scenes/home.md` |
| New house, design A | `scenes/villa-ground.json`, `scenes/villa-first.json` | `scenes/villa.md` |
| New house, design B | `scenes/villa-b-ground.json`, `scenes/villa-b-first.json` | `scenes/villa.md` |
| New house, design C | `scenes/villa-c-ground.json`, `scenes/villa-c-first.json`, `scenes/villa-c-roof.json` | `scenes/villa.md` |
| New house, design D | `scenes/villa-d-ground.json`, `scenes/villa-d-first.json`, `scenes/villa-d-roof.json` | `scenes/villa.md` |
| New house, design E | `scenes/villa-e-ground.json`, `scenes/villa-e-first.json`, `scenes/villa-e-roof.json` | `scenes/villa.md` |

A home opens on a view of the whole building from outside. Drag to turn
it, right-drag or Shift-drag to move it around (two fingers on a phone),
scroll to zoom, and use the roof button to look inside. The list at the
top of the side panel switches between **Whole house**, a **plan** of each
floor and **Walk through**. The tools (turn, zoom, roof, labels, tour,
saved views, share, areas, PDF) are icons on a rail at the right edge, so
nothing lies over the model; hover one for its name and key. On a phone
both are bars at the bottom. Add `&view=walk` to the address to open straight in the
walk.

Homes with a `place` in `src/homes.ts` get a **Sun** panel at the top
right: pick a date and drag the time of day, and the sun moves along its
real path for that town (`src/core/sun.ts`), from sunrise to sunset and
into the night. `&date=2026-06-21&time=18.5` in the address opens at that
moment.

A floor plan is 3D too: the floor is seen from nearly overhead with its
ceiling off. Drag the background to turn or tilt it (tilt it all the way
up for a flat plan). **Hide labels** switches the room names and sizes off
and on; **Hide sizes** takes off just the sizes and keeps the names. Sizes show in feet and inches
or in metres, set per home in `src/homes.ts`. **2D** draws the plan flat, straight down
with no perspective, like a drawing (`&flat=1` in the address); **3D** brings the angle back.

**Areas** lists each floor's carpet area (inside the rooms) and built-up area
(with the walls), the open balconies, terraces and courts, the plot's ground
coverage and the floor area ratio (`src/core/areas.ts`). **PDF** opens the
print dialog with a document to save as PDF: the area statement, then each
floor drawn flat with its room names and sizes.

`npx vitest run tests/walkable.test.ts` walks Design D floor by floor
(`src/core/walkable.ts`): a person 50 cm across, starting at the walker's
start, must reach every room, have a clear step on both sides of every door,
and have room to stand at every bed, wardrobe, toilet, basin and shower.

**Compare designs side by side** (under the design picker, or
`?compare=villa-d,villa-e`) shows two designs next to each other. Turning,
zooming, switching to a plan or walking on one side shows the same view of
the other; untick **Move both sides together** to look around them separately. In a walk the two designs have different walls, so the other side goes to the room of the same name and looks the same way.

Outdoor lights (wall lights, bollards, uplights, soffit downlights, LED strips)
glow faintly by day and come up as the sun panel goes past sunset.

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

## Realistic light (beta)

The sparkle button on the rail (or **Y**) path-traces the view: it follows
light from the sun, the sky and the lamps as it bounces round the rooms,
using `three-gpu-pathtracer`. It starts when the view has been still for a
moment and sharpens pass by pass, up to 400; moving goes back to the fast
picture. It needs a real graphics card. The code is `src/render/realistic.ts`.
Two things in there are easy to break: downloaded models that pack their
points as whole numbers are handed to the tracer as plain copies (read raw,
one chair becomes a shape big enough to shade the whole home), and only the
lamps near the viewer are passed on, which keeps the grain down. The headless
test browser renders in software, a few passes a minute, so the full 400
passes have only been seen on a real machine.

## Night, pictures, directions, your own pieces

- **Night** in the sun panel (K) jumps to nine in the evening and back.
  **Lights off/on** beside it (J) switches every lamp; the **Lights** button
  in the Room section switches the room you are in.
- The camera on the rail (Z) downloads a picture of the view. The video
  button (Shift+G) plays the tour and downloads it as a video when it ends
  or is stopped: MP4 where the browser can make one, otherwise WebM.
- The **compass** always points north. Click it (B) for the directions card:
  the plot is cut into nine zones, each room is labelled with its zone, and
  the card says what Vastu tradition holds for that kind of room there
  (`src/core/vastu.ts`). It is a guide, not a rule. The card asks which way
  the front of the home faces; the answer is kept per home in this browser
  and turns north, and with it the sun and shadows, to match.
- **Keep** on a selected piece saves it, with its size and colour, under
  **My pieces** in this browser, ready to add to any room or home.

## Controls

Every feature has a key. Press **?** in the viewer for the list.

| Key | What it does |
| --- | --- |
| H | Whole house |
| 1, 2, 3 | Plan of that floor |
| Enter | Walk through (T switches between plan and walk) |
| Q, E | Turn the view left, right |
| + and - | Zoom |
| 0 | Reset view |
| X | Flat 2D or 3D plan |
| O | Roof on or off |
| N, M | Room names, sizes |
| F, P, L | Furniture, Paint, Style tab |
| G | Tour |
| Y | Realistic light (beta) |
| K, J | Night and back; all lights on or off |
| B | Directions and Vastu |
| Z | Save a picture of the view |
| Shift+G | Record the tour as a video |
| C | Copy a link to this view |
| V | Saved views |
| I | Areas |
| Shift+P | PDF |

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

- One click restyles the home. There are 31 looks, from Modern, Scandinavian
  and Japandi to Art deco, Modern Indian and Wabi-sabi (`src/core/styles.ts`). It sets the walls, ceilings, floors
  and their materials (tiles in bathrooms and kitchens), and the colours
  of sofas, beds, wooden furniture, kitchen units and rugs. Nothing moves,
  and balconies, terraces and gardens are left alone.
- With **All floors** ticked it does every storey, otherwise just the one
  you are on. Undo, or **Back to the original look**, undoes it.

Tour, sharing and saved views (the row above the view bar):

- **Tour** walks through every room on its own, through the doorways,
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
