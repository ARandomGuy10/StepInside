# Surface textures

Photographed surfaces from [Poly Haven](https://polyhaven.com) (CC0), loaded
by `loadSurfaces()` in `src/render/textures.ts`. Each colour map was turned
to light grey so the material's own colour still paints it; the normal maps
(`-normal`, OpenGL style) and roughness maps (`-rough`) are as published,
shrunk to 512 px. Add `?drawn` to the address to see the drawn patterns
instead.

| Files | Source | Notes |
| --- | --- | --- |
| planks-* | [Laminate Floor 02](https://polyhaven.com/a/laminate_floor_02) | laminate and decking |
| tiles-* | [Marble 01](https://polyhaven.com/a/marble_01) | 4 × 4 grout grid drawn in; bathroom tiles and 80 cm floor tiles |
| stone-* | [Castle Wall Slates](https://polyhaven.com/a/castle_wall_slates) | stone cladding and boundary walls |
| setts-* | [Rectangular Paving](https://polyhaven.com/a/rectangular_paving) | paths and patios |
| pebbles-* | [Clean Pebbles](https://polyhaven.com/a/clean_pebbles) | pebble beds round stepping stones |
| lawn-normal, lawn-rough | [Leafy Grass](https://polyhaven.com/a/leafy_grass) | the lawn keeps its drawn stripes for colour |

`../env/garden.hdr` is [Residential Garden](https://polyhaven.com/a/residential_garden)
(CC0), shrunk to 256 × 128 with the sun clipped, so it lights and reflects
softly without adding a second sun.
