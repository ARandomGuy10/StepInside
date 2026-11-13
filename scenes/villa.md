# The new house: where the numbers come from

Two scene files, one per floor: `villa-ground.json` and `villa-first.json`.
`src/homes.ts` stacks them into one home and says where the stairs are.
Both are written by `scripts/make-villa.py`, which holds the layout in
feet, as on the plans, and converts to metres. Change a number there and
run `python3 scripts/make-villa.py` rather than editing the JSON by hand.

## Sources

- Ground floor plan sketch, plot 35 ft x 55 ft, rear side at the top and
  the main entrance at the bottom. Room sizes are taken from it as drawn.
- First floor plan sketch, same plot and orientation.
- Two rendered pictures, used only as a guide for the interior. The
  ground floor render has the pool on the wrong side and is not followed
  for layout.

## From the plans

Ground floor: Kitchen 12 x 15, Master bedroom 13 x 15, Bath and Wardrobe
beside it, Dining 18 x 10 and Living 18 x 15 as one open room, Pool
12 x 16.5 in an open court with a narrow deck behind it and a deck with
loungers on its right, Toilet and a pool shower in front of the pool,
Guest room 12 x 12.5, Garden 20 x 12.5.

First floor: Bedroom 2 and Bedroom 1 at 13.5 x 15 each, Bath 6 x 10 with a
Dressing room, Sitting lounge 18 x 10 wrapping round the double-height
void, Bedroom 3 12 x 12.5 with its Bath, Balcony 15 x 18. The area over
the pool is open to the sky.

## Assumptions

1. **Wall thickness.** Outside walls 0.75 ft (23 cm), inside walls 0.5 ft
   (15 cm). The plans give room sizes only; these thicknesses make the
   rooms add up to the 35 x 55 ft plot.
2. **Rooms without a size on the plan** fill what is left: ground floor
   Bath 7.5 x 9, Wardrobe 7.5 x 5.5, Toilet 8.5 x 6, pool shower 6 x 6;
   first floor Bath 5.5 x 10 (drawn as 6 x 10), Dressing 5.5 x 4.5, Bath
   beside Bedroom 3 5.5 x 12.5.
3. **Storey height.** Ceilings are 3.0 m and the first floor is 3.05 m
   above the ground floor. The living half of the Dining + Living room is
   open up to the first floor's ceiling, through the void.
4. **Doors** are where the orange marks are, 2.1 m high and about 3 ft
   wide. The gate is a 4 ft opening in the front boundary wall, in line
   with the main door. It has no gate leaves.
5. **Windows** are not on the plans. Every window is a guess, including
   the tall ones from the living room and lounge towards the pool.
6. **North** is unknown. The top of the plan is treated as north.
7. **Stairs** are one straight flight, 3.5 ft wide and 12.75 ft long,
   against the left wall of the living room, rising towards the rear.
   The plans show where the stairs are but not their size. The walkable
   rectangle is in `src/homes.ts` and must match the staircase piece.
8. **The double-height void** has a 1.1 m guard rail towards the lounge
   and the passage, and full walls towards Bedroom 3 and its Bath.
9. **Outside.** The boundary wall is 1.8 m high round the garden and a
   full storey high beside the pool court. The outside walls are plain,
   in the wall colour, with a flat roof. The ground round the plot is a
   flat plane; neighbours and the street are not modelled. The pool is a
   flat surface at floor level that you can walk over.
10. **Furniture** follows the symbols on the plans, with typical sizes.

## Finishes and decor

None of this is on the plans; it is a starting point to repaint and move.

- Walls are off-white with one accent wall per room. Outside, both designs
  have light stone cladding (`defaults.exteriorMaterial: "stone"`), white
  bands at each floor and a white overhanging roof; design B has white render
  on its first floor.
- Balconies have glass balustrades with flower boxes along the edge. The
  front boundary wall is 1.2 m with stone pillars and an open timber gate;
  the side walls are 1.8 m.
- Gardens have a terrace and path of small stone setts, a lawn, borders, a
  tree, a bench and potted plants.
- Bedrooms have an oak laminate floor, the living areas and balcony large
  tiles, the baths grey tiles and the pool court timber decking.
- Paintings hang clear of the windows. Plants, lamps and small things on
  the tables are from the catalogue.

## Measurement check

Furniture uses common real sizes: double beds 1.6 to 1.8 m wide and 2.0
to 2.1 m long, wardrobes 0.55 to 0.6 m deep and 2.2 m high, kitchen
counters 0.9 m high and 0.6 m deep, dining table 0.75 m high, dining
chairs 0.5 m wide, toilets 0.4 x 0.68 m, loungers 0.7 x 1.9 m. Doors are
2.1 m high and 2.5 to 3.25 ft wide. The one figure on the tight side is
the staircase: 17 steps of 18 cm rise and 23 cm going. A more comfortable
25 cm going needs a flight about 14 ft long instead of 12.75 ft.

## Design B: courtyard house

A second design for the same 35 x 55 ft plot, in `villa-b-ground.json` and
`villa-b-first.json`. It is my own proposal, not taken from the plans, with
the same list of rooms. Pick it from the dropdown at the top of the panel.

The thinking:

- **A private pool court.** The pool (10 x 14.5 ft) moves to the rear left,
  walled on two sides, so it cannot be seen from the street. The living
  space and the master bedroom both open straight onto it.
- **One open living space.** Kitchen, dining and living are a single room
  33.5 ft wide and 20.5 ft deep, with daylight from two sides: the pool
  court behind and the garden in front.
- **Edges for services.** Stairs, baths, wardrobe and powder room sit
  along the walls, so the middle of the house stays open.
- **Guest room at the front** (12.5 x 12 ft), with its own door from the
  garden and a second door to the living space. The powder room is next to it.
- **Master suite at the rear** (16.5 x 14 ft), entered through its
  wardrobe, with its own bath and a door to the pool.
- **Upstairs:** a family lounge (about 16 x 20 ft) overlooking the pool,
  Bedroom 1 as a suite over the master, Bedrooms 2 and 3 off a small hall
  with a shared bath, and a 12 x 12 ft terrace over the entrance that also
  shelters the front door.
- **Stairs** are 14 ft long here, which gives a comfortable 25 cm going.

Things to check with an architect before relying on it: structure
(the first floor spans the 33.5 ft living space, so it needs beams or
columns), setbacks and side windows allowed on your plot, plumbing stacks,
and which way the plot faces.
