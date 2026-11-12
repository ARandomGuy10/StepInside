# Interior Walkthrough

Walk through a 3D model of a home in the browser, in first person, and
redesign the interior. A personal tool: a static site with no backend.

## Run it

You need Node.js 20 or newer.

```bash
npm install
npm run dev      # then open the URL it prints (http://localhost:5173)
```

Other commands:

```bash
npm test         # unit tests for the scene logic
npm run build    # type-check and build a static site into dist/
npm run preview  # serve the built site
```

## Controls

- Click the view to look around with the mouse. Esc releases the mouse.
- W A S D (or the arrow keys) to walk. Hold Shift to walk faster.

## Status

| Step | What | State |
| --- | --- | --- |
| 1 | Scaffold and one hard-coded room you can walk in | done |
| 2 | Scene JSON schema, loader and the real floor plan | next |
| 3 | Furniture panel | |
| 4 | Paint panel | |
| 5 | Top-down view, save and load | |

## Layout

```
src/core/     Scene logic with no Three.js imports. Unit tested.
src/render/   Everything that draws: meshes, lights, camera controls.
src/main.ts   Wires the two together.
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
- A **shadow map** is how real-time shadows work: the scene is drawn once
  from the sun's point of view, and anything the sun cannot see is in shadow.
