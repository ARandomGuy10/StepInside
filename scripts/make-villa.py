#!/usr/bin/env python3
"""Writes scenes/villa-ground.json and scenes/villa-first.json.

The plans for the new house are dimensioned in feet, so the layout is
written down here in feet (x to the right, y down the page, origin at the
plot's rear-left corner) and converted to metres for the scene files.
Run it again after changing a number:  python3 scripts/make-villa.py
"""
import json, math, os

FT = 0.3048
EXT = 0.75   # outside wall thickness, feet
INT = 0.5    # inside wall thickness, feet
m = lambda ft: round(ft * FT, 3)


class Home:
    def __init__(self, name, start, yaw):
        self.rooms, self.openings, self.furniture, self.lights = [], [], [], []
        self.name, self.start, self.yaw = name, start, yaw

    def room(self, id, name, poly, kind=None, floor=None, lamp=True, walls=None):
        if len(poly) == 4 and not isinstance(poly[0], (list, tuple)):
            x0, y0, x1, y1 = poly
            poly = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        r = {"id": id, "name": name, "polygon": [[m(x), m(y)] for x, y in poly]}
        if kind: r["kind"] = kind
        if floor: r["floor"] = floor
        if walls: r["walls"] = walls
        self.rooms.append(r)
        r["_ft"] = poly
        if lamp and kind not in ("balcony", "void"):
            xs, ys = [p[0] for p in poly], [p[1] for p in poly]
            self.lights.append({"id": f"lamp-{id}", "position": [m((min(xs) + max(xs)) / 2), m((min(ys) + max(ys)) / 2)],
                                "height": 2.85, "color": "#ffe3bd", "intensity": 7, "style": "spot"})

    def opening(self, id, type, room, p, q, height=2.1, sill=None):
        """An opening from point p to point q (feet), both on one wall of `room`."""
        poly = next(r for r in self.rooms if r["id"] == room)["_ft"]
        for i, a in enumerate(poly):
            b = poly[(i + 1) % len(poly)]
            L = math.dist(a, b)
            def along(pt):
                t = ((pt[0] - a[0]) * (b[0] - a[0]) + (pt[1] - a[1]) * (b[1] - a[1])) / L
                off = abs((pt[0] - a[0]) * (b[1] - a[1]) - (pt[1] - a[1]) * (b[0] - a[0])) / L
                return t if off < 1e-6 and -1e-6 <= t <= L + 1e-6 else None
            tp, tq = along(p), along(q)
            if tp is None or tq is None: continue
            o = {"id": id, "type": type, "room": room, "edge": i, "offset": m(min(tp, tq)),
                 "width": m(abs(tq - tp)), "height": height}
            if sill is not None: o["sill"] = sill
            self.openings.append(o)
            return
        raise SystemExit(f"{id}: points are not on one wall of {room}")

    def door(self, id, room, p, q): self.opening(id, "door", room, p, q)
    def window(self, id, room, p, q, height=1.4, sill=0.9): self.opening(id, "window", room, p, q, height, sill)

    def put(self, id, name, model, room, x, y, rot, size, color, **extra):
        """x, y in feet; size is [width, height, depth] in metres."""
        self.furniture.append({"id": id, "name": name, "model": model, "room": room,
                               "position": [m(x), m(y)], "rotationDeg": rot, "size": size, "color": color, **extra})

    def hang(self, id, name, model, room, side, at, elevation, size, color):
        """Hangs a piece on a wall of a rectangular room. `side` is top, right,
        bottom or left on the plan; `at` is the position along that wall in feet."""
        poly = next(r for r in self.rooms if r["id"] == room)["_ft"]
        xs, ys = [p[0] for p in poly], [p[1] for p in poly]
        gap = (size[2] / 2 + 0.004) / FT
        x, y, rot = {"top": (at, min(ys) + gap, 180), "bottom": (at, max(ys) - gap, 0),
                     "left": (min(xs) + gap, at, 90), "right": (max(xs) - gap, at, 270)}[side]
        self.put(id, name, model, room, x, y, rot, size, color, mount="wall", elevation=elevation)

    def paint(self, room, **sides):
        """Accent walls: paint(room, top="#...", left="#...") for a rectangular room."""
        r = next(r for r in self.rooms if r["id"] == room)
        index = {"top": 0, "right": 1, "bottom": 2, "left": 3}
        walls = r.setdefault("walls", [])
        for side, color in sides.items():
            entry = next((w for w in walls if w["edge"] == index[side]), None)
            if entry: entry["color"] = color
            else: walls.append({"edge": index[side], "color": color})

    def write(self, path):
        for r in self.rooms: r.pop("_ft")
        scene = {
            "schemaVersion": 1, "name": self.name, "units": "m", "northDeg": 0,
            "sun": {"azimuthDeg": 220, "elevationDeg": 40, "intensity": 3.2, "color": "#fff1dc"},
            "defaults": {"ceilingHeight": 3.0, "exteriorWallThickness": m(EXT), "railingHeight": 1.1,
                         "wallColor": "#f1ece3", "floorColor": "#d9cdb8", "ceilingColor": "#f7f4ee",
                         "exteriorColor": self.exterior, "exteriorMaterial": getattr(self, "finish", "render"),
                         **({"roofRise": self.roofRise} if getattr(self, "roofRise", None) else {})},
            "start": {"position": [m(self.start[0]), m(self.start[1])], "yawDeg": self.yaw},
            **({"site": self.site} if getattr(self, "site", None) else {}),
            "rooms": self.rooms, "openings": self.openings, "lights": self.lights, "furniture": self.furniture,
        }
        # One room, opening, light or piece per line, like scenes/home.json.
        lines = ["{"]
        keys = list(scene)
        for k in keys:
            v, comma = scene[k], "," if k != keys[-1] else ""
            if isinstance(v, list):
                lines.append(f'  "{k}": [')
                lines += [f"    {json.dumps(item)}{',' if i < len(v) - 1 else ''}" for i, item in enumerate(v)]
                lines.append(f"  ]{comma}")
            else:
                lines.append(f'  "{k}": {json.dumps(v)}{comma}')
        lines.append("}")
        with open(path, "w") as f: f.write("\n".join(lines) + "\n")


BOUNDARY = "#ddd3c1"   # boundary walls of the plot
TILE = {"material": "large-tile", "color": "#e6e2da"}
BATH = {"material": "large-tile", "color": "#cfd8dc"}
DECK = {"material": "decking", "color": "#9a7352"}
OAK = {"material": "laminate", "color": "#c3a47c"}
GRASS = {"material": "lawn", "color": "#5f9e3c"}
WOOD, DARK, WHITE, FABRIC, GREEN = "#8a6243", "#3a2a22", "#f4f2ee", "#d9d3c6", "#7d8a74"

L, R, T, B = EXT, 35 - EXT, EXT, 55 - EXT          # inside faces of the outside walls
ROW1 = T + 15                                       # bottom of the rear row of rooms
MID0, MID1 = ROW1 + INT, ROW1 + INT + 25            # the middle band: dining + living, pool
ROW3 = MID1 + INT                                   # top of the front row
SPLIT = L + 18                                      # right side of the dining/living column

# ---------------------------------------------------------------- ground floor
g = Home("New house, ground floor", (15.5, 39), 0)
g.site = {"margin": 30, "color": "#8fb070"}
g.exterior = "#e6dcc8"   # light beige stone cladding
g.finish = "stone"
g.room("kitchen", "Kitchen", (L, T, L + 12, ROW1), floor=TILE)
g.room("master", "Master bedroom", (L + 12.5, T, L + 25.5, ROW1), floor=OAK)
g.room("bath", "Bath", (L + 26, T, R, T + 9), floor=BATH)
g.room("wardrobe", "Wardrobe", (L + 26, T + 9.5, R, ROW1))
g.room("living", "Dining + Living", (L, MID0, SPLIT, MID1), floor=TILE, lamp=False)
# The living half is double height, so its lamps hang under the lounge above the dining table.
for i, x in enumerate((6, 12)):
    g.lights.append({"id": f"lamp-dining-{i+1}", "position": [m(x), m(21)], "height": 2.85, "color": "#ffe3bd", "intensity": 7, "style": "spot"})
# The court's outer side is the plot's boundary wall, a full storey high.
g.room("pool-court", "Pool court", (SPLIT + INT, MID0, R, MID0 + 18.5), kind="balcony", floor=DECK,
       walls=[{"edge": 1, "height": 3.0, "color": BOUNDARY}])
g.room("toilet", "Toilet", (SPLIT + INT, MID0 + 19, SPLIT + 9, MID1), floor=BATH)
g.room("pool-shower", "Pool shower", (SPLIT + 9.5, MID0 + 19, R, MID1), floor=BATH)
g.room("guest", "Guest room", (L, ROW3, L + 12, B), floor=OAK)
# The garden's outer sides are the boundary wall, with the gate in the front.
g.room("garden", "Garden", (L + 12.5, ROW3, L + 32.5, B), kind="balcony", floor=GRASS,
       walls=[{"edge": 1, "height": 1.8, "color": BOUNDARY}, {"edge": 2, "height": 1.2, "color": BOUNDARY}])

# Paint: a calm off-white throughout, with one accent wall per room.
g.paint("kitchen", top="#5f7464", left="#5f7464")
g.paint("master", top="#44616b")
g.paint("living", left="#c9a58a")
g.paint("guest", left="#b98d7a")
g.paint("bath", top="#dfe7e6", right="#dfe7e6")
g.paint("toilet", top="#dfe7e6")

g.door("door-kitchen", "kitchen", (7, ROW1), (10, ROW1))
g.door("door-master", "master", (14, ROW1), (17, ROW1))
g.door("door-wardrobe", "wardrobe", (L + 26, 11.5), (L + 26, 14.25))
g.door("door-bath", "bath", (29.5, T + 9), (32, T + 9))
g.door("door-deck", "living", (SPLIT, MID0 + 0.5), (SPLIT, MID0 + 3.5))
g.door("door-toilet", "living", (SPLIT, 36.5), (SPLIT, 39))
g.door("door-pool-shower", "pool-shower", (31, MID0 + 19), (33.5, MID0 + 19))
g.door("door-guest", "living", (8.5, MID1), (11.25, MID1))
g.door("door-main", "living", (14, MID1), (17.25, MID1))
g.door("gate", "garden", (14.25, B), (18.25, B))
g.door("door-guest-garden", "guest", (L + 12, 43), (L + 12, 45.75))
g.window("win-kitchen", "kitchen", (4, T), (9.5, T), 1.1, 1.1)
g.window("win-kitchen-side", "kitchen", (L, 6), (L, 10), 1.1, 1.1)
g.window("win-master", "master", (16, T), (23.5, T))
g.window("win-bath", "bath", (29.5, T), (31.5, T), 0.6, 1.7)
g.window("win-dining", "living", (L, 18), (L, 23.5))
g.window("win-pool-1", "living", (SPLIT, 21.5), (SPLIT, 27), 2.1, 0.3)
g.window("win-pool-2", "living", (SPLIT, 28.5), (SPLIT, 34), 2.1, 0.3)
g.window("win-guest", "guest", (3, B), (9, B))
g.window("win-guest-side", "guest", (L, 46), (L, 51))

g.put("counter-left", "Kitchen counter with sink", "kitchen-counter-sink", "kitchen", 1.75, 7.5, 90, [2.74, 0.9, 0.6], "#ecebe6")
g.put("counter-rear", "Kitchen counter with hob", "kitchen-counter-hob", "kitchen", 6.5, 1.75, 180, [2.4, 0.9, 0.6], "#ecebe6")
g.put("fridge", "Fridge cabinet", "kitchen-tall", "kitchen", 11.6, 1.8, 180, [0.6, 2.1, 0.6], "#ecebe6")
g.put("island", "Kitchen island", "kitchen-island", "kitchen", 7, 8.5, 0, [1.6, 0.9, 0.8], WHITE)
g.put("master-bed", "Master bed", "bed", "master", 19.75, 4.6, 180, [1.8, 0.95, 2.1], "#8f97a3")
g.put("master-table-1", "Bedside table", "side-table", "master", 15.6, 2, 0, [0.45, 0.5, 0.45], WOOD)
g.put("master-table-2", "Bedside table", "side-table", "master", 23.9, 2, 0, [0.45, 0.5, 0.45], WOOD)
g.put("wardrobe-1", "Wardrobe", "wardrobe", "wardrobe", 33.1, 12.9, 270, [1.5, 2.2, 0.6], "#e9e6df")
g.put("bath-shower", "Shower", "shower", "bath", 28.6, 2.6, 0, [1.0, 2.0, 1.0], "#cfe0e2")
g.put("bath-toilet", "Toilet", "toilet", "bath", 32.9, 2.1, 180, [0.4, 0.78, 0.68], WHITE)
g.put("bath-basin", "Basin", "basin", "bath", 33.3, 7.2, 270, [0.6, 0.85, 0.48], WOOD)
g.put("dining-table", "Dining table", "dining-table", "living", 9, 20.9, 0, [1.9, 0.75, 0.95], WOOD)
for i, x in enumerate((7, 9, 11)):
    g.put(f"chair-rear-{i+1}", "Dining chair", "dining-chair", "living", x, 18.7, 180, [0.5, 0.9, 0.5], "#7a4a35")
    g.put(f"chair-front-{i+1}", "Dining chair", "dining-chair", "living", x, 23.1, 0, [0.5, 0.9, 0.5], "#7a4a35")
g.put("rug", "Rug", "rug", "living", 12, 31.5, 0, [2.4, 0.02, 3.2], "#b8a98c")
g.put("sofa", "Sofa", "sofa", "living", 8.8, 31.5, 90, [2.4, 0.8, 0.95], FABRIC)
g.put("armchair", "Armchair", "armchair", "living", 12.8, 26.7, 180, [0.85, 0.8, 0.85], GREEN)
g.put("coffee-table", "Coffee table", "coffee-table", "living", 12.8, 31.5, 90, [1.1, 0.42, 0.6], DARK)
g.put("tv-unit", "TV unit", "tv-unit", "living", 17.9, 31.2, 270, [1.8, 0.55, 0.42], WOOD)
# The flight starts three feet short of the guest room wall and climbs
# towards the rear, into a notch in the lounge above, so there is room to
# step on and off at both ends. 16 risers of 19 cm, treads of 27 cm.
# src/homes.ts holds the same rectangle, for walking up it.
STAIR_X0, STAIR_X1, STAIR_Y0, STAIR_Y1 = 0.75, 4.05, 38.25, 24.25
g.put("stairs", "Staircase", "stairs", "living", (STAIR_X0 + STAIR_X1) / 2, (STAIR_Y0 + STAIR_Y1) / 2, 0,
      [m(STAIR_X1 - STAIR_X0), 3.05, m(STAIR_Y0 - STAIR_Y1)], "#c9c2b6", fixed=True)
g.put("toilet-wc", "Toilet", "toilet", "toilet", 22.5, 36.4, 180, [0.4, 0.78, 0.68], WHITE)
g.put("toilet-basin", "Basin", "basin", "toilet", 25.6, 36.1, 180, [0.6, 0.85, 0.48], WOOD)
g.put("pool-shower-tray", "Shower", "shower", "pool-shower", 31.25, 39.2, 0, [1.1, 2.0, 1.1], "#cfe0e2")
g.put("pool", "Swimming pool", "pool", "pool-court", 25.25, MID0 + 2 + 8.25, 0, [m(12), 0.06, m(16.5)], "#3fa9d6")
g.put("lounger-1", "Sun lounger", "lounger", "pool-court", 32.8, 22.2, 0, [0.7, 0.4, 1.9], WHITE)
g.put("lounger-2", "Sun lounger", "lounger", "pool-court", 32.8, 29.6, 0, [0.7, 0.4, 1.9], WHITE)
g.put("guest-bed", "Guest bed", "bed", "guest", 4.6, 47.6, 90, [1.6, 0.9, 2.0], GREEN)
g.put("guest-table", "Bedside table", "side-table", "guest", 1.8, 43.3, 0, [0.45, 0.5, 0.45], WOOD)
g.put("guest-wardrobe", "Wardrobe", "wardrobe", "guest", 11.7, 50, 270, [1.2, 2.2, 0.55], "#e9e6df")
# Decor: art on the walls, plants, lamps and small things on the tables.
g.hang("art-master", "Painting", "painting-1", "master", "right", 6.5, 1.3, [1.2, 0.8, 0.04], "#2b2520")
g.hang("art-dining", "Painting", "painting-2", "living", "top", 12.2, 1.2, [0.7, 1.0, 0.04], "#d8c7a6")
g.hang("art-guest", "Painting", "painting-3", "guest", "top", 4.2, 1.35, [0.7, 0.7, 0.04], "#f2f0ea")
g.hang("mirror-toilet", "Round mirror", "wall-mirror", "toilet", "right", 38.5, 1.25, [0.6, 0.6, 0.04], "#b08d4c")
g.put("plant-living", "Rubber plant", "floor-plant", "living", 16.9, 26.8, 0, [0.7, 1.7, 0.7], "#d8d2c6")
g.put("plant-dining", "Rubber plant", "floor-plant", "living", 2.1, 17.9, 0, [0.6, 1.4, 0.6], "#3d3a36")
g.put("plant-master", "Rubber plant", "floor-plant", "master", 14.6, 13.6, 0, [0.6, 1.5, 0.6], "#d8d2c6")
g.put("lamp-living", "Floor lamp", "floor-lamp", "living", 6.4, 26.4, 0, [0.4, 1.6, 0.4], "#2b2b2b")
g.put("vase-dining", "Vase", "vase", "living", 9, 20.9, 0, [0.2, 0.5, 0.2], "#c7b299", elevation=0.75)
g.put("books-coffee", "Stack of books", "books", "living", 12.8, 30.6, 20, [0.24, 0.12, 0.17], "#8a3b2e", elevation=0.42)
g.put("plant-coffee", "Small plant", "table-plant", "living", 12.8, 32.4, 0, [0.22, 0.3, 0.22], "#e9e3d8", elevation=0.42)
g.put("table-lamp-master-1", "Table lamp", "table-lamp", "master", 15.6, 2, 0, [0.28, 0.5, 0.28], "#d9d2c3", elevation=0.5)
g.put("table-lamp-master-2", "Table lamp", "table-lamp", "master", 23.9, 2, 0, [0.28, 0.5, 0.28], "#d9d2c3", elevation=0.5)
g.put("table-lamp-guest", "Table lamp", "table-lamp", "guest", 1.8, 43.3, 0, [0.28, 0.5, 0.28], "#d9d2c3", elevation=0.5)
g.put("rug-master", "Rug", "rug", "master", 19.75, 9.5, 0, [2.4, 0.02, 1.4], "#c9bfae")
# The garden. Most of it is under the balcony, so it has no tree: stepping
# stones in white pebbles from the gate to the front door, a flagstone
# patio with a bench, clipped box balls on the lawn and planted borders.
g.put("garden-path", "Stepping stones", "stepping-path", "garden", 16.25, (ROW3 + B) / 2, 0, [1.2, 0.06, m(B - ROW3)], "#8e8c87")
g.put("garden-patio", "Flagstone patio", "stepping-path", "garden", 25, 44.5, 0, [m(10), 0.06, m(4.5)], "#9a9893")
g.put("garden-border-side", "Planted border", "planting-bed", "garden", 32.35, 49.5, 0, [0.5, 0.75, m(9)], "#8b8478")
g.put("garden-border-front", "Planted border", "planting-bed", "garden", 25.25, 53.4, 0, [m(12), 0.6, 0.45], "#8b8478")
g.put("garden-flowers", "Flower box", "flower-box", "garden", 13.9, 51.5, 90, [m(5), 0.55, 0.35], "#4a4844")
g.put("garden-bench", "Garden bench", "bench", "garden", 25, 42.9, 180, [1.5, 0.85, 0.55], "#8a6243")
for i, (x, y, s) in enumerate(((19.4, 46, 0.55), (19.4, 50.5, 0.6), (23, 49.5, 0.8), (26.5, 50.5, 0.6), (29.5, 48.5, 0.7))):
    g.put(f"garden-ball-{i+1}", "Box ball", "shrub-ball", "garden", x, y, 0, [s, s * 0.92, s], "#3f6b34")
g.put("garden-pot-2", "Rubber plant", "floor-plant", "garden", 31.6, 43.3, 0, [0.6, 1.2, 0.6], "#3d3a36")
g.put("pool-planter", "Planter", "planter", "pool-court", 28, 17.05, 0, [1.8, 1.1, 0.4], "#4a4844")

# ----------------------------------------------------------------- first floor
f = Home("New house, first floor", (10, 21), 180)
f.exterior = "#efe7d8"   # the same stone, a shade lighter, above
f.finish = "stone"
f.roofRise = 1.5
f.room("bedroom2", "Bedroom 2", (L, T, L + 13.5, ROW1), floor=OAK)
f.room("bedroom1", "Bedroom 1", (L + 14, T, L + 27.5, ROW1), floor=OAK)
f.room("bath1", "Bath", (L + 28, T, R, T + 10), floor=BATH)
f.room("dressing", "Dressing", (L + 28, T + 10.5, R, ROW1))
# The lounge wraps round the double-height void: the stairs come up its
# left arm, and its right arm is the passage to bedroom 3 and the balcony.
# The stairs arrive in a notch at the end of its left arm.
NOTCH = STAIR_X1 + 0.2
f.room("lounge", "Sitting lounge", [(L, MID0), (SPLIT, MID0), (SPLIT, MID1), (SPLIT - 3.5, MID1), (SPLIT - 3.5, MID0 + 10),
                                     (NOTCH, MID0 + 10), (NOTCH, STAIR_Y1), (L, STAIR_Y1)], floor=TILE)
# One hole in the floor for the stairwell and the double-height space
# over the living room. The lounge and passage get a guard rail along it.
# It stops a guard rail's thickness short of the lounge, so the outside wall has no slit.
RAIL = 0.05 / FT
f.room("void", "Double-height void", [(L, STAIR_Y1 + RAIL), (NOTCH - RAIL, STAIR_Y1 + RAIL), (NOTCH - RAIL, MID0 + 10 + RAIL),
                                      (SPLIT - 3.5 - RAIL, MID0 + 10 + RAIL), (SPLIT - 3.5 - RAIL, MID1), (L, MID1)], kind="void",
       walls=[{"edge": 5, "color": "#c9a58a"}])
# These two keep a full wall towards the void (a wall height of their own).
f.room("bath3", "Bath", (L, ROW3, L + 5.5, B), floor=BATH, walls=[{"edge": 0, "height": 3.0}])
f.room("bedroom3", "Bedroom 3", (L + 6, ROW3, SPLIT, B), floor=OAK, walls=[{"edge": 0, "height": 3.0}])
f.room("balcony", "Balcony", (SPLIT + INT, B - 18, R, B), kind="balcony", floor=DECK)

f.paint("bedroom2", top="#6d7f9a")
f.paint("bedroom1", top="#8a9a83")
f.paint("bedroom3", bottom="#c2a15f")
f.paint("bath1", top="#dfe7e6", right="#dfe7e6")
f.paint("bath3", left="#dfe7e6", bottom="#dfe7e6")

f.door("stair-head", "lounge", (L + 0.05, STAIR_Y1), (STAIR_X1 - 0.05, STAIR_Y1))
f.door("door-bedroom2", "bedroom2", (2.5, ROW1), (5.5, ROW1))
f.door("door-bedroom1", "bedroom1", (15.25, ROW1), (18.25, ROW1))
f.door("door-dressing", "dressing", (L + 28, 12.25), (L + 28, 15))
f.door("door-bath1", "bath1", (30.5, T + 10), (33, T + 10))
f.door("door-bedroom3", "bedroom3", (15.75, ROW3), (18.25, ROW3))
f.door("door-bath3", "bath3", (L + 5.5, 43.5), (L + 5.5, 46))
f.door("door-balcony", "lounge", (SPLIT, 37.25), (SPLIT, 40.25))
f.door("door-bedroom3-balcony", "bedroom3", (SPLIT, 43.5), (SPLIT, 46.25))
f.window("win-bedroom2", "bedroom2", (4, T), (10.5, T))
f.window("win-bedroom1", "bedroom1", (18, T), (24.5, T))
f.window("win-bath1", "bath1", (30.5, T), (32.5, T), 0.6, 1.7)
f.window("win-lounge", "lounge", (L, 18), (L, 23.5))
f.window("win-lounge-pool", "lounge", (SPLIT, 18), (SPLIT, 25), 2.1, 0.3)
f.window("win-passage-pool", "lounge", (SPLIT, 27.5), (SPLIT, 34.5), 2.1, 0.3)
f.window("win-bedroom3", "bedroom3", (9.5, B), (15.5, B))
f.window("win-bath3", "bath3", (L, 47.5), (L, 49.5), 0.6, 1.7)

f.put("bed2", "Bed", "bed", "bedroom2", 7.5, 4.6, 180, [1.8, 0.95, 2.1], "#5d7fa3")
f.put("bed2-table-1", "Bedside table", "side-table", "bedroom2", 3.4, 2, 0, [0.45, 0.5, 0.45], WOOD)
f.put("bed2-table-2", "Bedside table", "side-table", "bedroom2", 11.6, 2, 0, [0.45, 0.5, 0.45], WOOD)
f.put("bed2-wardrobe", "Wardrobe", "wardrobe", "bedroom2", 1.8, 10.5, 90, [1.5, 2.2, 0.6], "#e9e6df")
f.put("bed2-armchair", "Armchair", "armchair", "bedroom2", 11.7, 11.6, 270, [0.8, 0.8, 0.8], FABRIC)
f.put("bed1", "Bed", "bed", "bedroom1", 21.5, 4.6, 180, [1.8, 0.95, 2.1], "#7d8a74")
f.put("bed1-table-1", "Bedside table", "side-table", "bedroom1", 17.4, 2, 0, [0.45, 0.5, 0.45], WOOD)
f.put("bed1-table-2", "Bedside table", "side-table", "bedroom1", 25.6, 2, 0, [0.45, 0.5, 0.45], WOOD)
f.put("bed1-armchair", "Armchair", "armchair", "bedroom1", 25.7, 11.6, 270, [0.8, 0.8, 0.8], FABRIC)
f.put("bath1-toilet", "Toilet", "toilet", "bath1", 30, 2.1, 180, [0.4, 0.78, 0.68], WHITE)
f.put("bath1-shower", "Shower", "shower", "bath1", 32.7, 2.4, 0, [0.9, 2.0, 0.9], "#cfe0e2")
f.put("bath1-basin", "Basin", "basin", "bath1", 33.3, 7.8, 270, [0.6, 0.85, 0.48], WOOD)
f.put("dressing-wardrobe", "Wardrobe", "wardrobe", "dressing", 31.5, 14.6, 0, [1.4, 2.2, 0.55], "#e9e6df")
# The seating keeps clear of the top of the stairs and the way to bedroom 2.
f.put("lounge-tv", "TV unit", "tv-unit", "lounge", 10, 16.95, 180, [1.8, 0.55, 0.42], WOOD)
f.put("lounge-rug", "Rug", "rug", "lounge", 10, 20.5, 0, [3.0, 0.02, 2.0], "#b8a98c")
f.put("lounge-sofa", "Sofa", "sofa", "lounge", 10, 23, 0, [2.0, 0.8, 0.9], FABRIC)
f.put("lounge-table", "Side table", "side-table", "lounge", 5.4, 23, 0, [0.7, 0.42, 0.7], DARK)
f.put("lounge-armchair", "Armchair", "armchair", "lounge", 15.5, 20.5, 270, [0.85, 0.8, 0.85], WHITE)
f.put("bed3", "Bed", "bed", "bedroom3", 12.75, 50.6, 0, [1.6, 0.95, 2.0], "#5b6b84")
f.put("bed3-unit", "TV unit", "tv-unit", "bedroom3", 7.6, 46.5, 90, [1.6, 0.55, 0.42], WOOD)
f.put("bath3-toilet", "Toilet", "toilet", "bath3", 2.1, 42.9, 180, [0.4, 0.78, 0.68], WHITE)
f.put("bath3-basin", "Basin", "basin", "bath3", 1.65, 46.6, 90, [0.6, 0.85, 0.48], WOOD)
f.put("bath3-shower", "Shower", "shower", "bath3", 3.5, 51.6, 0, [1.2, 2.0, 1.2], "#cfe0e2")
# The balcony: dining at the rear end, and a lounge under a pergola at the front.
f.put("balcony-table", "Round table", "round-table", "balcony", 26.5, 40.5, 0, [1.1, 0.75, 1.1], "#5a3324")
for i, (x, y) in enumerate(((26.5, 38.2), (28.8, 40.5), (26.5, 42.8), (24.2, 40.5))):
    f.put(f"balcony-chair-{i+1}", "Chair", "dining-chair", "balcony", x, y, (180, 270, 0, 90)[i], [0.5, 0.9, 0.5], "#7a4a35")
f.put("balcony-pergola", "Pergola", "pergola", "balcony", 27, 48, 0, [3.4, 2.4, 2.6], "#8a6243")
f.put("balcony-rug", "Outdoor rug", "rug", "balcony", 27, 48.5, 0, [3.0, 0.02, 2.2], "#b9b4a8")
f.put("balcony-sofa", "Outdoor sofa", "sofa", "balcony", 27, 51.1, 0, [2.2, 0.75, 0.9], "#c9c2b4")
f.put("balcony-armchair-1", "Outdoor armchair", "armchair", "balcony", 22.9, 47.8, 90, [0.8, 0.75, 0.8], "#c9c2b4")
f.put("balcony-armchair-2", "Outdoor armchair", "armchair", "balcony", 31.1, 47.8, 270, [0.8, 0.75, 0.8], "#c9c2b4")
f.put("balcony-coffee", "Coffee table", "coffee-table", "balcony", 27, 47.8, 0, [1.1, 0.4, 0.6], "#3a2a22")
for i, x in enumerate((23.0, 30.5)):
    f.put(f"balcony-flowers-front-{i+1}", "Flower box", "flower-box", "balcony", x, B - 0.62, 0, [2.2, 0.6, 0.35], "#f2efe9")
f.put("balcony-flowers-side", "Flower box", "flower-box", "balcony", R - 0.62, 43, 270, [2.4, 0.6, 0.35], "#f2efe9")
f.put("balcony-planter-2", "Planter", "planter", "balcony", 19.95, 41.9, 0, [0.4, 1.1, 0.75], "#4a4844")
f.hang("art-bed2", "Painting", "painting-1", "bedroom2", "left", 5, 1.3, [1.2, 0.8, 0.04], "#2b2520")
f.hang("art-bed1", "Painting", "painting-3", "bedroom1", "right", 6, 1.3, [0.8, 0.8, 0.04], "#f2f0ea")
f.hang("art-bed3", "Painting", "painting-2", "bedroom3", "left", 51.6, 1.3, [0.6, 0.9, 0.04], "#d8c7a6")
f.put("plant-lounge", "Rubber plant", "floor-plant", "lounge", 14.2, 17.2, 0, [0.5, 1.3, 0.5], "#d8d2c6")
f.put("plant-bed1", "Rubber plant", "floor-plant", "bedroom1", 27, 8, 0, [0.6, 1.4, 0.6], "#3d3a36")
f.put("table-lamp-bed2-1", "Table lamp", "table-lamp", "bedroom2", 3.4, 2, 0, [0.28, 0.5, 0.28], "#d9d2c3", elevation=0.5)
f.put("table-lamp-bed2-2", "Table lamp", "table-lamp", "bedroom2", 11.6, 2, 0, [0.28, 0.5, 0.28], "#d9d2c3", elevation=0.5)
f.put("table-lamp-bed1-1", "Table lamp", "table-lamp", "bedroom1", 17.4, 2, 0, [0.28, 0.5, 0.28], "#d9d2c3", elevation=0.5)
f.put("table-lamp-bed1-2", "Table lamp", "table-lamp", "bedroom1", 25.6, 2, 0, [0.28, 0.5, 0.28], "#d9d2c3", elevation=0.5)
f.put("plant-lounge-table", "Small plant", "table-plant", "lounge", 5.4, 23, 0, [0.22, 0.3, 0.22], "#e9e3d8", elevation=0.42)


# =============================================================================
# Design B: a courtyard house on the same 35 x 55 ft plot.
#
# The ideas behind it:
# - The pool sits in a private L-shaped court at the rear, hidden from the
#   street. The living space and the master bedroom both open onto it.
# - Next to the pool, a pool shower with a WC: wet feet come in from the
#   court, and the same room is the guests' toilet from the living room.
# - Kitchen, dining and living are one room across the full width of the
#   plot, lit from two sides: the pool court behind and the garden in front.
# - The ground floor is for parents: the master bedroom has its own bath and
#   a wardrobe in the room, with no separate dressing room.
# - Bedrooms keep the sizes of the original plans (13 x 15, 13.5 x 15,
#   12 x 12.5 ft), so the garden and court get the rest.
# - The guest room is at the front with its own door from the garden. Its
#   inside door is at the kitchen end, away from the sofa.
# - The stairs rise along the left wall with room to step off at both ends.
# =============================================================================
GY0, GY1 = 21.25, 41.25   # the great room, rear to front
FY = GY1 + INT            # top of the front band
GX = 21.75                # right side of the garden; the guest room starts half a foot on
SY0, SY1 = 39.25, 25.75   # the stairs: first step, top step
DARK_TILE = {"material": "large-tile", "color": "#d7d2c8"}

h = Home("Courtyard house, ground floor", (17.75, 39.5), 0)
h.site = {"margin": 30, "color": "#8fb070"}
h.exterior = "#e3d8c4"    # beige stone cladding below
h.finish = "stone"
h.room("pool-court", "Pool court", [(L, T), (25.25, T), (25.25, 5.25), (20.75, 5.25), (20.75, 14.25), (14.75, 14.25),
                                    (14.75, 20.75), (L, 20.75)], kind="balcony", floor=DECK,
       walls=[{"edge": 0, "height": 3.0, "color": BOUNDARY}, {"edge": 7, "height": 3.0, "color": BOUNDARY}])
h.room("bath", "Bath", (25.75, T, R, 5.25), floor=BATH)
h.room("master", "Master bedroom", (21.25, 5.75, R, 20.75), floor=OAK)
h.room("pool-shower", "Pool shower + WC", (15.25, 14.75, 20.75, 20.75), floor=BATH)
h.room("great", "Living + Dining + Kitchen", (L, GY0, R, GY1), floor=DARK_TILE, lamp=False)
for i, (x, y) in enumerate(((10.5, 35), (20, 28), (28, 26), (26, 37))):
    h.lights.append({"id": f"lamp-great-{i+1}", "position": [m(x), m(y)], "height": 2.85, "color": "#ffe3bd", "intensity": 7, "style": "spot"})
h.room("garden", "Garden", (L, FY, GX, B), kind="balcony", floor=GRASS,
       walls=[{"edge": 3, "height": 1.8, "color": BOUNDARY}, {"edge": 2, "height": 1.2, "color": BOUNDARY}])
h.room("guest", "Guest room", (GX + INT, FY, R, B), floor=OAK)
h.paint("master", right="#3f4f4a")
h.paint("guest", right="#9c7b62")
h.paint("bath", top="#dfe7e6", right="#dfe7e6")
h.paint("pool-shower", top="#dfe7e6")
h.paint("great", left="#b9a892")   # the stair wall

h.door("door-court", "great", (6, GY0), (9.5, GY0))
h.door("door-pool-shower-court", "pool-shower", (15.25, 17.5), (15.25, 20))
h.door("door-pool-shower", "pool-shower", (16, 20.75), (18.5, 20.75))
h.door("door-master", "master", (22.5, 20.75), (25.5, 20.75))
h.door("door-master-court", "master", (21.25, 9), (21.25, 12.5))
h.door("door-bath", "master", (27, 5.75), (29.5, 5.75))
h.door("door-main", "great", (16, GY1), (19.5, GY1))
h.door("door-guest", "great", (30, GY1), (32.75, GY1))
h.door("door-guest-garden", "guest", (GX + INT, 44), (GX + INT, 46.75))
h.door("gate", "garden", (15.75, B), (19.75, B))
h.window("win-great-court-1", "great", (1.5, GY0), (5, GY0), 2.1, 0.3)
h.window("win-great-court-2", "great", (10.5, GY0), (14.25, GY0), 2.1, 0.3)
h.window("win-kitchen", "great", (R, 23), (R, 27), 0.9, 1.2)
h.window("win-great-garden", "great", (5, GY1), (14.5, GY1), 2.1, 0.3)
h.window("win-master-court", "master", (21.75, 5.75), (24.75, 5.75))
h.window("win-bath", "bath", (29, T), (31, T), 0.6, 1.7)
h.window("win-guest", "guest", (27.5, B), (30.5, B))

# src/homes.ts holds the same rectangle, for walking up it.
h.put("stairs", "Staircase", "stairs", "great", 2.625, (SY0 + SY1) / 2, 0, [m(3.65), 3.05, m(SY0 - SY1)], "#ece8e0", fixed=True)
h.put("counter-hob", "Kitchen counter with hob", "kitchen-counter-hob", "great", 33.2, 25.4, 270, [2.4, 0.9, 0.6], "#2f3331")
h.put("fridge", "Fridge cabinet", "kitchen-tall", "great", 33.2, 30.6, 270, [0.6, 2.1, 0.6], "#2f3331")
h.put("island", "Kitchen island", "kitchen-island", "great", 27.5, 26, 90, [2.4, 0.9, 0.95], "#f4f2ee")
h.put("dining-table", "Dining table", "dining-table", "great", 20, 28, 0, [2.2, 0.75, 1.0], WOOD)
for i, x in enumerate((17.5, 20, 22.5)):
    h.put(f"chair-rear-{i+1}", "Dining chair", "dining-chair", "great", x, 25.9, 180, [0.5, 0.9, 0.5], "#2f2f2f")
    h.put(f"chair-front-{i+1}", "Dining chair", "dining-chair", "great", x, 30.1, 0, [0.5, 0.9, 0.5], "#2f2f2f")
h.put("vase-dining", "Vase", "vase", "great", 20, 28, 0, [0.2, 0.5, 0.2], "#c7b299", elevation=0.75)
# The sofa faces the garden; two armchairs close the circle.
h.put("rug", "Rug", "rug", "great", 10.5, 36, 0, [2.8, 0.02, 2.0], "#b8a98c")
h.put("sofa", "Sofa", "sofa", "great", 10.5, 32.8, 180, [2.4, 0.8, 0.95], FABRIC)
h.put("armchair-1", "Armchair", "armchair", "great", 6.5, 37.5, 90, [0.85, 0.8, 0.85], GREEN)
h.put("armchair-2", "Armchair", "armchair", "great", 14.5, 37.5, 270, [0.85, 0.8, 0.85], GREEN)
h.put("coffee-table", "Coffee table", "coffee-table", "great", 10.5, 36, 0, [1.1, 0.42, 0.6], DARK)
h.put("books-coffee", "Stack of books", "books", "great", 10, 36, 20, [0.24, 0.12, 0.17], "#8a3b2e", elevation=0.42)
h.put("lamp-living", "Floor lamp", "floor-lamp", "great", 5.6, 33, 0, [0.4, 1.6, 0.4], "#2b2b2b")
h.put("sideboard", "Sideboard", "sideboard", "great", 25, 40.5, 0, [1.8, 0.8, 0.45], WOOD)
h.put("table-lamp-sideboard", "Table lamp", "table-lamp", "great", 24, 40.5, 0, [0.28, 0.5, 0.28], "#d9d2c3", elevation=0.8)
h.put("plant-entry", "Rubber plant", "floor-plant", "great", 21, 40.2, 0, [0.6, 1.6, 0.6], "#d8d2c6")
h.put("plant-great", "Rubber plant", "floor-plant", "great", 33.2, 34, 0, [0.6, 1.5, 0.6], "#3d3a36")
h.put("master-bed", "Master bed", "bed", "master", 30.8, 13, 270, [1.8, 0.95, 2.1], "#8f97a3")
h.put("master-table-1", "Bedside table", "side-table", "master", 33.5, 9.2, 0, [0.45, 0.5, 0.45], WOOD)
h.put("master-table-2", "Bedside table", "side-table", "master", 33.5, 16.8, 0, [0.45, 0.5, 0.45], WOOD)
h.put("table-lamp-master-1", "Table lamp", "table-lamp", "master", 33.5, 9.2, 0, [0.28, 0.5, 0.28], "#d9d2c3", elevation=0.5)
h.put("table-lamp-master-2", "Table lamp", "table-lamp", "master", 33.5, 16.8, 0, [0.28, 0.5, 0.28], "#d9d2c3", elevation=0.5)
h.put("master-wardrobe", "Wardrobe", "wardrobe", "master", 22.25, 15.5, 90, [1.5, 2.2, 0.6], "#e9e6df")
h.put("master-armchair", "Armchair", "armchair", "master", 26, 18.6, 0, [0.8, 0.8, 0.8], FABRIC)
h.put("rug-master", "Rug", "rug", "master", 28, 13, 90, [2.6, 0.02, 1.5], "#c9bfae")
h.put("bath-shower", "Shower", "shower", "bath", 32.6, 3, 0, [1.0, 2.0, 1.0], "#cfe0e2")
h.put("bath-toilet", "Toilet", "toilet", "bath", 28.5, 1.9, 180, [0.4, 0.78, 0.68], WHITE)
h.put("bath-basin", "Basin", "basin", "bath", 26.6, 3, 90, [0.6, 0.85, 0.48], WOOD)
h.put("pool-shower-tray", "Shower", "shower", "pool-shower", 19.1, 16.4, 0, [1.0, 2.0, 1.0], "#cfe0e2")
h.put("pool-shower-toilet", "Toilet", "toilet", "pool-shower", 16.2, 15.9, 180, [0.4, 0.78, 0.68], WHITE)
h.put("pool-shower-basin", "Basin", "basin", "pool-shower", 19.9, 19.5, 270, [0.6, 0.85, 0.48], WOOD)
h.put("guest-bed", "Guest bed", "bed", "guest", 30.95, 49.5, 270, [1.6, 0.9, 2.0], GREEN)
h.put("guest-table-1", "Bedside table", "side-table", "guest", 33.5, 45.9, 0, [0.45, 0.5, 0.45], WOOD)
h.put("guest-table-2", "Bedside table", "side-table", "guest", 33.5, 53.1, 0, [0.45, 0.5, 0.45], WOOD)
h.put("table-lamp-guest", "Table lamp", "table-lamp", "guest", 33.5, 45.9, 0, [0.28, 0.5, 0.28], "#d9d2c3", elevation=0.5)
h.put("guest-wardrobe", "Wardrobe", "wardrobe", "guest", 24.5, 53.3, 0, [1.2, 2.2, 0.55], "#e9e6df")
h.hang("art-guest", "Painting", "painting-3", "guest", "top", 27, 1.35, [0.7, 0.7, 0.04], "#f2f0ea")
h.put("pool", "Swimming pool", "pool", "pool-court", 7.75, 10.75, 0, [m(10), 0.06, m(16)], "#3fa9d6")
h.put("lounger-1", "Sun lounger", "lounger", "pool-court", 16.5, 9.5, 0, [0.7, 0.4, 1.9], WHITE)
h.put("lounger-2", "Sun lounger", "lounger", "pool-court", 19, 9.5, 0, [0.7, 0.4, 1.9], WHITE)
h.put("pool-planter", "Planter", "planter", "pool-court", 1.75, 10.75, 0, [0.4, 1.2, 3.0], "#4a4844")
h.put("court-ball-1", "Box ball", "shrub-ball", "pool-court", 21.8, 2.6, 0, [0.55, 0.5, 0.55], "#3f6b34")
h.put("court-ball-2", "Box ball", "shrub-ball", "pool-court", 24.2, 2.6, 0, [0.55, 0.5, 0.55], "#3f6b34")
# The garden: stepping stones in white pebbles from the gate to the front
# door and on to the guest room, a flagstone patio for eating outside, a
# tree, a hedge along the side wall and clipped box balls along the path.
h.put("garden-path", "Stepping stones", "stepping-path", "garden", 17.75, (FY + B) / 2, 0, [1.2, 0.06, m(B - FY)], "#8e8c87")
h.put("garden-path-guest", "Stepping stones", "stepping-path", "garden", 20.7, 45.4, 0, [m(1.9), 0.06, 0.9], "#8e8c87")
h.put("garden-patio", "Flagstone patio", "stepping-path", "garden", 6.75, 44.6, 0, [m(11), 0.06, m(5)], "#9a9893")
h.put("patio-table", "Round table", "round-table", "garden", 6.75, 44.6, 0, [1.1, 0.75, 1.1], "#5a3324")
for i, (x, y) in enumerate(((6.75, 42.6), (8.75, 44.6), (6.75, 46.6), (4.75, 44.6))):
    h.put(f"patio-chair-{i+1}", "Chair", "dining-chair", "garden", x, y, (180, 270, 0, 90)[i], [0.5, 0.9, 0.5], "#2f2f2f")
h.put("tree-1", "Garden tree", "tree", "garden", 9, 50.9, 0, [1.9, 4.2, 1.9], "#6a5038")
h.put("garden-hedge", "Hedge", "hedge", "garden", 1.65, 50.5, 0, [0.5, 1.3, m(7)], "#3f6b34")
for i, (y, s) in enumerate(((44, 0.6), (48, 0.7), (52.6, 0.55))):
    h.put(f"garden-ball-{i+1}", "Box ball", "shrub-ball", "garden", 14.4, y, 0, [s, s * 0.92, s], "#3f6b34")
h.put("garden-flowers", "Flower box", "flower-box", "garden", 21.15, 50.5, 270, [m(5), 0.55, 0.35], "#4a4844")

k = Home("Courtyard house, first floor", (10, 23.5), 0)
k.exterior = "#f4f1ea"    # white render above
k.roofRise = 1.5
k.room("bath1", "Bath", (25.75, T, R, 5.25), floor=BATH)
k.room("bedroom1", "Bedroom 1", (21.25, 5.75, R, 20.75), floor=OAK)
k.room("balcony", "Balcony", (15.25, T, 20.75, 14.25), kind="balcony", floor=DECK)
k.room("bath2", "Bath", (15.25, 14.75, 20.75, 20.75), floor=BATH)
k.room("hall", "Landing", (L, GY0, R, SY1), floor=OAK)
k.room("void", "Stairwell", (L, SY1 + RAIL, 5 - RAIL, GY1), kind="void", walls=[{"edge": 3, "color": "#b9a892"}])
# Bedroom 2 keeps a full wall towards the stairwell (a wall height of its own).
k.room("bedroom2", "Bedroom 2", (5.5, SY1 + INT, 19, GY1), floor=OAK, walls=[{"edge": 3, "height": 3.0}])
k.room("lounge", "Family lounge", (19.5, SY1 + INT, R, GY1), floor=OAK)
k.room("bedroom3", "Bedroom 3", (GX + INT, FY, R, B), floor=OAK)
k.paint("bedroom1", right="#5b6f7a")
k.paint("bedroom2", right="#8a9a83")
k.paint("bedroom3", right="#b08a6a")
k.paint("bath1", top="#dfe7e6", right="#dfe7e6")
k.paint("bath2", top="#dfe7e6")

k.door("stair-head", "hall", (0.8, SY1), (4.45, SY1))
k.door("door-bedroom1", "bedroom1", (22.5, 20.75), (25.5, 20.75))
k.door("door-bath1", "bedroom1", (27, 5.75), (29.5, 5.75))
k.door("door-balcony", "bedroom1", (21.25, 7), (21.25, 10.5))
k.door("door-bath2", "bath2", (16, 20.75), (18.5, 20.75))
k.door("door-bedroom2", "bedroom2", (7, SY1 + INT), (10, SY1 + INT))
k.door("door-lounge", "lounge", (20.5, SY1 + INT), (25, SY1 + INT))
k.door("door-bedroom3", "lounge", (23, GY1), (26, GY1))
k.window("win-hall-court-1", "hall", (1.5, GY0), (7, GY0))
k.window("win-hall-court-2", "hall", (8, GY0), (14, GY0))
k.window("win-bedroom1", "bedroom1", (21.75, 5.75), (24.75, 5.75))
k.window("win-bath1", "bath1", (29, T), (31, T), 0.6, 1.7)
k.window("win-bath2", "bath2", (15.25, 16), (15.25, 19), 0.6, 1.7)
k.window("win-bedroom2", "bedroom2", (7, GY1), (16, GY1))
k.window("win-lounge", "lounge", (R, 28), (R, 38), 2.1, 0.3)
k.window("win-bedroom3", "bedroom3", (26, B), (32, B))
k.window("win-bedroom3-garden", "bedroom3", (GX + INT, 44), (GX + INT, 50))

k.put("bed1", "Bed", "bed", "bedroom1", 30.8, 13, 270, [1.8, 0.95, 2.1], "#7d8a74")
k.put("bed1-table-1", "Bedside table", "side-table", "bedroom1", 33.5, 9.2, 0, [0.45, 0.5, 0.45], WOOD)
k.put("bed1-table-2", "Bedside table", "side-table", "bedroom1", 33.5, 16.8, 0, [0.45, 0.5, 0.45], WOOD)
k.put("table-lamp-bed1-1", "Table lamp", "table-lamp", "bedroom1", 33.5, 9.2, 0, [0.28, 0.5, 0.28], "#d9d2c3", elevation=0.5)
k.put("table-lamp-bed1-2", "Table lamp", "table-lamp", "bedroom1", 33.5, 16.8, 0, [0.28, 0.5, 0.28], "#d9d2c3", elevation=0.5)
k.put("bed1-wardrobe", "Wardrobe", "wardrobe", "bedroom1", 22.25, 16, 90, [1.5, 2.2, 0.6], "#e9e6df")
k.put("bed1-armchair", "Armchair", "armchair", "bedroom1", 26, 18.6, 0, [0.8, 0.8, 0.8], FABRIC)
k.put("bed1-rug", "Rug", "rug", "bedroom1", 28, 13, 90, [2.6, 0.02, 1.5], "#c9bfae")
k.put("bath1-shower", "Shower", "shower", "bath1", 32.6, 3, 0, [1.0, 2.0, 1.0], "#cfe0e2")
k.put("bath1-toilet", "Toilet", "toilet", "bath1", 28.5, 1.9, 180, [0.4, 0.78, 0.68], WHITE)
k.put("bath1-basin", "Basin", "basin", "bath1", 26.6, 3, 90, [0.6, 0.85, 0.48], WOOD)
k.put("bath2-shower", "Shower", "shower", "bath2", 19.1, 16.4, 0, [1.0, 2.0, 1.0], "#cfe0e2")
k.put("bath2-toilet", "Toilet", "toilet", "bath2", 16.2, 15.9, 180, [0.4, 0.78, 0.68], WHITE)
k.put("bath2-basin", "Basin", "basin", "bath2", 19.9, 19.5, 270, [0.6, 0.85, 0.48], WOOD)
k.put("balcony-flowers", "Flower box", "flower-box", "balcony", 15.25 + 0.62, 7.5, 90, [3.0, 0.6, 0.35], "#f2efe9")
k.put("balcony-chair-1", "Outdoor armchair", "armchair", "balcony", 18.8, 4.5, 180, [0.8, 0.75, 0.8], "#c9c2b4")
k.put("balcony-chair-2", "Outdoor armchair", "armchair", "balcony", 18.8, 10.5, 0, [0.8, 0.75, 0.8], "#c9c2b4")
k.put("balcony-table", "Side table", "side-table", "balcony", 18.8, 7.5, 0, [0.55, 0.45, 0.55], "#3a2a22")
k.put("hall-plant", "Rubber plant", "floor-plant", "hall", 33.2, 22.6, 0, [0.6, 1.5, 0.6], "#d8d2c6")
k.put("hall-bench", "Bench", "bench", "hall", 10, 22.3, 180, [1.4, 0.8, 0.5], "#8a6243")
k.put("bed2", "Bed", "bed", "bedroom2", 15.5, 33.75, 270, [1.8, 0.95, 2.1], "#5d7fa3")
k.put("bed2-table-1", "Bedside table", "side-table", "bedroom2", 18.2, 29.7, 0, [0.45, 0.5, 0.45], WOOD)
k.put("bed2-table-2", "Bedside table", "side-table", "bedroom2", 18.2, 37.8, 0, [0.45, 0.5, 0.45], WOOD)
k.put("table-lamp-bed2", "Table lamp", "table-lamp", "bedroom2", 18.2, 29.7, 0, [0.28, 0.5, 0.28], "#d9d2c3", elevation=0.5)
k.put("bed2-wardrobe", "Wardrobe", "wardrobe", "bedroom2", 6.5, 32, 90, [1.5, 2.2, 0.6], "#e9e6df")
k.put("bed2-desk", "Desk", "desk", "bedroom2", 10, 40.15, 0, [1.3, 0.75, 0.65], "#b9a68c")
k.put("bed2-chair", "Chair", "dining-chair", "bedroom2", 10, 38.3, 180, [0.5, 0.9, 0.5], "#2f2f2f")
k.put("lounge-tv", "TV unit", "tv-unit", "lounge", 20.2, 33.5, 90, [1.8, 0.55, 0.42], WOOD)
k.put("lounge-rug", "Rug", "rug", "lounge", 25.5, 33.5, 90, [2.6, 0.02, 2.0], "#b8a98c")
k.put("lounge-sofa", "Sofa", "sofa", "lounge", 30.5, 33.5, 270, [2.4, 0.8, 0.95], FABRIC)
k.put("lounge-coffee", "Coffee table", "coffee-table", "lounge", 25.5, 33.5, 90, [1.1, 0.42, 0.6], DARK)
k.put("lounge-plant-table", "Small plant", "table-plant", "lounge", 25.5, 33.5, 0, [0.22, 0.3, 0.22], "#e9e3d8", elevation=0.42)
k.put("lounge-armchair", "Armchair", "armchair", "lounge", 25.5, 29, 180, [0.85, 0.8, 0.85], GREEN)
k.put("lounge-plant", "Rubber plant", "floor-plant", "lounge", 33.2, 27.3, 0, [0.6, 1.6, 0.6], "#d8d2c6")
k.put("bed3", "Bed", "bed", "bedroom3", 30.95, 49.5, 270, [1.6, 0.95, 2.0], "#5b6b84")
k.put("bed3-table-1", "Bedside table", "side-table", "bedroom3", 33.5, 45.9, 0, [0.45, 0.5, 0.45], WOOD)
k.put("bed3-table-2", "Bedside table", "side-table", "bedroom3", 33.5, 53.1, 0, [0.45, 0.5, 0.45], WOOD)
k.put("bed3-wardrobe", "Wardrobe", "wardrobe", "bedroom3", 24.5, 53.3, 0, [1.2, 2.2, 0.55], "#e9e6df")
k.hang("art-bed2", "Painting", "painting-1", "bedroom2", "top", 15, 1.4, [1.0, 0.7, 0.04], "#2b2520")

here = os.path.dirname(os.path.abspath(__file__))
g.write(os.path.join(here, "..", "scenes", "villa-ground.json"))
f.write(os.path.join(here, "..", "scenes", "villa-first.json"))
h.write(os.path.join(here, "..", "scenes", "villa-b-ground.json"))
k.write(os.path.join(here, "..", "scenes", "villa-b-first.json"))
print("wrote", len(g.rooms), "+", len(f.rooms), "and", len(h.rooms), "+", len(k.rooms), "rooms")
