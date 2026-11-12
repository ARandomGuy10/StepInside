# home.json: where the numbers come from

Source: `docs/floorplan.png`. Photos of a neighbouring flat with the same
layout were used only for floor and wall colours and for window heights.

## Coordinates

- Metres. `[x, y]` as on the plan: x to the right, y down the page.
- The origin is the inside top-left corner of the living room.
- The top of the plan (the balcony side) is treated as west, because the
  sun sets on the balcony. So `northDeg` is 90: north points to the right.

## Read directly off the plan

| Room | Size (m) |
| --- | --- |
| Woonkamer | 3.49 wide, 7.44 long to the entree wall, ceiling 2.62 |
| Woonkamer + Keuken | 9.77 long in total |
| Entree | 0.92 x 2.24 |
| Keuken | 2.00 wide |
| Slaapkamer 3 | 1.98 x 4.06 |
| Slaapkamer 1 | 2.60 x 4.06 |
| Slaapkamer 2 | 2.60 x 3.96 |
| Hal | 2.85 x 1.07 |
| Badkamer | 1.97 x 2.98, plus the strip up to the hall door |
| Balkon | 5.62 wide (4.53 along the bedrooms), 1.25 deep |

## Assumptions

Each of these is a guess or an estimate. Correct the number in
`home.json` when a real measurement is available.

1. **Ceiling height** is 2.62 m everywhere. The plan only states it for
   the living room.
2. **Wall thicknesses** are not on the plan. They follow from the room
   positions: 0.20 m between the living room and the bedroom side,
   0.10 m between the two front bedrooms, 0.09 m around the hall,
   0.11 m between bathroom and bedroom 2, and 0.30 m for outside walls.
3. **Room positions** come from adding up the plan's dimensions from the
   bottom wall upwards. The front bedrooms therefore start 0.50 m below
   the living room's balcony wall, which matches the drawing.
4. **Interior doors** are 2.11 m high. Widths are 0.83 m (living to hall,
   entree to living, bedroom 3) and 0.73 m (bedroom 1, bedroom 2,
   bathroom), chosen to fit the wall space on the plan. Door positions
   are measured off the drawing, accurate to about 5 cm.
5. **Front door** is 0.86 m wide and 2.11 m high. It is drawn shut and
   cannot be walked through.
6. **Balcony doors** are 2.40 m high and 0.70 to 0.80 m wide. They are
   open doorways for now, with no glass.
7. **Windows**, from the photos and the drawing:
   - Living room: 2.55 m wide, sill at 0.65 m, top at 2.40 m.
   - Bedrooms 1 and 3: sill at 0.85 m, top at 2.40 m.
   - Bedroom 2: 1.80 m wide, sill at 0.95 m, top at 2.20 m.
   - Kitchen: 1.75 m wide, sill at 1.10 m, top at 2.20 m.
   - Bathroom: 0.65 m wide, sill at 1.40 m, top at 2.10 m.
8. **The pier** on the living room's left wall is 0.34 m deep and runs
   from 0.78 m to 2.10 m from the balcony wall, floor to ceiling.
9. **Closets and the meter cupboard** (the three Kast blocks and MK) are
   solid blocks, not rooms you can enter. The block beside the entree
   sticks 0.93 m into the living room, as drawn.
10. **Kitchen** is one room with the living room, with no wall between
    them. Counters and appliances are not part of the shell.
11. **Bathroom** is one L-shaped room with its door on the hall.
12. **Balcony** has a 1.00 m railing and no roof. The glass and frames
    of the balcony front are simplified.
13. **Colours**: white walls and ceilings, light oak laminate floors,
    grey bathroom tiles, grey balcony floor. The neighbour's accent
    walls are left out.
14. **Sun** comes from the west-south-west at 24 degrees above the
    horizon, a late afternoon.

## Furniture

The living room and kitchen pieces were placed from photos of the home.
Every position and size is an estimate by eye, good to perhaps 20 cm, and
every piece is a plain box until a model file exists for it (see
`public/models/README.md`). Notes:

- The L-shaped sofa is two boxes: the sofa and its chaise.
- The round dining table is drawn as a square box.
- The kitchen units are four pieces: a counter and a tall cabinet on each
  side. Wall-hung cabinets are left out.
- The other rooms have no furniture yet.
