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
7. **Stairs** are one straight flight, 3.3 ft wide and 14 ft long,
   against the left wall of the living room, rising towards the rear into
   a notch at the end of the lounge, with 3 ft clear at the foot.
   The plans show where the stairs are but not their size. The walkable
   rectangle is in `src/homes.ts` and must match the staircase piece.
8. **The double-height void** has a 1.1 m guard rail towards the lounge
   and the passage, and full walls towards Bedroom 3 and its Bath.
9. **Outside.** The boundary wall is 1.8 m high round the garden and a
   full storey high beside the pool court. The roof is a guess (see below). The ground round the plot is a
   flat plane; neighbours and the street are not modelled. The pool is a
   flat surface at floor level that you can walk over.
10. **Furniture** follows the symbols on the plans, with typical sizes.

## Finishes and decor

None of this is on the plans; it is a starting point to repaint and move.

- Walls are off-white with one accent wall per room. Outside, both designs
  have light stone cladding (`defaults.exteriorMaterial: "stone"`), white
  bands at each floor and a single sloping roof (`defaults.roofRise`): low and
  thin over the front, rising 1.5 m to the back, white underneath with a dark
  metal top. Design B has white render on its first floor.
- Balconies have glass balustrades with flower boxes along the edge. The
  front boundary wall is 1.2 m with stone pillars and an open timber gate;
  the side walls are 1.8 m.
- Gardens have stepping stones in a bed of white pebbles with dark steel
  edging from the gate to the front door, a flagstone patio, a striped lawn,
  clipped box balls and planted borders. Design A's garden is mostly under
  the balcony, so it has no tree; Design B's front garden is open to the sky
  and has one.
- Bedrooms have an oak laminate floor, the living areas and balcony large
  tiles, the baths grey tiles and the pool court timber decking.
- Paintings hang clear of the windows. Plants, lamps and small things on
  the tables are from the catalogue.

## Sun

Both designs are placed in Lucknow (city centre coordinates; the exact
plot is not needed for the sun's path). The Sun panel at the top right sets
the date and time of day; the sun follows its real path, with warm low
light near sunrise and sunset and a night sky after dark. North is still
assumed to be the top of the plan, which changes where shadows fall.

## Measurement check

Furniture uses common real sizes: double beds 1.6 to 1.8 m wide and 2.0
to 2.1 m long, wardrobes 0.55 to 0.6 m deep and 2.2 m high, kitchen
counters 0.9 m high and 0.6 m deep, dining table 0.75 m high, dining
chairs 0.5 m wide, toilets 0.4 x 0.68 m, loungers 0.7 x 1.9 m. Doors are
2.1 m high and 2.5 to 3.25 ft wide. The one figure on the tight side is
the staircase: 16 risers of 19 cm with a 26 to 27 cm going, and at least
2 ft (0.6 m) clear at each end; Design A has 3 ft at the foot.

## Design B: courtyard house

A second design for the same 35 x 55 ft plot, in `villa-b-ground.json` and
`villa-b-first.json`. It is my own proposal, not taken from the plans, with
the same list of rooms. Pick it from the dropdown at the top of the panel.

The thinking (revised after review: bedrooms back to the plan sizes, more
outside space, a pool shower, and the guest door away from the sofa):

- **A private pool court.** The pool (10 x 16 ft) sits in an L-shaped
  court at the rear left, walled on two sides, so it cannot be seen from
  the street. A strip beside it holds two loungers, shaded by the balcony
  above. The living space and the master bedroom both open onto it.
- **Pool shower + WC** (5.5 x 6 ft) between the pool and the living space,
  with a door to each: wet feet come in from the court, and it is also the
  guests' toilet.
- **One open living space.** Kitchen, dining and living are a single room
  33.5 x 20 ft with daylight from two sides. The sofa faces the garden.
- **Movement.** Gate, path and front door line up; the stairs rise along
  the left wall with room to step off at both ends; the kitchen end, the
  guest room's inside door and the master door are away from the sitting
  area, so nobody walks through it.
- **Ground floor for parents.** Master bedroom 13 x 15 ft with its own
  bath and a door to the pool, and a wardrobe in the room instead of a
  separate dressing room.
- **Guest room at the front** (12 x 12.5 ft) with its own door from the
  garden, plus an inside door at the kitchen end.
- **Upstairs:** a landing over the court, Bedroom 1 (13 x 15) with its own
  bath and a balcony over the pool, Bedroom 2 (12 x 15), a family lounge
  (16.25 x 15), Bedroom 3 (12 x 12.5) over the guest room, and a shared
  bath. A 12 x 12.5 ft terrace over the front garden opens off the lounge
  (and Bedroom 3), with an outdoor sofa set under a pergola; the patio
  below it is shaded for eating outside, and the left part of the garden
  with the tree stays open to the sky.
- **Outside look**, after a modern charcoal grey reference: ash grey render
  below and charcoal above, natural grey stacked stone on the guest room
  and Bedroom 2 fronts, a screen of black aluminium fins with a warm light
  strip over Bedroom 3, grey trim and boundary walls, glass railings.
- **Stairs** are 13.5 ft long, 16 risers of 19 cm.

Things to check with an architect before relying on it: structure
(the first floor spans the 33.5 ft living space, so it needs beams or
columns), setbacks and side windows allowed on your plot, plumbing stacks,
and which way the plot faces.

## Design C: curved roof (`?home=villa-c`)

Built from a short video of an architect's model that Surya sent: the
outside and the curved roofs follow the model; the ground floor inside is
design A's, unchanged.

- **Outside.** Grey concrete render, teak cladding on the left-hand rooms
  (guest room below, Bedroom 3 above, and the left side), a stone panel on
  the living room's front wall and on the glass lounge's side, grey
  concrete boundary walls, glass railings.
- **The curl.** Between Bedroom 3 and the glass lounge, a concrete roof
  comes down to a planter at first-floor level and sweeps up to the roof
  terrace over the lounge wall, with a rooflight in its steep part. Under
  its high end is a sit-out (about 3.5 ft of it has standing height); the
  low end is planted and cannot be walked into. The model's curve is
  steeper than a real slab would be built; ours keeps the same S shape.
- **First floor.** A's rear row unchanged (Bedrooms 1 and 2, bath,
  dressing). A landing with a sitting corner; the double-height void over
  the living room is now 10.7 x 14 ft. In front: Bedroom 3, 12 x 12.5 ft,
  with a door from the front corridor; the glass lounge, 13 x 14 ft, glass
  from floor to ceiling at the front and side, with a 5 ft balcony in front
  of it; a 5.5 x 5.5 ft bath off the lounge, over the ground floor toilet.
  A's 18 ft open balcony is gone.
- **Roof.** A second flight beside the first goes up to the roof: arrive
  on the landing, turn round, climb the other way (16 risers of 19 cm,
  treads of 27 cm, 1 m wide, with a full wall to the void). It ends in a
  stair room ("mumty") whose roof curls down over the terrace to a
  planter, as in the model. Doors from it open onto a front terrace over
  Bedroom 3 (glass railing, as in the model) and onto the main roof
  terrace (parapets, planters, loungers, the water tank).

Assumed, since the video does not show it: everything at the back and the
sides that the camera never sees, all window positions, and where the
second flight goes. Check with an architect: the curl and the stair room's
curved roof are shell structures that need a structural engineer.

## Design D: the model with the pool covered (`?home=villa-d`)

Generated by the Design D block of `scripts/make-villa.py`, which starts from design E and changes it.
Since 2026-11-14 it is design E's front, fixes and roof on design A's plan, with the pool court roofed over.

- **Ground floor:** A's rear row (kitchen, a 13 x 15 ft master bedroom with its bath and wardrobe) and A's pool court in the middle on the right (15 x 18.5 ft), now covered by the first floor and open only on the boundary side. E's front: the 7.5 ft front yard with a stone path, the teak guest room, the entrance hall with the first flight in its own shaft, and E's living + dining and kitchen. The shaft is glazed on the pool side. At the front-right: a guest toilet and a 15 x 6.25 ft gym off the hall, with a pool shower off the court.
- **First floor:** E's, plus the space over the pool. A full rear row is built: bedroom 2 (13.5 x 15), bedroom 4 (13.5 x 15) with its own bath and dressing. Behind E's landing are bedroom 1, bedroom 3 (the teak box), the glass lounge, the curl and the balcony.
- **Lounge (2026-11-14):** the garden under the curl is gone; the lounge runs from the teak box's wall to the right-hand wall (31.5 x 8.5 ft), glazed under the curl. Its left end sits under the low part of the curl (under 2 m of headroom left of about 8.5 ft), used as a nook with a low bench. Seating is at the right end round the side window, with a table for two by the glass; the middle is kept open for the roof stairs, the landing door and the balcony door. Only the planter strip and the ledge at the curl's foot stay outside.
- **Walkability (2026-11-14):** `tests/walkable.test.ts` walks every floor with a 50 cm wide person (`src/core/walkable.ts`). Changes it led to: kitchen door moved left of the dining chairs; dining table nearer the kitchen wall and a shorter corner sofa and media wall in the living room; the pool shrunk to 9 x 13.5 ft so a deck at least 50 cm wide runs round it; the powder room's basin and WC turned so the door opens clear; no armchair on the landing; bedroom 1's bed turned to the back wall so the dressing and bath doors are clear (and its old pool window dropped, since the wall now backs onto bedroom 4); bedroom 3 gets a queen bed with its head on the front wall and the wardrobe beside it, leaving the entrance passage open; bath 4's basin moved away from its door; the balcony seats moved clear of the lounge door.
- **Roof:** E's stair room and terrace. The curved roof now runs on down to the right-hand edge of the house, so the theater under it is 13.5 x 17 ft, with its low wall at 29 ft. The terrace covers the whole rear row.

## Design E: the model, whole house (`?home=villa-e`)

The architect's model laid out on our 35 x 55 ft plot, ground floor included.

- **Ground floor:** kitchen at the rear-left; a pool court at the rear, open to the sky, that the living + dining room and the master bedroom both open onto. The front door opens into an entrance hall (shoe cabinet, mirror, guest toilet); the first flight climbs from its back to the first floor in its own shaft, walled off from the living room, as open oak treads with a wall handrail. The living + dining room is through a doorway on the left: dining at the back under two pendants, an L sofa facing a slatted oak media wall on the shaft's wall. The master suite fills the right-hand side: bedroom on the pool, a walk-in wardrobe, and a master bath at the front where the study was (its front window now starts higher). The teak-clad guest room (10.5 x 12.25 ft) with three tall windows is at the front-left. A 4 ft side passage on the right leads from the 7.5 ft front yard back to the pool.
- **First floor:** bedroom 2 at the rear-left over the kitchen, bedroom 1 (with dressing and bath) on the right, bedroom 3 in the teak box at the front-left, and a shared bath off the landing. A corridor beside the stairwell leads to the lounge, glazed from floor to ceiling, with the balcony in front. In front of bedroom 3 the concrete curl rises from a planter ledge at the front-left corner to the roof slab, with a rooflight and glass under it and a planted garden behind the glass. There is a gap between the ledge and the balcony, as in the model.
- **Roof:** the slab over the lounge carries on over the balcony and past the right-hand wall. The stair room (7.25 to 15 ft, a door and a teak panel at the front) has a flat roof overhanging 3 ft on the left that carries on level, then sweeps down in one S to the terrace at 28.5 ft. Under the curve is a 9.5 x 17 ft theater, entered from the stair landing: full height on its left, the shell coming down to a low wall on its right, the shell's end walls closing it front and back. The glass railing stops at 18.25 ft; a planter sits out on the slab beyond it, leaving a walk in front of the theater.
