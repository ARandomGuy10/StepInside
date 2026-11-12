# The new house: where the numbers come from

Two scene files, one per floor: `villa-ground.json` and `villa-first.json`.
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
3. **Ceiling height** 3.0 m on both floors. The living room is not
   modelled as double height: a room has one ceiling height.
4. **Doors** are where the orange marks are, 2.1 m high and about 3 ft
   wide. The garden gate at the main entrance is not modelled.
5. **Windows** are not on the plans. Every window is a guess, including
   the tall ones from the living room and lounge towards the pool.
6. **North** is unknown. The top of the plan is treated as north.
7. **Stairs** are a model you cannot climb. Each floor is its own scene;
   switch floors on the start screen.
8. **The double-height void** on the first floor has full walls round
   it. In the design these would be glass or railings.
9. **The pool** is a flat surface at floor level that you can walk over.
   The court's outer side has a low railing where a boundary wall would be.
10. **Furniture** follows the symbols on the plans, with typical sizes.
