#!/usr/bin/env python3
"""Writes scenes/villa-ground.json and scenes/villa-first.json.

The plans for the new house are dimensioned in feet, so the layout is
written down here in feet (x to the right, y down the page, origin at the
plot's rear-left corner) and converted to metres for the scene files.
Run it again after changing a number:  python3 scripts/make-villa.py
"""
import copy, json, math, os

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

    def clad(self, room, side, finish):
        """The outside finish of one wall of a rectangular room: stone, render or fins."""
        r = next(r for r in self.rooms if r["id"] == room)
        edge = {"top": 0, "right": 1, "bottom": 2, "left": 3}[side]
        walls = r.setdefault("walls", [])
        entry = next((w for w in walls if w["edge"] == edge), None)
        if entry: entry["outside"] = finish
        else: walls.append({"edge": edge, "outside": finish})

    def edge(self, room, p, q, **wall):
        """Wall settings for the edge of `room` that runs from p to q (feet)."""
        r = next(r for r in self.rooms if r["id"] == room)
        poly = r["_ft"]
        i = next(i for i, a in enumerate(poly) if a == p and poly[(i + 1) % len(poly)] == q)
        r.setdefault("walls", []).append({"edge": i, **wall})

    def sweep(self, id, profile, y0, y1, thickness, **extra):
        """A curved roof: profile is [(x feet, height metres)], carried from y0 to y1 (feet)."""
        self.sweeps = getattr(self, "sweeps", [])
        self.sweeps.append({"id": id, "profile": [[m(x), h] for x, h in profile], "from": m(y0), "to": m(y1),
                            "thickness": thickness, **extra})

    def write(self, path):
        for r in self.rooms: r.pop("_ft")
        scene = {
            "schemaVersion": 1, "name": self.name, "units": "m", "northDeg": 0,
            "sun": {"azimuthDeg": 220, "elevationDeg": 40, "intensity": 3.2, "color": "#fff1dc"},
            "defaults": {"ceilingHeight": 3.0, "exteriorWallThickness": m(EXT), "railingHeight": 1.1,
                         "wallColor": "#f1ece3", "floorColor": "#d9cdb8", "ceilingColor": "#f7f4ee",
                         "exteriorColor": self.exterior, "exteriorMaterial": getattr(self, "finish", "render"),
                         **({"roofRise": self.roofRise} if getattr(self, "roofRise", None) else {}),
                         **getattr(self, "facade", {})},
            "start": {"position": [m(self.start[0]), m(self.start[1])], "yawDeg": self.yaw},
            **({"site": self.site} if getattr(self, "site", None) else {}),
            "rooms": self.rooms, "openings": self.openings,
            **({"sweeps": self.sweeps} if getattr(self, "sweeps", None) else {}),
            "lights": self.lights, "furniture": self.furniture,
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
# The outside follows a modern charcoal grey look: ash grey render below,
# charcoal above, natural grey stacked stone on the front walls, a screen of
# vertical black aluminium fins on bedroom 3, glass railings and warm light.
CHARCOAL, ASH, STONE_GREY = "#3e4043", "#8d8f91", "#a3a09a"
B_BOUNDARY = "#6d6e70"
h.exterior = ASH
h.finish = "render"
h.facade = {"trimColor": "#c4c6c8", "stoneColor": STONE_GREY}
h.room("pool-court", "Pool court", [(L, T), (25.25, T), (25.25, 5.25), (20.75, 5.25), (20.75, 14.25), (14.75, 14.25),
                                    (14.75, 20.75), (L, 20.75)], kind="balcony", floor=DECK,
       walls=[{"edge": 0, "height": 3.0, "color": B_BOUNDARY}, {"edge": 7, "height": 3.0, "color": B_BOUNDARY}])
h.room("bath", "Bath", (25.75, T, R, 5.25), floor=BATH)
h.room("master", "Master bedroom", (21.25, 5.75, R, 20.75), floor=OAK)
h.room("pool-shower", "Pool shower + WC", (15.25, 14.75, 20.75, 20.75), floor=BATH)
h.room("great", "Living + Dining + Kitchen", (L, GY0, R, GY1), floor=DARK_TILE, lamp=False)
for i, (x, y) in enumerate(((10.5, 35), (20, 28), (28, 26), (26, 37))):
    h.lights.append({"id": f"lamp-great-{i+1}", "position": [m(x), m(y)], "height": 2.85, "color": "#ffe3bd", "intensity": 7, "style": "spot"})
h.room("garden", "Garden", (L, FY, GX, B), kind="balcony", floor=GRASS,
       walls=[{"edge": 3, "height": 1.8, "color": B_BOUNDARY}, {"edge": 2, "height": 1.2, "color": B_BOUNDARY}])
h.room("guest", "Guest room", (GX + INT, FY, R, B), floor=OAK)
h.paint("master", right="#3f4f4a")
h.paint("guest", right="#9c7b62")
h.paint("bath", top="#dfe7e6", right="#dfe7e6")
h.paint("pool-shower", top="#dfe7e6")
h.paint("great", left="#b9a892")   # the stair wall
h.clad("guest", "bottom", "stone")
h.clad("guest", "right", "stone")

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
# The patio sits under the terrace, so it is shaded for eating outside.
h.put("garden-patio", "Flagstone patio", "stepping-path", "garden", 12.75, 44.75, 0, [m(5.5), 0.06, m(5.5)], "#9a9893")
h.put("patio-table", "Round table", "round-table", "garden", 12.75, 44.75, 0, [1.1, 0.75, 1.1], "#5a3324")
for i, (x, y) in enumerate(((12.75, 42.75), (14.75, 44.75), (12.75, 46.75), (10.75, 44.75))):
    h.put(f"patio-chair-{i+1}", "Chair", "dining-chair", "garden", x, y, (180, 270, 0, 90)[i], [0.5, 0.9, 0.5], "#2f2f2f")
h.put("tree-1", "Garden tree", "tree", "garden", 5.9, 50.9, 0, [1.9, 4.2, 1.9], "#6a5038")
h.put("garden-hedge", "Hedge", "hedge", "garden", 1.65, 50.5, 0, [0.5, 1.3, m(7)], "#3f6b34")
for i, (x, y, s) in enumerate(((14.4, 49.5, 0.7), (14.4, 53, 0.55), (5, 44, 0.6), (8, 43.5, 0.5))):
    h.put(f"garden-ball-{i+1}", "Box ball", "shrub-ball", "garden", x, y, 0, [s, s * 0.92, s], "#3f6b34")
h.put("garden-flowers", "Flower box", "flower-box", "garden", 21.15, 50.5, 270, [m(5), 0.55, 0.35], "#4a4844")

k = Home("Courtyard house, first floor", (10, 23.5), 0)
k.exterior = CHARCOAL
k.facade = {"trimColor": "#c4c6c8", "stoneColor": STONE_GREY}
k.roofRise = 1.5
k.room("bath1", "Bath", (25.75, T, R, 5.25), floor=BATH)
k.room("bedroom1", "Bedroom 1", (21.25, 5.75, R, 20.75), floor=OAK)
k.room("balcony", "Balcony", (15.25, T, 20.75, 14.25), kind="balcony", floor=DECK)
k.room("bath2", "Bath", (15.25, 14.75, 20.75, 20.75), floor=BATH)
k.room("hall", "Landing", (L, GY0, R, SY1), floor=OAK)
k.room("void", "Stairwell", (L, SY1 + RAIL, 5 - RAIL, GY1), kind="void", walls=[{"edge": 3, "color": "#b9a892"}])
# Bedroom 2 keeps a full wall towards the stairwell (a wall height of its own).
k.room("bedroom2", "Bedroom 2", (5.5, SY1 + INT, 17.5, GY1), floor=OAK, walls=[{"edge": 3, "height": 3.0}])
k.room("lounge", "Family lounge", (18, SY1 + INT, R, GY1), floor=OAK)
# A terrace over the front of the garden, off the family lounge, with a
# sitting area under a pergola. The left part of the garden stays open to the sky.
TX = 9.75
k.room("terrace", "Terrace", (TX, FY, GX, B), kind="balcony", floor=DECK)
k.room("bedroom3", "Bedroom 3", (GX + INT, FY, R, B), floor=OAK)
k.paint("bedroom1", right="#5b6f7a")
k.paint("bedroom2", right="#8a9a83")
k.paint("bedroom3", right="#b08a6a")
k.paint("bath1", top="#dfe7e6", right="#dfe7e6")
k.paint("bath2", top="#dfe7e6")
k.clad("bedroom3", "bottom", "fins")
k.clad("bedroom2", "bottom", "stone")

k.door("stair-head", "hall", (0.8, SY1), (4.45, SY1))
k.door("door-bedroom1", "bedroom1", (22.5, 20.75), (25.5, 20.75))
k.door("door-bath1", "bedroom1", (27, 5.75), (29.5, 5.75))
k.door("door-balcony", "bedroom1", (21.25, 7), (21.25, 10.5))
k.door("door-bath2", "bath2", (16, 20.75), (18.5, 20.75))
k.door("door-bedroom2", "bedroom2", (7, SY1 + INT), (10, SY1 + INT))
k.door("door-lounge", "lounge", (20.5, SY1 + INT), (25, SY1 + INT))
k.door("door-terrace", "lounge", (18.25, GY1), (21.5, GY1))
k.door("door-bedroom3-terrace", "bedroom3", (GX + INT, 46), (GX + INT, 49))
k.door("door-bedroom3", "lounge", (23, GY1), (26, GY1))
k.window("win-hall-court-1", "hall", (1.5, GY0), (7, GY0))
k.window("win-hall-court-2", "hall", (8, GY0), (14, GY0))
k.window("win-bedroom1", "bedroom1", (21.75, 5.75), (24.75, 5.75))
k.window("win-bath1", "bath1", (29, T), (31, T), 0.6, 1.7)
k.window("win-bath2", "bath2", (15.25, 16), (15.25, 19), 0.6, 1.7)
k.window("win-bedroom2", "bedroom2", (7, GY1), (15.5, GY1))
k.window("win-lounge", "lounge", (R, 28), (R, 38), 2.1, 0.3)
k.window("win-bedroom3", "bedroom3", (26, B), (32, B))

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
k.put("bed2", "Bed", "bed", "bedroom2", 14, 33.75, 270, [1.8, 0.95, 2.1], "#5d7fa3")
k.put("bed2-table-1", "Bedside table", "side-table", "bedroom2", 16.7, 29.7, 0, [0.45, 0.5, 0.45], WOOD)
k.put("bed2-table-2", "Bedside table", "side-table", "bedroom2", 16.7, 37.8, 0, [0.45, 0.5, 0.45], WOOD)
k.put("table-lamp-bed2", "Table lamp", "table-lamp", "bedroom2", 16.7, 29.7, 0, [0.28, 0.5, 0.28], "#d9d2c3", elevation=0.5)
k.put("bed2-wardrobe", "Wardrobe", "wardrobe", "bedroom2", 6.5, 32, 90, [1.5, 2.2, 0.6], "#e9e6df")
k.put("bed2-desk", "Desk", "desk", "bedroom2", 10, 40.15, 0, [1.3, 0.75, 0.65], "#b9a68c")
k.put("bed2-chair", "Chair", "dining-chair", "bedroom2", 10, 38.3, 180, [0.5, 0.9, 0.5], "#2f2f2f")
k.put("lounge-tv", "TV unit", "tv-unit", "lounge", 18.7, 33.5, 90, [1.8, 0.55, 0.42], WOOD)
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
k.put("terrace-pergola", "Pergola", "pergola", "terrace", 15.25, 49.5, 0, [3.2, 2.4, 2.6], "#8a6243")
k.put("terrace-rug", "Outdoor rug", "rug", "terrace", 15.25, 49.5, 0, [2.8, 0.02, 2.0], "#b9b4a8")
k.put("terrace-sofa", "Outdoor sofa", "sofa", "terrace", 15.25, 51.3, 0, [2.0, 0.75, 0.9], "#c9c2b4")
k.put("terrace-armchair-1", "Outdoor armchair", "armchair", "terrace", 12.4, 48.3, 90, [0.8, 0.75, 0.8], "#c9c2b4")
k.put("terrace-armchair-2", "Outdoor armchair", "armchair", "terrace", 18.1, 48.3, 270, [0.8, 0.75, 0.8], "#c9c2b4")
k.put("terrace-coffee", "Coffee table", "coffee-table", "terrace", 15.25, 48.2, 0, [1.1, 0.4, 0.6], "#3a2a22")
k.put("terrace-flowers-front", "Flower box", "flower-box", "terrace", 15.75, B - 0.62, 0, [3.0, 0.6, 0.35], "#f2efe9")
k.put("terrace-flowers-side", "Flower box", "flower-box", "terrace", TX + 0.62, 45, 90, [1.8, 0.6, 0.35], "#f2efe9")
k.put("terrace-planter", "Planter", "planter", "terrace", 20.9, 43.2, 0, [0.4, 1.1, 0.75], "#4a4844")
k.hang("art-bed2", "Painting", "painting-1", "bedroom2", "top", 13, 1.4, [1.0, 0.7, 0.04], "#2b2520")

# =============================================================================
# Design C: the curved-roof house, after a model Surya sent as a video.
#
# - The ground floor is design A's, inside and out of plan; only its
#   outside changes: grey concrete, teak cladding and a stone panel.
# - The first floor keeps A's rear row of bedrooms. In front, a teak-clad
#   bedroom on the left, a glass lounge with a balcony on the right, and
#   between them a sit-out under a concrete roof that curls down to a
#   planter at floor level, with a rooflight in the curl.
# - A second flight climbs to the roof, beside the first: up one, turn
#   round on the landing, up the other. A stair room on the roof (the
#   "mumty") has a curved roof that sweeps down to the terrace.
# =============================================================================
CONCRETE, C_TRIM, TEAK, C_STONE, C_BOUNDARY = "#8f8c86", "#a9a6a0", "#7a4f31", "#c2b49c", "#8c8881"
C_FACADE = {"trimColor": C_TRIM, "stoneColor": C_STONE, "woodColor": TEAK, "boundaryMaterial": "render"}

gc = copy.deepcopy(g)
gc.name = "Curved-roof house, ground floor"
gc.exterior, gc.finish, gc.facade = CONCRETE, "render", C_FACADE
for r in gc.rooms:
    for w in r.get("walls", []):
        if w.get("color") == BOUNDARY: w["color"] = C_BOUNDARY
gc.clad("guest", "bottom", "wood")
gc.clad("guest", "left", "wood")
gc.clad("living", "left", "wood")
gc.clad("living", "bottom", "stone")

# The second flight, from the first floor to the roof: beside the first one,
# rising the other way, towards the front. 16 risers of 19 cm, treads of 27 cm.
# src/homes.ts holds the same rectangle, for walking up it.
F2X0, F2X1, F2Y0, F2Y1 = 4.25, 7.55, 24.25, 38.25   # first step at F2Y0, top step at F2Y1
WALL2 = F2X1 + INT                                   # the double-height void starts past a full wall
CORR = 38.25                                         # the corridor to the front rooms, CORR..MID1
SIT0 = 13.25                                         # the sit-out under the curl, SIT0..LX - 0.5
LX = 21.25                                           # the glass lounge's left wall
LY0, LY1 = 34.75, 48.75                              # the glass lounge, rear to front
BAL = LY1 + INT                                      # the balcony in front of it

c1 = Home("Curved-roof house, first floor", (10, 21), 180)
c1.exterior, c1.finish, c1.facade = CONCRETE, "render", C_FACADE
c1.room("bedroom2", "Bedroom 2", (L, T, L + 13.5, ROW1), floor=OAK)
c1.room("bedroom1", "Bedroom 1", (L + 14, T, L + 27.5, ROW1), floor=OAK)
c1.room("bath1", "Bath", (L + 28, T, R, T + 10), floor=BATH)
c1.room("dressing", "Dressing", (L + 28, T + 10.5, R, ROW1))
# The landing wraps round the two flights and the void: a sitting area at the
# back, the strip the second flight stands on, and a corridor at the front.
c1.room("landing", "Landing", [(L, MID0), (SPLIT, MID0), (SPLIT, F2Y0), (F2X1, F2Y0), (F2X1, CORR), (SPLIT, CORR),
                               (SPLIT, MID1), (L, MID1), (L, CORR), (F2X0, CORR), (F2X0, F2Y0), (L, F2Y0)], floor=OAK)
# A full wall between the second flight and the double-height void.
c1.edge("landing", (F2X1, F2Y0), (F2X1, CORR), height=3.0)
c1.room("stairwell", "Stairwell", (L, F2Y0 + RAIL, F2X0 - RAIL, CORR - RAIL), kind="void")
c1.room("void", "Double-height void", (WALL2, F2Y0 + RAIL, SPLIT, CORR - RAIL), kind="void",
        walls=[{"edge": 3, "color": "#c9a58a"}])
c1.room("bedroom3", "Bedroom 3", (L, ROW3, SIT0 - INT, B), floor=OAK)
c1.room("sitout", "Sit-out + balcony", [(SIT0, ROW3), (LX - INT, ROW3), (LX - INT, BAL), (R, BAL), (R, B), (SIT0, B)],
        kind="balcony", floor=DECK)
c1.room("lounge", "Glass lounge", [(SPLIT + INT, LY0), (L + 27.5, LY0), (L + 27.5, LY0 + 6), (R, LY0 + 6), (R, LY1), (LX, LY1),
                                  (LX, MID1), (SPLIT + INT, MID1)], floor=TILE)
c1.room("bath3", "Bath", (L + 28, LY0, R, LY0 + 5.5), floor=BATH)
c1.clad("bedroom3", "bottom", "wood")
c1.clad("bedroom3", "left", "wood")
c1.clad("bedroom2", "left", "wood")
c1.edge("lounge", (R, LY0 + 6), (R, LY1), outside="stone")
c1.paint("bedroom2", top="#6d7f9a")
c1.paint("bedroom1", top="#8a9a83")
c1.paint("bedroom3", left="#a7835f")
c1.paint("bath1", top="#dfe7e6", right="#dfe7e6")
c1.paint("bath3", top="#dfe7e6", right="#dfe7e6")

c1.door("stair-head", "landing", (STAIR_X1 - 0.05, F2Y0), (L + 0.05, F2Y0))
c1.door("door-bedroom2", "bedroom2", (2.5, ROW1), (5.5, ROW1))
c1.door("door-bedroom1", "bedroom1", (15.25, ROW1), (18.25, ROW1))
c1.door("door-dressing", "dressing", (L + 28, 12.25), (L + 28, 15))
c1.door("door-bath1", "bath1", (30.5, T + 10), (33, T + 10))
c1.door("door-bedroom3", "bedroom3", (8.75, ROW3), (11.5, ROW3))
c1.door("door-lounge", "lounge", (SPLIT + INT, 38.6), (SPLIT + INT, 41.0))
c1.door("door-bath3", "bath3", (L + 28, LY0 + 2.5), (L + 28, LY0 + 5))
c1.door("door-sitout", "lounge", (LX, 42.5), (LX, 45.5))
c1.door("door-balcony", "lounge", (27.25, LY1), (30.25, LY1))
c1.window("win-bedroom2", "bedroom2", (4, T), (10.5, T))
c1.window("win-bedroom1", "bedroom1", (18, T), (24.5, T))
c1.window("win-bath1", "bath1", (30.5, T), (32.5, T), 0.6, 1.7)
c1.window("win-landing", "landing", (L, 18), (L, 22.5))
c1.window("win-bedroom3", "bedroom3", (3, B), (9.5, B))
c1.window("win-bedroom3-side", "bedroom3", (L, 46.5), (L, 49.5), 0.6, 1.3)
c1.window("win-bath3", "bath3", (L + 30, LY0), (L + 32, LY0), 0.6, 1.7)
# The lounge is glass from floor to ceiling at the front and on the side.
c1.window("win-lounge-1", "lounge", (LX + 0.4, LY1), (26.75, LY1), 2.7, 0.1)
c1.window("win-lounge-2", "lounge", (30.75, LY1), (R - 0.4, LY1), 2.7, 0.1)
c1.window("win-lounge-side", "lounge", (R, 41.5), (R, 47.5), 2.7, 0.1)
c1.window("win-lounge-rear", "lounge", (21.5, LY0), (L + 26.5, LY0), 1.4, 0.9)

# The curl: a concrete roof over the sit-out that comes down to a planter at
# the floor next to bedroom 3 and climbs to the roof terrace over the lounge
# wall, with a rooflight in its steep part. Profile in feet across, metres up.
c1.sweep("curl", [(SIT0 - 0.3, 0.0), (14.25, 0.12), (15.5, 0.7), (16.75, 1.7), (18.0, 2.6), (19.25, 3.15), (20.5, 3.4), (LX + 0.6, 3.48)],
         MID1, 55, 0.25, color="#a4a19b", glazing=[0.36, 0.66])
c1.put("stairs-roof", "Staircase to the roof", "stairs", "landing", (F2X0 + F2X1) / 2, (F2Y0 + F2Y1) / 2, 180,
       [m(F2X1 - F2X0), 3.05, m(F2Y1 - F2Y0)], "#c9c2b6", fixed=True)
c1.put("landing-armchair-1", "Armchair", "armchair", "landing", 11, 18.4, 180, [0.85, 0.8, 0.85], GREEN)
c1.put("landing-armchair-2", "Armchair", "armchair", "landing", 14, 18.4, 180, [0.85, 0.8, 0.85], FABRIC)
c1.put("landing-table", "Side table", "side-table", "landing", 12.5, 18.2, 0, [0.5, 0.45, 0.5], DARK)
c1.put("landing-plant", "Rubber plant", "floor-plant", "landing", 8, 17.2, 0, [0.5, 1.3, 0.5], "#d8d2c6")
c1.put("landing-shelf", "Sideboard", "sideboard", "landing", 12.5, 23.3, 180, [1.8, 0.8, 0.4], WOOD)
c1.put("bed2", "Bed", "bed", "bedroom2", 7.5, 4.6, 180, [1.8, 0.95, 2.1], "#5d7fa3")
c1.put("bed2-table-1", "Bedside table", "side-table", "bedroom2", 3.4, 2, 0, [0.45, 0.5, 0.45], WOOD)
c1.put("bed2-table-2", "Bedside table", "side-table", "bedroom2", 11.6, 2, 0, [0.45, 0.5, 0.45], WOOD)
c1.put("bed2-wardrobe", "Wardrobe", "wardrobe", "bedroom2", 1.8, 10.5, 90, [1.5, 2.2, 0.6], "#e9e6df")
c1.put("bed1", "Bed", "bed", "bedroom1", 21.5, 4.6, 180, [1.8, 0.95, 2.1], "#7d8a74")
c1.put("bed1-table-1", "Bedside table", "side-table", "bedroom1", 17.4, 2, 0, [0.45, 0.5, 0.45], WOOD)
c1.put("bed1-table-2", "Bedside table", "side-table", "bedroom1", 25.6, 2, 0, [0.45, 0.5, 0.45], WOOD)
c1.put("bed1-armchair", "Armchair", "armchair", "bedroom1", 25.7, 11.6, 270, [0.8, 0.8, 0.8], FABRIC)
c1.put("bath1-toilet", "Toilet", "toilet", "bath1", 30, 2.1, 180, [0.4, 0.78, 0.68], WHITE)
c1.put("bath1-shower", "Shower", "shower", "bath1", 32.7, 2.4, 0, [0.9, 2.0, 0.9], "#cfe0e2")
c1.put("bath1-basin", "Basin", "basin", "bath1", 33.3, 7.8, 270, [0.6, 0.85, 0.48], WOOD)
c1.put("dressing-wardrobe", "Wardrobe", "wardrobe", "dressing", 31.5, 14.6, 0, [1.4, 2.2, 0.55], "#e9e6df")
c1.put("bed3", "Bed", "bed", "bedroom3", 5.5, 50.2, 0, [1.6, 0.95, 2.0], "#5b6b84")
c1.put("bed3-table", "Bedside table", "side-table", "bedroom3", 2.1, 53.2, 0, [0.45, 0.5, 0.45], WOOD)
c1.put("bed3-wardrobe", "Wardrobe", "wardrobe", "bedroom3", 3.5, 42.8, 180, [1.5, 2.2, 0.6], "#e9e6df")
c1.put("bed3-desk", "Desk", "desk", "bedroom3", 11.6, 49, 270, [1.3, 0.75, 0.65], "#b9a68c")
c1.put("bath3-toilet", "Toilet", "toilet", "bath3", 30, 35.87, 180, [0.4, 0.78, 0.68], WHITE)
c1.put("bath3-shower", "Shower", "shower", "bath3", 32.65, 38.65, 0, [0.9, 2.0, 0.9], "#cfe0e2")
c1.put("bath3-basin", "Basin", "basin", "bath3", 32.8, 35.55, 180, [0.6, 0.85, 0.48], WOOD)
c1.put("lounge-sofa", "Sofa", "sofa", "lounge", 27.75, 42.4, 0, [2.4, 0.8, 0.95], FABRIC)
c1.put("lounge-rug", "Rug", "rug", "lounge", 27.75, 45, 0, [2.6, 0.02, 1.8], "#b8a98c")
c1.put("lounge-coffee", "Coffee table", "coffee-table", "lounge", 27.75, 45.3, 0, [1.1, 0.42, 0.6], DARK)
c1.put("lounge-armchair", "Armchair", "armchair", "lounge", 23.4, 46.1, 90, [0.85, 0.8, 0.85], WHITE)
c1.put("lounge-tv", "TV unit", "tv-unit", "lounge", 24.2, 35.5, 0, [1.8, 0.55, 0.42], WOOD)
c1.put("lounge-plant", "Rubber plant", "floor-plant", "lounge", 33.2, 47.6, 0, [0.6, 1.6, 0.6], "#d8d2c6")
c1.put("lounge-plant-table", "Small plant", "table-plant", "lounge", 27.75, 45.3, 0, [0.22, 0.3, 0.22], "#e9e3d8", elevation=0.42)
# The sit-out: a planter along the low end of the curl, two chairs where it is high.
c1.put("sitout-planter", "Planter", "planting-bed", "sitout", (SIT0 + 16.5) / 2, (ROW3 + B) / 2, 0, [m(16.5 - SIT0) - 0.06, 0.55, m(B - ROW3) - 0.12], "#8f8c86")
c1.put("sitout-chair-1", "Outdoor armchair", "armchair", "sitout", 19.25, 44, 270, [0.8, 0.75, 0.8], "#c9c2b4")
c1.put("sitout-chair-2", "Outdoor armchair", "armchair", "sitout", 19.25, 47.4, 270, [0.8, 0.75, 0.8], "#c9c2b4")
c1.put("sitout-table", "Side table", "side-table", "sitout", 19.4, 45.7, 0, [0.5, 0.45, 0.5], "#3a2a22")
c1.put("balcony-chair-1", "Outdoor armchair", "armchair", "sitout", 24, 51.9, 0, [0.8, 0.75, 0.8], "#c9c2b4")
c1.put("balcony-chair-2", "Outdoor armchair", "armchair", "sitout", 27, 51.9, 0, [0.8, 0.75, 0.8], "#c9c2b4")
c1.put("balcony-table", "Coffee table", "coffee-table", "sitout", 25.5, 50.6, 0, [0.9, 0.4, 0.5], "#3a2a22")
c1.put("balcony-pot-1", "Potted plant", "floor-plant", "sitout", 33.4, 50.4, 0, [0.5, 1.0, 0.5], "#f2efe9")
c1.put("balcony-pot-2", "Potted plant", "floor-plant", "sitout", 21.9, 50.4, 0, [0.45, 0.9, 0.45], "#f2efe9")
c1.hang("art-bed2", "Painting", "painting-1", "bedroom2", "left", 5, 1.3, [1.2, 0.8, 0.04], "#2b2520")
c1.hang("art-bed1", "Painting", "painting-3", "bedroom1", "right", 6, 1.3, [0.8, 0.8, 0.04], "#f2f0ea")
c1.hang("art-landing", "Painting", "painting-2", "landing", "top", 12.5, 1.3, [0.9, 0.7, 0.04], "#d8c7a6")

# ---- The roof: a stair room, its curved roof, and two terraces.
MUM0, MUM1 = F2Y0 - INT, 42.25        # the stair room, rear to front (its right wall stands on the one below)
HUMP = 16.5                            # the curved roof comes down to the terrace here
PARAPET = {"color": C_BOUNDARY, "height": 1.0}
c2 = Home("Curved-roof house, roof", (2.5, 44.5), 0)
c2.exterior, c2.finish, c2.facade = CONCRETE, "render", C_FACADE
c2.room("mumty", "Stair room", [(L, MUM0), (F2X0, MUM0), (F2X0, F2Y1), (F2X1, F2Y1), (F2X1, MUM1), (L, MUM1)], floor=OAK)
c2.room("stairwell", "Stairwell", (F2X0 + RAIL, MUM0, F2X1, F2Y1 - RAIL), kind="void")
c2.room("terrace", "Roof terrace", [(L, T), (R, T), (R, ROW1), (SPLIT, ROW1), (SPLIT, LY0), (R, LY0), (R, B), (LX, B),
                                    (LX, MID1), (HUMP, MID1), (HUMP, MUM0 - INT), (L, MUM0 - INT)],
        kind="balcony", floor={"material": "tile", "color": "#c8c2b8"})
for p, q in (((L, T), (R, T)), ((R, T), (R, ROW1)), ((R, ROW1), (SPLIT, ROW1)), ((SPLIT, ROW1), (SPLIT, LY0)),
             ((SPLIT, LY0), (R, LY0)), ((R, LY0), (R, B)), ((LX, MID1), (HUMP, MID1)), ((HUMP, MID1), (HUMP, MUM0 - INT)),
             ((HUMP, MUM0 - INT), (L, MUM0 - INT)), ((L, MUM0 - INT), (L, T))):
    c2.edge("terrace", p, q, **PARAPET)
c2.room("front-terrace", "Front terrace", (L, MUM1 + INT, SIT0 - INT, B), kind="balcony", floor={"material": "tile", "color": "#c8c2b8"})
c2.edge("front-terrace", (L, B), (L, MUM1 + INT), **PARAPET)
c2.edge("front-terrace", (L, MUM1 + INT), (SIT0 - INT, MUM1 + INT), color=C_BOUNDARY, height=0.5)
c2.door("stair-top", "mumty", (F2X1 - 0.05, F2Y1), (F2X0 + 0.05, F2Y1))
c2.door("door-front-terrace", "mumty", (4.6, MUM1), (7.2, MUM1))
c2.door("door-terrace", "mumty", (1.1, MUM0), (3.9, MUM0))
c2.window("win-mumty", "mumty", (L, 30), (L, 33), 0.9, 1.2)
# The stair room's roof curls down over the roof terrace to a planter.
c2.sweep("mumty-roof", [(F2X1, 3.28), (9.5, 3.22), (11.25, 2.85), (12.75, 2.0), (14.25, 1.05), (15.5, 0.62), (HUMP + 0.3, 0.55)],
         MUM0 - INT, MUM1 + 0.6, 0.22, solid=True, color="#a4a19b")
c2.put("front-planter", "Planter", "planter", "front-terrace", 6.75, MUM1 + 1.4, 0, [m(9.5), 0.6, 0.45], "#8f8c86")
c2.put("front-chair-1", "Outdoor armchair", "armchair", "front-terrace", 4, 50.5, 0, [0.8, 0.75, 0.8], "#c9c2b4")
c2.put("front-chair-2", "Outdoor armchair", "armchair", "front-terrace", 8.5, 50.5, 0, [0.8, 0.75, 0.8], "#c9c2b4")
c2.put("front-table", "Side table", "side-table", "front-terrace", 6.25, 50.5, 0, [0.5, 0.45, 0.5], "#3a2a22")
c2.put("terrace-planter-front", "Planter", "planter", "terrace", (LX + R) / 2, B - 0.75, 0, [m(R - LX) - 0.4, 0.6, 0.45], "#8f8c86")
c2.put("terrace-planter-curl", "Planter", "planter", "terrace", LX + 0.75, (MID1 + B) / 2 - 1, 90, [m(B - MID1) - 1.2, 0.6, 0.45], "#8f8c86")
c2.put("terrace-sofa", "Outdoor sofa", "sofa", "terrace", 27.75, 45.8, 0, [2.2, 0.75, 0.9], "#c9c2b4")
c2.put("terrace-coffee", "Coffee table", "coffee-table", "terrace", 27.75, 43.0, 0, [1.1, 0.4, 0.6], "#3a2a22")
for i, x in enumerate((8, 11)):
    c2.put(f"terrace-lounger-{i+1}", "Sun lounger", "lounger", "terrace", x, 9, 0, [0.7, 0.4, 1.9], WHITE)
c2.put("terrace-tank", "Water tank", "kitchen-tall", "terrace", 31.5, 4, 0, [1.2, 1.4, 1.2], "#3c3d3f")
for i, (x, y) in enumerate(((2.2, 22), (17.5, 2.3), (17.5, 30))):
    c2.put(f"terrace-pot-{i+1}", "Potted plant", "floor-plant", "terrace", x, y, 0, [0.5, 1.0, 0.5], "#f2efe9")

# =============================================================================
# Design D: the curved-roof house, copied as closely as the plot allows from
# the architect's model in Surya's video (front view first).
#
# Front of the first floor, left to right, as in the model: a teak-clad
# bedroom set back behind a concrete curl that rises from a planter at the
# front-left corner to the roof; a living room glazed from floor to ceiling
# behind a balcony with a thick slab and glass railing; a narrow teak box (a
# bath) and a stone corner. On the roof: a wide stair room with a door and a
# teak panel, a glass railing in front, its roof curving down to the right to
# a planter, and a long planter along the front. Dark window frames, timber
# handrails, darker concrete. The ground floor keeps design A's rooms (the
# guest room included); only the front gate is wider, as in the model.
# =============================================================================
D_CONCRETE, D_TRIM, D_SHELL, D_BOUNDARY = "#7f7b75", "#96928b", "#8e8a84", "#85817a"
D_FACADE = {"trimColor": D_TRIM, "stoneColor": "#bcae96", "woodColor": "#a3836a", "boundaryMaterial": "render",
            "frameColor": "#3a332d", "doorColor": "#5a3a24", "railColor": "#7a5236"}

d0 = copy.deepcopy(gc)
d0.name = "Curved-roof house D, ground floor"
d0.exterior, d0.facade = D_CONCRETE, D_FACADE
for r in d0.rooms:
    for w in r.get("walls", []):
        if w.get("color") == C_BOUNDARY: w["color"] = D_BOUNDARY
# A wide gate between lamp posts, as in the model (garden edge 2 runs right to left from x = 33.25).
gate = next(o for o in d0.openings if o["id"] == "gate")
gate["offset"], gate["width"] = m(33.25 - 25.25), m(10)
d0.clad("toilet", "bottom", "stone")
d0.clad("pool-shower", "bottom", "wood")

DFRONT = 50.25     # front wall of bedroom 3 (the teak box)
DGL = 49.25        # the glass front of the living room and the bath
DBX = 13.75        # right wall of bedroom 3
DLX = DBX + INT    # left wall of the living room
DB3 = 29.75        # the bath at the right end of the front
d1 = Home("Curved-roof house D, first floor", (10, 21), 180)
d1.exterior, d1.finish, d1.facade = D_CONCRETE, "render", D_FACADE
d1.room("bedroom2", "Bedroom 2", (L, T, L + 13.5, ROW1), floor=OAK)
d1.room("bedroom1", "Bedroom 1", (L + 14, T, L + 27.5, ROW1), floor=OAK)
d1.room("bath1", "Bath", (L + 28, T, R, T + 10), floor=BATH)
d1.room("dressing", "Dressing", (L + 28, T + 10.5, R, ROW1))
d1.room("landing", "Landing", [(L, MID0), (SPLIT, MID0), (SPLIT, F2Y0), (F2X1, F2Y0), (F2X1, CORR), (SPLIT, CORR),
                               (SPLIT, MID1), (L, MID1), (L, CORR), (F2X0, CORR), (F2X0, F2Y0), (L, F2Y0)], floor=OAK)
d1.edge("landing", (F2X1, F2Y0), (F2X1, CORR), height=3.0)
d1.room("stairwell", "Stairwell", (L, F2Y0 + RAIL, F2X0 - RAIL, CORR - RAIL), kind="void")
d1.room("void", "Double-height void", (WALL2, F2Y0 + RAIL, SPLIT, CORR - RAIL), kind="void",
        walls=[{"edge": 3, "color": "#c9a58a"}])
d1.room("bedroom3", "Bedroom 3", (L, ROW3, DBX, DFRONT), floor=OAK)
d1.room("living", "Living room", [(SPLIT + INT, LY0), (R, LY0), (R, MID1), (DB3 - INT, MID1), (DB3 - INT, DGL), (DLX, DGL),
                                  (DLX, ROW3), (SPLIT + INT, ROW3)], floor=TILE)
d1.room("bath3", "Bath", (DB3, ROW3, R, DGL), floor=BATH)
# A gap in front of bedroom 3: the balcony starts under the high part of the
# curl, and the curl's low end comes down on a small planter of its own.
DBAL = 10.75
d1.room("ledge", "Planter at the end of the curl", (L, DFRONT + INT, 4.75, B), kind="balcony", floor={"material": "tile", "color": "#b9b4ab"},
        walls=[{"edge": e, "color": D_BOUNDARY, "height": 0.6} for e in (1, 2, 3)])
d1.room("balcony", "Balcony", [(DBAL, DFRONT + INT), (DLX, DFRONT + INT), (DLX, DGL + INT), (R, DGL + INT), (R, B), (DBAL, B)],
        kind="balcony", floor={"material": "tile", "color": "#b9b4ab"})
d1.clad("bedroom3", "bottom", "wood")
d1.clad("bedroom3", "left", "wood")
d1.clad("bath3", "bottom", "wood")
d1.clad("bath3", "right", "stone")
d1.edge("living", (R, LY0), (R, MID1), outside="stone")
d1.edge("living", (DB3 - INT, DGL), (DLX, DGL), outside="render")
d1.paint("bedroom2", top="#6d7f9a")
d1.paint("bedroom1", top="#8a9a83")
d1.paint("bedroom3", left="#a7835f")
d1.paint("bath1", top="#dfe7e6", right="#dfe7e6")
d1.paint("bath3", right="#dfe7e6")

d1.door("stair-head", "landing", (STAIR_X1 - 0.05, F2Y0), (L + 0.05, F2Y0))
d1.door("door-bedroom2", "bedroom2", (2.5, ROW1), (5.5, ROW1))
d1.door("door-bedroom1", "bedroom1", (15.25, ROW1), (18.25, ROW1))
d1.door("door-dressing", "dressing", (L + 28, 12.25), (L + 28, 15))
d1.door("door-bath1", "bath1", (30.5, T + 10), (33, T + 10))
d1.door("door-bedroom3", "bedroom3", (9, ROW3), (11.75, ROW3))
d1.door("door-living", "living", (SPLIT + INT, 38.6), (SPLIT + INT, 41.0))
d1.door("door-bath3", "bath3", (DB3, 42.25), (DB3, 44.75))
d1.opening("door-balcony", "door", "living", (21.25, DGL), (24.25, DGL), height=2.6)
d1.window("win-bedroom2", "bedroom2", (4, T), (10.5, T))
d1.window("win-bedroom1", "bedroom1", (18, T), (24.5, T))
d1.window("win-bath1", "bath1", (30.5, T), (32.5, T), 0.6, 1.7)
d1.window("win-landing", "landing", (L, 18), (L, 22.5))
d1.window("win-bedroom3-side", "bedroom3", (L, 43.5), (L, 48), 1.2, 1.0)
d1.window("win-bedroom3", "bedroom3", (9.75, DFRONT), (12.75, DFRONT), 0.9, 1.1)
d1.window("win-bath3", "bath3", (31, DGL), (33, DGL), 0.6, 1.7)
# Glass from floor to ceiling across the front, in tall dark-framed panes.
d1.window("win-living-1", "living", (DLX + 0.4, DGL), (20.75, DGL), 2.7, 0.1)
d1.window("win-living-2", "living", (24.75, DGL), (DB3 - 0.9, DGL), 2.7, 0.1)
d1.window("win-living-side", "living", (R, 36), (R, 40.25), 1.6, 0.8)
d1.window("win-living-rear", "living", (21.5, LY0), (L + 26.5, LY0), 1.4, 0.9)

# The curl: from a planter at the front-left corner up across bedroom 3's
# front to the roof over the living room. Profile in feet across, metres up.
d1.sweep("curl", [(0.6, 0.62), (2.25, 0.7), (4.0, 1.05), (5.75, 1.7), (7.5, 2.45), (9.25, 3.0), (11.25, 3.4), (DLX, 3.6)],
         DFRONT + INT - 0.25, 55, 0.36, color=D_SHELL, glazing=[0.32, 0.6])
# The balcony's thick slab edge, standing below the floor.
d1.sweep("balcony-edge", [(DLX - 0.4, -0.32), (35.1, -0.32)], DGL + INT - 0.2, 55.1, 0.3, solid=True, color=D_TRIM)
d1.put("stairs-roof", "Staircase to the roof", "stairs", "landing", (F2X0 + F2X1) / 2, (F2Y0 + F2Y1) / 2, 180,
       [m(F2X1 - F2X0), 3.05, m(F2Y1 - F2Y0)], "#c9c2b6", fixed=True)
d1.put("landing-armchair-1", "Armchair", "armchair", "landing", 11, 18.4, 180, [0.85, 0.8, 0.85], GREEN)
d1.put("landing-armchair-2", "Armchair", "armchair", "landing", 14, 18.4, 180, [0.85, 0.8, 0.85], FABRIC)
d1.put("landing-table", "Side table", "side-table", "landing", 12.5, 18.2, 0, [0.5, 0.45, 0.5], DARK)
d1.put("landing-plant", "Rubber plant", "floor-plant", "landing", 8, 17.2, 0, [0.5, 1.3, 0.5], "#d8d2c6")
d1.put("landing-shelf", "Sideboard", "sideboard", "landing", 12.5, 23.3, 180, [1.8, 0.8, 0.4], WOOD)
d1.put("bed2", "Bed", "bed", "bedroom2", 7.5, 4.6, 180, [1.8, 0.95, 2.1], "#5d7fa3")
d1.put("bed2-table-1", "Bedside table", "side-table", "bedroom2", 3.4, 2, 0, [0.45, 0.5, 0.45], WOOD)
d1.put("bed2-table-2", "Bedside table", "side-table", "bedroom2", 11.6, 2, 0, [0.45, 0.5, 0.45], WOOD)
d1.put("bed2-wardrobe", "Wardrobe", "wardrobe", "bedroom2", 1.8, 10.5, 90, [1.5, 2.2, 0.6], "#e9e6df")
d1.put("bed1", "Bed", "bed", "bedroom1", 21.5, 4.6, 180, [1.8, 0.95, 2.1], "#7d8a74")
d1.put("bed1-table-1", "Bedside table", "side-table", "bedroom1", 17.4, 2, 0, [0.45, 0.5, 0.45], WOOD)
d1.put("bed1-table-2", "Bedside table", "side-table", "bedroom1", 25.6, 2, 0, [0.45, 0.5, 0.45], WOOD)
d1.put("bed1-armchair", "Armchair", "armchair", "bedroom1", 25.7, 11.6, 270, [0.8, 0.8, 0.8], FABRIC)
d1.put("bath1-toilet", "Toilet", "toilet", "bath1", 30, 2.1, 180, [0.4, 0.78, 0.68], WHITE)
d1.put("bath1-shower", "Shower", "shower", "bath1", 32.7, 2.4, 0, [0.9, 2.0, 0.9], "#cfe0e2")
d1.put("bath1-basin", "Basin", "basin", "bath1", 33.3, 7.8, 270, [0.6, 0.85, 0.48], WOOD)
d1.put("dressing-wardrobe", "Wardrobe", "wardrobe", "dressing", 31.5, 14.6, 0, [1.4, 2.2, 0.55], "#e9e6df")
d1.put("bed3", "Bed", "bed", "bedroom3", 4.6, 46.6, 90, [1.6, 0.95, 2.0], "#5b6b84")
d1.put("bed3-wardrobe", "Wardrobe", "wardrobe", "bedroom3", 4.5, 42.8, 180, [1.5, 2.2, 0.6], "#e9e6df")
d1.put("bed3-desk", "Desk", "desk", "bedroom3", 12.6, 46.6, 270, [1.3, 0.75, 0.65], "#b9a68c")
d1.put("bath3-basin", "Basin", "basin", "bath3", 33.45, 43.2, 270, [0.6, 0.85, 0.48], WOOD)
d1.put("bath3-toilet", "Toilet", "toilet", "bath3", 33.1, 45.0, 270, [0.4, 0.78, 0.68], WHITE)
d1.put("bath3-shower", "Shower", "shower", "bath3", 32.0, 47.75, 0, [0.9, 2.0, 0.9], "#cfe0e2")
# The living room: sofa facing the glass, dining at the back by the pool side.
d1.put("living-sofa", "Sofa", "sofa", "living", 21.75, 43.45, 0, [2.4, 0.8, 0.95], FABRIC)
d1.put("living-rug", "Rug", "rug", "living", 21.75, 46.4, 0, [2.6, 0.02, 1.6], "#b8a98c")
d1.put("living-coffee", "Coffee table", "coffee-table", "living", 21.75, 46.4, 0, [1.1, 0.42, 0.6], DARK)
d1.put("living-armchair", "Armchair", "armchair", "living", 16.4, 45.5, 90, [0.85, 0.8, 0.85], WHITE)
d1.put("living-plant", "Rubber plant", "floor-plant", "living", 28, 47.9, 0, [0.6, 1.6, 0.6], "#d8d2c6")
d1.put("living-table", "Dining table", "dining-table", "living", 27.5, 38, 0, [1.6, 0.75, 0.9], WOOD)
for i, x in enumerate((26, 29)):
    d1.put(f"living-chair-rear-{i+1}", "Dining chair", "dining-chair", "living", x, 36.2, 180, [0.5, 0.9, 0.5], "#7a4a35")
    d1.put(f"living-chair-front-{i+1}", "Dining chair", "dining-chair", "living", x, 39.8, 0, [0.5, 0.9, 0.5], "#7a4a35")
d1.put("living-sideboard", "Sideboard", "sideboard", "living", 33.5, 38, 270, [1.6, 0.8, 0.4], WOOD)
# The balcony: a planter under the low end of the curl, chairs and a table in front of the glass.
d1.put("curl-planter", "Planter", "planter", "ledge", (L + 4.75) / 2, (DFRONT + INT + B) / 2, 90, [m(B - DFRONT - INT) - 0.12, 0.62, m(4.75 - L) - 0.12], "#8f8c86")
d1.put("balcony-chair-1", "Outdoor armchair", "armchair", "balcony", 19, 52, 90, [0.75, 0.75, 0.75], "#e8e2d6")
d1.put("balcony-chair-2", "Outdoor armchair", "armchair", "balcony", 25, 52, 270, [0.75, 0.75, 0.75], "#e8e2d6")
d1.put("balcony-table", "Coffee table", "coffee-table", "balcony", 22, 52, 0, [0.9, 0.4, 0.5], "#6e4529")
d1.put("balcony-pot-1", "Potted plant", "floor-plant", "balcony", 33.4, 52, 0, [0.5, 0.9, 0.5], "#f2efe9")
d1.put("balcony-pot-2", "Potted plant", "floor-plant", "balcony", 15.2, 52.8, 0, [0.45, 0.8, 0.45], "#f2efe9")
d1.hang("art-bed2", "Painting", "painting-1", "bedroom2", "left", 5, 1.3, [1.2, 0.8, 0.04], "#2b2520")
d1.hang("art-bed1", "Painting", "painting-3", "bedroom1", "right", 6, 1.3, [0.8, 0.8, 0.04], "#f2f0ea")
d1.hang("art-landing", "Painting", "painting-2", "landing", "top", 12.5, 1.3, [0.9, 0.7, 0.04], "#d8c7a6")

# ---- The roof: a wide stair room in the middle-left, its roof curving down
# to the right, a front terrace with a glass railing and a planter along the front.
DMX = 13.25        # right wall of the stair room
DHUMP = 20.0       # the curved roof reaches the terrace here
DH0 = LY0          # the curved roof runs from here to the front of the stair room
d2 = Home("Curved-roof house D, roof", (3, 46), 0)
d2.exterior, d2.finish, d2.facade = D_CONCRETE, "render", D_FACADE
d2.room("mumty", "Stair room", [(L, MUM0), (F2X0, MUM0), (F2X0, F2Y1), (F2X1, F2Y1), (F2X1, MUM0), (DMX, MUM0), (DMX, MUM1), (L, MUM1)], floor=OAK)
d2.room("stairwell", "Stairwell", (F2X0 + RAIL, MUM0, F2X1 - RAIL, F2Y1 - RAIL), kind="void")
d2.room("terrace", "Rear terrace", [(L, T), (R, T), (R, ROW1), (SPLIT, ROW1), (SPLIT, MUM0 - INT), (L, MUM0 - INT)],
        kind="balcony", floor={"material": "tile", "color": "#bdb7ad"})
for p, q, height in (((L, T), (R, T), 1.0), ((R, T), (R, ROW1), 1.0), ((R, ROW1), (SPLIT, ROW1), 1.0),
                     ((SPLIT, ROW1), (SPLIT, MUM0 - INT), 1.0), ((SPLIT, MUM0 - INT), (L, MUM0 - INT), 0.5), ((L, MUM0 - INT), (L, T), 1.0)):
    d2.edge("terrace", p, q, color=D_BOUNDARY, height=height)
d2.room("front-terrace", "Front terrace", [(L, MUM1 + INT), (DHUMP, MUM1 + INT), (DHUMP, DH0), (R, DH0), (R, B), (DLX, B), (DLX, DFRONT), (L, DFRONT)],
        kind="balcony", floor={"material": "tile", "color": "#bdb7ad"})
for p, q, height in (((L, MUM1 + INT), (DHUMP, MUM1 + INT), 0.5), ((DHUMP, MUM1 + INT), (DHUMP, DH0), 0.5), ((DHUMP, DH0), (R, DH0), 1.0),
                     ((R, DH0), (R, B), 1.0), ((R, B), (DLX, B), 0.75), ((DLX, B), (DLX, DFRONT), 0.75)):
    d2.edge("front-terrace", p, q, color=D_BOUNDARY, height=height)
d2.edge("mumty", (DMX, MUM1), (L, MUM1), outside="render")
d2.edge("mumty", (DMX, MUM0), (DMX, MUM1), outside="render")
d2.edge("mumty", (L, MUM0), (F2X0, MUM0), outside="render")
d2.door("stair-top", "mumty", (F2X1 - 0.05, F2Y1), (F2X0 + 0.05, F2Y1))
d2.opening("door-front-terrace", "door", "mumty", (3.0, MUM1), (6.0, MUM1), height=2.3)
d2.door("door-terrace", "mumty", (1.1, MUM0), (3.9, MUM0))
d2.window("win-mumty", "mumty", (8.75, MUM1), (11.75, MUM1), 1.2, 0.9)
# It runs the full depth of the stair room, as wide as in the model.
d2.sweep("mumty-roof", [(DMX - 0.4, 3.3), (14.5, 3.22), (15.75, 2.85), (17.0, 2.05), (18.25, 1.2), (19.25, 0.8), (DHUMP + 0.3, 0.65)],
         MUM0 - INT, MUM1 + 0.75, 0.3, solid=True, color=D_SHELL)
# The thick edge of the roof slab over the balcony.
d2.sweep("roof-edge", [(DLX - 0.2, -0.3), (35.1, -0.3)], 53.6, 55.1, 0.3, solid=True, color=D_TRIM)
d2.put("front-planter", "Planter", "planter", "front-terrace", (DLX + R) / 2, B - 1.0, 0, [m(R - DLX) - 0.2, 0.7, 0.55], "#8a867f")
d2.put("hump-planter", "Planter", "planter", "front-terrace", (DMX + DHUMP) / 2 + 0.3, MUM1 + 1.6, 0, [m(DHUMP - DMX) - 0.3, 0.55, 0.6], "#8a867f")
d2.put("front-chair-1", "Outdoor armchair", "armchair", "front-terrace", 3.5, 48, 0, [0.75, 0.75, 0.75], "#e8e2d6")
d2.put("front-chair-2", "Outdoor armchair", "armchair", "front-terrace", 8, 48, 0, [0.75, 0.75, 0.75], "#e8e2d6")
d2.put("front-table", "Side table", "side-table", "front-terrace", 5.75, 48, 0, [0.5, 0.45, 0.5], "#3a2a22")
d2.put("front-pot", "Potted plant", "floor-plant", "front-terrace", 11.5, 49, 0, [0.45, 0.8, 0.45], "#f2efe9")
d2.put("terrace-sofa", "Outdoor sofa", "sofa", "front-terrace", 27.75, 41.5, 0, [2.2, 0.75, 0.9], "#c9c2b4")
d2.put("terrace-coffee", "Coffee table", "coffee-table", "front-terrace", 27.75, 44.4, 0, [1.1, 0.4, 0.6], "#3a2a22")
for i, x in enumerate((8, 11)):
    d2.put(f"terrace-lounger-{i+1}", "Sun lounger", "lounger", "terrace", x, 9, 0, [0.7, 0.4, 1.9], WHITE)
d2.put("terrace-tank", "Water tank", "kitchen-tall", "terrace", 31.5, 4, 0, [1.2, 1.4, 1.2], "#3c3d3f")

# =============================================================================
# Design E: the architect's model, modelled whole, ground floor included.
# The model is built on the same 35 x 55 ft plot. Read from its front view:
#
# - Ground floor: one block across the plot with a 7.5 ft front yard behind a
#   low wall and a 14 ft gate. Front, left to right: the guest room in teak
#   with three tall windows, the main door, a stone-clad study, and an open
#   side passage on the right that leads back to the pool. The pool is in a
#   court at the rear, open to the sky; the living room and the master
#   bedroom both open onto it. Kitchen at the rear-left.
# - First floor: a teak box (bedroom 3) at the front-left, set back. In front
#   of it the concrete curl rises from a planter at the front-left corner to
#   the roof slab, glazed underneath, with a planted garden behind the glass.
#   Then a gap, and the balcony with a thick slab edge in front of a lounge
#   glazed from floor to ceiling, ending in a teak panel and a stone corner.
#   Bedrooms 1 and 2 at the back, overlooking the pool.
# - The roof slab over the lounge carries on over the balcony and past the
#   right-hand wall. On the roof: a wide stair room with a teak panel, its
#   roof sweeping down to the right to a planter, and a terrace with a glass
#   railing in front.
# - Stairs: the first flight stands in the living room, against the master
#   bedroom wall, and climbs to the back. The second climbs to the back too,
#   from the lounge, in its own shaft beside it.
# =============================================================================
E1X0, E1X1, EY0, EY1 = 15.5, 18.5, 20.25, 34.25    # flight 1: first step at EY1, top at EY0
E2X0, E2X1, E2Y0 = 12.0, 15.0, 20.75               # flight 2: first step at EY1, top at E2Y0
EG = 46.0          # inside face of the ground floor's front wall
EYARD = EG + EXT   # the front yard starts here
ESIDE = 29.75      # the right-hand rooms stop here; the side passage is beyond
EB3 = 11.5         # right wall of bedroom 3
EB3F = 34.25       # front wall of bedroom 3
EGL = 42.75        # the lounge's glass front
EBAL = 48.25       # the balcony's front edge (it sticks out 1.5 ft over the yard)
ECURL = 11.0       # the garden under the curl, from the left wall to here
ELEDGE = 4.75      # the planter ledge at the curl's foot
EGAP = 6.75        # the balcony starts here, leaving a gap after the ledge
PAVING = {"material": "tile", "color": "#b9b4ab"}

e0 = Home("Design E, ground floor", (21, 51), 0)
e0.site = {"margin": 30, "color": "#8fb070"}
e0.exterior, e0.finish, e0.facade = D_CONCRETE, "render", D_FACADE
e0.room("kitchen", "Kitchen", (L, T, 12.75, ROW1), floor=TILE)
e0.room("living", "Living + dining", [(L, MID0), (SPLIT, MID0), (SPLIT, EG), (13.25, EG), (13.25, 33.25), (L, 33.25)], floor=TILE)
e0.room("master", "Master bedroom", (SPLIT + INT, MID0, ESIDE, 30.25), floor=OAK)
e0.room("master-bath", "Bath", (SPLIT + INT, 30.75, ESIDE, 36.75), floor=BATH)
e0.room("powder", "Toilet", (SPLIT + INT, 37.25, 24.25, 41.25), floor=BATH)
e0.room("study", "Study", [(24.75, 37.25), (ESIDE, 37.25), (ESIDE, EG), (SPLIT + INT, EG), (SPLIT + INT, 41.75), (24.75, 41.75)], floor=OAK)
e0.room("guest", "Guest room", (L, 33.75, 12.75, EG), floor=OAK)
# The pool court at the rear, the side passage and the front yard are one
# open space inside the boundary wall.
e0.room("garden", "Pool court + garden", [(13.25, T), (R, T), (R, B), (L, B), (L, EYARD), (ESIDE + INT, EYARD), (ESIDE + INT, ROW1), (13.25, ROW1)],
        kind="balcony", floor=DECK)
e0.edge("garden", (13.25, T), (R, T), color=D_BOUNDARY, height=2.4)
e0.edge("garden", (R, T), (R, B), color=D_BOUNDARY, height=2.4)
e0.edge("garden", (R, B), (L, B), color=D_BOUNDARY, height=1.2)
e0.edge("garden", (L, B), (L, EYARD), color=D_BOUNDARY, height=1.2)
e0.clad("guest", "bottom", "wood")
e0.clad("guest", "left", "wood")
e0.edge("living", (L, 33.25), (L, MID0), outside="wood")
e0.edge("living", (SPLIT, EG), (13.25, EG), outside="wood")
e0.edge("study", (ESIDE, EG), (SPLIT + INT, EG), outside="stone")
e0.paint("kitchen", top="#5f7464")
e0.paint("master", right="#44616b")
e0.paint("guest", left="#b98d7a")
e0.paint("master-bath", right="#dfe7e6")

e0.door("door-kitchen", "kitchen", (7, ROW1), (10, ROW1))
e0.door("door-pool", "living", (6, MID0), (9.5, MID0))
e0.door("door-master", "master", (SPLIT + INT, 26.5), (SPLIT + INT, 29.25))
e0.door("door-master-pool", "master", (21, MID0), (24, MID0))
e0.door("door-master-bath", "master-bath", (25.5, 30.75), (28, 30.75))
e0.door("door-powder", "powder", (SPLIT + INT, 38), (SPLIT + INT, 40.5))
e0.door("door-study", "study", (SPLIT + INT, 42.5), (SPLIT + INT, 45.25))
e0.door("door-guest", "guest", (12.75, 35), (12.75, 37.75))
e0.opening("door-main", "door", "living", (17.75, EG), (14.25, EG), height=2.4)
e0.door("gate", "garden", (28.25, B), (14.25, B))
e0.window("win-kitchen", "kitchen", (4, T), (9.5, T), 1.1, 1.1)
e0.window("win-kitchen-pool", "kitchen", (12.75, 5), (12.75, 10.5), 1.1, 1.1)
e0.window("win-living-pool", "living", (10.5, MID0), (16.5, MID0), 2.1, 0.3)
e0.window("win-living-side-1", "living", (L, 19), (L, 24))
e0.window("win-living-side-2", "living", (L, 27), (L, 31))
e0.window("win-master-side", "master", (ESIDE, 20), (ESIDE, 25.5))
e0.window("win-master-bath", "master-bath", (ESIDE, 32.5), (ESIDE, 34.5), 0.6, 1.7)
e0.window("win-study", "study", (27.25, EG), (23.25, EG), 1.4, 0.9)
e0.window("win-study-side", "study", (ESIDE, 39), (ESIDE, 43))
# Three tall windows in the teak front, as in the model.
for i, x in enumerate((3.25, 6.25, 9.25)):
    e0.window(f"win-guest-{i+1}", "guest", (x + 2.25, EG), (x, EG), 2.1, 0.4)
e0.window("win-guest-side", "guest", (L, 38), (L, 42))

e0.put("stairs", "Staircase", "stairs", "living", (E1X0 + E1X1) / 2, (EY0 + EY1) / 2, 0,
       [m(E1X1 - E1X0), 3.05, m(EY1 - EY0)], "#c9c2b6", fixed=True)
e0.put("counter-left", "Kitchen counter with sink", "kitchen-counter-sink", "kitchen", 1.75, 7.5, 90, [2.74, 0.9, 0.6], "#ecebe6")
e0.put("counter-rear", "Kitchen counter with hob", "kitchen-counter-hob", "kitchen", 6.5, 1.75, 180, [2.4, 0.9, 0.6], "#ecebe6")
e0.put("fridge", "Fridge cabinet", "kitchen-tall", "kitchen", 11.6, 1.8, 180, [0.6, 2.1, 0.6], "#ecebe6")
e0.put("island", "Kitchen island", "kitchen-island", "kitchen", 7, 8.5, 0, [1.6, 0.9, 0.8], WHITE)
e0.put("dining-table", "Dining table", "dining-table", "living", 7.5, 21.5, 0, [1.9, 0.75, 0.95], WOOD)
for i, x in enumerate((5.5, 7.5, 9.5)):
    e0.put(f"chair-rear-{i+1}", "Dining chair", "dining-chair", "living", x, 19.3, 180, [0.5, 0.9, 0.5], "#7a4a35")
    e0.put(f"chair-front-{i+1}", "Dining chair", "dining-chair", "living", x, 23.7, 0, [0.5, 0.9, 0.5], "#7a4a35")
e0.put("sofa", "Sofa", "sofa", "living", 3.0, 29.0, 90, [2.4, 0.8, 0.95], FABRIC)
e0.put("rug", "Rug", "rug", "living", 7.0, 29.0, 0, [2.2, 0.02, 2.2], "#b8a98c")
e0.put("coffee-table", "Coffee table", "coffee-table", "living", 6.75, 29.0, 90, [1.1, 0.42, 0.6], DARK)
e0.put("armchair", "Armchair", "armchair", "living", 10.5, 26.9, 270, [0.85, 0.8, 0.85], GREEN)
e0.put("tv-unit", "TV unit", "tv-unit", "living", 12.0, 32.55, 0, [1.8, 0.55, 0.42], WOOD)
e0.put("floor-lamp-living", "Floor lamp", "floor-lamp", "living", 1.8, 23.8, 0, [0.4, 1.6, 0.4], "#2b2b2b")
e0.put("plant-living", "Rubber plant", "floor-plant", "living", 14.4, 44.8, 0, [0.6, 1.5, 0.6], "#d8d2c6")
e0.put("console", "Sideboard", "sideboard", "living", 14.0, 39.5, 90, [1.6, 0.8, 0.4], WOOD)
e0.put("master-bed", "Master bed", "bed", "master", 24.5, 25.4, 0, [1.8, 0.95, 2.1], "#8f97a3")
e0.put("master-table-1", "Bedside table", "side-table", "master", 20.6, 28.9, 0, [0.45, 0.5, 0.45], WOOD)
e0.put("master-table-2", "Bedside table", "side-table", "master", 28.4, 28.9, 0, [0.45, 0.5, 0.45], WOOD)
e0.put("master-wardrobe", "Wardrobe", "wardrobe", "master", 20.3, 21.0, 90, [1.8, 2.2, 0.6], "#e9e6df")
e0.put("mb-shower", "Shower", "shower", "master-bath", 28.0, 35.0, 0, [1.0, 2.0, 1.0], "#cfe0e2")
e0.put("mb-toilet", "Toilet", "toilet", "master-bath", 20.6, 35.0, 90, [0.4, 0.78, 0.68], WHITE)
e0.put("mb-basin", "Basin", "basin", "master-bath", 22.5, 31.6, 180, [0.6, 0.85, 0.48], WOOD)
e0.put("powder-wc", "Toilet", "toilet", "powder", 20.5, 40.1, 0, [0.4, 0.78, 0.68], WHITE)
e0.put("powder-basin", "Basin", "basin", "powder", 23.4, 38.3, 270, [0.6, 0.85, 0.48], WOOD)
e0.put("study-desk", "Desk", "desk", "study", 27.2, 44.9, 0, [1.4, 0.75, 0.65], "#b9a68c")
e0.put("study-shelf", "Bookcase", "bookcase", "study", 29.1, 39.5, 270, [1.0, 2.0, 0.35], WOOD)
e0.put("guest-bed", "Guest bed", "bed", "guest", 4.2, 39.5, 90, [1.6, 0.9, 2.0], GREEN)
e0.put("guest-table", "Bedside table", "side-table", "guest", 1.8, 35.3, 0, [0.45, 0.5, 0.45], WOOD)
e0.put("guest-wardrobe", "Wardrobe", "wardrobe", "guest", 9.5, 34.8, 180, [1.2, 2.2, 0.55], "#e9e6df")
e0.put("pool", "Swimming pool", "pool", "garden", 23.75, 7.5, 0, [m(16), 0.06, m(9)], "#3fa9d6")
for i, x in enumerate((17.5, 29.5)):
    e0.put(f"lounger-{i+1}", "Sun lounger", "lounger", "garden", x, 13.6, 90, [0.7, 0.4, 1.9], WHITE)
e0.put("pool-planter", "Planter", "planter", "garden", 33.5, 8.0, 90, [m(10), 0.6, 0.4], "#4a4844")
# The front yard: planters along the wall left of the gate, a tree in the corner.
e0.put("yard-tree", "Tree", "tree", "garden", 3.2, 51.7, 0, [1.4, 3.0, 1.4], "#3f6b34")
e0.put("yard-planter", "Flower box", "flower-box", "garden", 10.0, 53.6, 0, [m(8), 0.55, 0.35], "#4a4844")
e0.put("yard-path", "Paving", "stepping-path", "garden", 21.25, (EYARD + B) / 2, 0, [m(14), 0.06, m(B - EYARD)], "#9a9893")
for i, (x, y) in enumerate(((30.0, 49.0), (32.5, 53.4))):
    e0.put(f"yard-pot-{i+1}", "Potted plant", "floor-plant", "garden", x, y, 0, [0.4, 0.7, 0.4], "#a87a4f")
e0.put("passage-pot", "Rubber plant", "floor-plant", "garden", 33.2, 30.0, 0, [0.6, 1.3, 0.6], "#3d3a36")
e0.hang("art-living", "Painting", "painting-2", "living", "top", 4.0, 1.3, [0.7, 1.0, 0.04], "#d8c7a6")

# ---- First floor.
e1 = Home("Design E, first floor", (10, 18), 90)
e1.exterior, e1.finish, e1.facade = D_CONCRETE, "render", D_FACADE
e1.room("bedroom2", "Bedroom 2", (L, T, 12.75, ROW1), floor=OAK)
e1.room("landing", "Landing", [(L, MID0), (22.25, MID0), (22.25, EY1), (SPLIT + INT, EY1), (SPLIT + INT, EY0), (L, EY0)], floor=OAK)
e1.room("stairwell", "Stairwell", (E1X0, EY0 + RAIL, SPLIT, EY1), kind="void")
e1.room("stair2", "Stairs to the roof", (E2X0, E2Y0, E2X1, EY1), floor=OAK)
e1.edge("stair2", (E2X1, E2Y0), (E2X1, EY1), height=3.0)
e1.room("bath3", "Bath", (L, E2Y0, 5.75, 26.25), floor=BATH)
e1.room("bedroom3", "Bedroom 3", [(6.25, E2Y0), (EB3, E2Y0), (EB3, EB3F), (L, EB3F), (L, 26.75), (6.25, 26.75)], floor=OAK)
e1.room("bedroom1", "Bedroom 1", (22.75, MID0, R, 27.25), floor=OAK)
e1.room("dressing", "Dressing", (22.75, 27.75, 28.25, 33.75))
e1.room("bath1", "Bath", (28.75, 27.75, R, 33.75), floor=BATH)
e1.room("lounge", "Lounge", [(EB3, EB3F + INT), (22.25, EB3F + INT), (22.25, 33.75 + INT), (R, 33.75 + INT), (R, EGL), (EB3, EGL)], floor=TILE)
e1.edge("lounge", (EB3, EB3F + INT), (22.25, EB3F + INT), height=3.0)
# Under the curl: a planted garden behind the glass, and the planter ledge
# at the curl's foot. Nobody walks here.
KERB = dict(color=D_BOUNDARY, height=0.6)
e1.room("curl-garden", "Garden under the curl", [(L, EB3F + INT), (ECURL, EB3F + INT), (ECURL, EGL), (ELEDGE, EGL), (ELEDGE, EBAL), (L, EBAL)],
        kind="balcony", floor=PAVING)
e1.edge("curl-garden", (ELEDGE, EGL), (ELEDGE, EBAL), **KERB)
e1.edge("curl-garden", (ELEDGE, EBAL), (L, EBAL), **KERB)
e1.edge("curl-garden", (L, EBAL), (L, EB3F + INT), **KERB)
e1.edge("curl-garden", (ECURL, EGL), (ELEDGE, EGL), color=D_BOUNDARY, height=0.25)
e1.room("balcony", "Balcony", (EGAP, EGL + INT, R, EBAL), kind="balcony", floor=PAVING)
e1.clad("bedroom3", "left", "wood")
e1.edge("bedroom3", (EB3, EB3F), (L, EB3F), outside="wood")
e1.clad("bath3", "left", "wood")
e1.edge("lounge", (R, EGL), (EB3, EGL), outside="wood")
e1.edge("lounge", (R, 33.75 + INT), (R, EGL), outside="stone")
e1.paint("bedroom2", top="#6d7f9a")
e1.paint("bedroom1", right="#8a9a83")
e1.paint("bath1", right="#dfe7e6")
e1.paint("bath3", left="#dfe7e6")

e1.door("stair-head", "landing", (E1X1 - 0.05, EY0), (E1X0 + 0.05, EY0))
e1.door("stair2-foot", "stair2", (E2X1 - 0.05, EY1), (E2X0 + 0.05, EY1))
e1.door("door-bedroom2", "bedroom2", (2.5, ROW1), (5.5, ROW1))
e1.door("door-bath3", "bath3", (1.5, E2Y0), (4.25, E2Y0))
e1.door("door-bedroom3", "bedroom3", (7.25, E2Y0), (10.25, E2Y0))
e1.door("door-bedroom1", "bedroom1", (22.75, 16.75), (22.75, 19.5))
e1.door("door-dressing", "dressing", (24, 27.75), (26.5, 27.75))
e1.door("door-bath1", "bath1", (30, 27.75), (32.5, 27.75))
e1.door("door-lounge", "landing", (22.0, EY1), (19.5, EY1))
e1.opening("door-balcony", "door", "lounge", (24.25, EGL), (21.25, EGL), height=2.6)
e1.window("win-bedroom2", "bedroom2", (4, T), (10, T))
e1.window("win-bedroom2-pool", "bedroom2", (12.75, 4), (12.75, 11), 1.6, 0.6)
e1.window("win-bedroom1-pool", "bedroom1", (24.5, MID0), (32.5, MID0), 1.6, 0.6)
e1.window("win-bedroom1-side", "bedroom1", (R, 20), (R, 24.5))
e1.window("win-bath1", "bath1", (R, 30), (R, 32), 0.6, 1.7)
e1.window("win-bath3", "bath3", (L, 22.5), (L, 24.5), 0.6, 1.7)
e1.window("win-bedroom3-side", "bedroom3", (L, 28), (L, 32), 1.2, 1.0)
e1.window("win-bedroom3", "bedroom3", (9.5, EB3F), (3.5, EB3F), 1.2, 0.9)
# Glass from floor to ceiling across the front and into the curl garden.
e1.window("win-lounge-1", "lounge", (20.75, EGL), (EB3 + 0.4, EGL), 2.7, 0.1)
e1.window("win-lounge-2", "lounge", (30.25, EGL), (24.75, EGL), 2.7, 0.1)
e1.window("win-lounge-garden", "lounge", (EB3, EGL - 0.4), (EB3, EB3F + INT + 0.4), 2.7, 0.1)
e1.window("win-lounge-side", "lounge", (R, 36.25), (R, 40.25), 1.4, 0.9)

# The curl: from the planter at the front-left corner, over the garden, up
# to the roof slab. Glass under it at the lounge's front line. Profile in
# feet across, metres up (to its top surface).
e1.sweep("curl", [(2.0, 0.62), (3.2, 0.7), (4.4, 0.95), (5.6, 1.4), (6.8, 2.0), (8.0, 2.55), (9.2, 2.88), (10.4, 3.02), (11.6, 3.05), (13.0, 3.05)],
         EB3F + INT - 0.1, EBAL + 0.4, 0.32, color=D_SHELL, glazing=[0.3, 0.58],
         curtain={"y": m(EGL), "from": m(ELEDGE), "to": m(ECURL)})
# The balcony's thick slab edge, standing below the floor.
e1.sweep("balcony-edge", [(EGAP - 0.2, -0.32), (35.2, -0.32)], EGL + INT, EBAL + 0.3, 0.3, solid=True, color=D_TRIM)
e1.put("stairs-roof", "Staircase to the roof", "stairs", "stair2", (E2X0 + E2X1) / 2, (E2Y0 + EY1) / 2, 0,
       [m(E2X1 - E2X0), 3.05, m(EY1 - E2Y0)], "#c9c2b6", fixed=True)
e1.put("bed2", "Bed", "bed", "bedroom2", 6.75, 4.6, 180, [1.8, 0.95, 2.1], "#5d7fa3")
e1.put("bed2-table-1", "Bedside table", "side-table", "bedroom2", 2.7, 2, 0, [0.45, 0.5, 0.45], WOOD)
e1.put("bed2-table-2", "Bedside table", "side-table", "bedroom2", 10.8, 2, 0, [0.45, 0.5, 0.45], WOOD)
e1.put("bed2-wardrobe", "Wardrobe", "wardrobe", "bedroom2", 9.5, 14.75, 0, [1.5, 2.2, 0.6], "#e9e6df")
e1.put("bed1", "Bed", "bed", "bedroom1", 28.75, 23.3, 0, [1.8, 0.95, 2.1], "#7d8a74")
e1.put("bed1-table-1", "Bedside table", "side-table", "bedroom1", 25.0, 26.4, 0, [0.45, 0.5, 0.45], WOOD)
e1.put("bed1-table-2", "Bedside table", "side-table", "bedroom1", 32.5, 26.4, 0, [0.45, 0.5, 0.45], WOOD)
e1.put("dressing-wardrobe", "Wardrobe", "wardrobe", "dressing", 25.5, 32.8, 0, [1.4, 2.2, 0.55], "#e9e6df")
e1.put("bath1-shower", "Shower", "shower", "bath1", 32.5, 32.1, 0, [0.9, 2.0, 0.9], "#cfe0e2")
e1.put("bath1-toilet", "Toilet", "toilet", "bath1", 29.7, 32.6, 0, [0.4, 0.78, 0.68], WHITE)
e1.put("bath1-basin", "Basin", "basin", "bath1", 33.45, 29.0, 270, [0.6, 0.85, 0.48], WOOD)
e1.put("bath3-shower", "Shower", "shower", "bath3", 2.3, 24.7, 0, [0.9, 2.0, 0.9], "#cfe0e2")
e1.put("bath3-toilet", "Toilet", "toilet", "bath3", 5.0, 25.1, 0, [0.4, 0.78, 0.68], WHITE)
e1.put("bath3-basin", "Basin", "basin", "bath3", 4.9, 22.6, 270, [0.6, 0.85, 0.48], WOOD)
e1.put("bed3", "Bed", "bed", "bedroom3", 5.0, 30.8, 90, [1.6, 0.95, 2.0], "#5b6b84")
e1.put("bed3-wardrobe", "Wardrobe", "wardrobe", "bedroom3", 10.45, 25.0, 270, [1.5, 2.2, 0.6], "#e9e6df")
e1.put("landing-armchair-1", "Armchair", "armchair", "landing", 8.5, 18.4, 0, [0.85, 0.8, 0.85], GREEN)
e1.put("landing-plant", "Rubber plant", "floor-plant", "landing", 21.4, 17.1, 0, [0.5, 1.3, 0.5], "#d8d2c6")
# The lounge: sofa facing the glass, dining at the right end.
e1.put("lounge-sofa", "Sofa", "sofa", "lounge", 16.5, 36.6, 0, [2.4, 0.8, 0.95], FABRIC)
e1.put("lounge-rug", "Rug", "rug", "lounge", 16.5, 39.3, 0, [2.6, 0.02, 1.6], "#b8a98c")
e1.put("lounge-coffee", "Coffee table", "coffee-table", "lounge", 16.5, 39.3, 0, [1.1, 0.42, 0.6], DARK)
e1.put("lounge-armchair", "Armchair", "armchair", "lounge", 13.0, 39.6, 90, [0.85, 0.8, 0.85], WHITE)
e1.put("lounge-table", "Dining table", "dining-table", "lounge", 29.0, 38.5, 0, [1.6, 0.75, 0.9], WOOD)
for i, x in enumerate((27.5, 30.5)):
    e1.put(f"lounge-chair-rear-{i+1}", "Dining chair", "dining-chair", "lounge", x, 36.7, 180, [0.5, 0.9, 0.5], "#7a4a35")
    e1.put(f"lounge-chair-front-{i+1}", "Dining chair", "dining-chair", "lounge", x, 40.3, 0, [0.5, 0.9, 0.5], "#7a4a35")
e1.put("lounge-plant", "Rubber plant", "floor-plant", "lounge", 33.2, 41.6, 0, [0.6, 1.6, 0.6], "#d8d2c6")
# The curl garden: a long planter at the ledge and plants behind the glass.
# A planter runs along the left side, from the teak box to the front, beside the curl's foot.
e1.put("ledge-planter", "Planter", "planter", "curl-garden", (L + 2.0) / 2, (EB3F + INT + EBAL) / 2, 90, [m(EBAL - EB3F - INT) - 0.1, 0.62, m(2.0 - L) - 0.04], "#8f8c86")
for i, (x, y) in enumerate(((6.5, 41.4), (9.5, 41.4), (8.0, 37.0))):
    e1.put(f"curl-plant-{i+1}", "Rubber plant", "floor-plant", "curl-garden", x, y, 0, [0.55, 1.1, 0.55], "#8f8c86")
e1.put("balcony-chair-1", "Outdoor armchair", "armchair", "balcony", 19.5, 45.75, 90, [0.75, 0.75, 0.75], "#e8e2d6")
e1.put("balcony-chair-2", "Outdoor armchair", "armchair", "balcony", 25.5, 45.75, 270, [0.75, 0.75, 0.75], "#e8e2d6")
e1.put("balcony-table", "Coffee table", "coffee-table", "balcony", 22.5, 45.75, 0, [0.9, 0.4, 0.5], "#6e4529")
e1.put("balcony-pot-1", "Potted plant", "floor-plant", "balcony", 33.4, 46.5, 0, [0.5, 0.9, 0.5], "#f2efe9")
e1.hang("art-bed2", "Painting", "painting-1", "bedroom2", "left", 7, 1.3, [1.2, 0.8, 0.04], "#2b2520")

# ---- The roof: the stair room, its curved roof, the terrace and the slab.
EMX0, EMX1, EMY0, EMY1 = 8.75, 21.75, MID0, 31.25   # the stair room
EHUMP = 29.0       # its curved roof comes down to the terrace here
e2 = Home("Design E, roof", (5, 32), 0)
e2.exterior, e2.finish, e2.facade = D_CONCRETE, "render", D_FACADE
e2.room("mumty", "Stair room", [(EMX0, EMY0), (EMX1, EMY0), (EMX1, EMY1), (E2X1, EMY1), (E2X1, E2Y0), (E2X0, E2Y0), (E2X0, EMY1), (EMX0, EMY1)], floor=OAK)
e2.room("stairwell", "Stairwell", (E2X0 + RAIL, E2Y0 + RAIL, E2X1 - RAIL, EMY1), kind="void")
e2.room("terrace", "Roof terrace", [(L, T), (13.25, T), (13.25, ROW1), (EMX0 - INT, ROW1), (EMX0 - INT, EMY1 + INT), (EMX1 + INT, EMY1 + INT),
                                    (EMX1 + INT, MID0), (R, MID0), (R, EB3F), (EMX1 + INT, EB3F), (L, EB3F), (L, 26.25)],
        kind="balcony", floor={"material": "tile", "color": "#bdb7ad"})
PARAPET = dict(color=D_BOUNDARY, height=1.0)
for p, q in (((L, T), (13.25, T)), ((13.25, T), (13.25, ROW1)), ((EMX1 + INT, MID0), (R, MID0)), ((R, MID0), (R, EB3F)), ((L, 26.25), (L, T))):
    e2.edge("terrace", p, q, **PARAPET)
e2.edge("terrace", (R, EB3F), (EMX1 + INT, EB3F), color=D_BOUNDARY, height=0.3)
e2.edge("mumty", (E2X0, EMY1), (EMX0, EMY1), outside="render")
e2.edge("mumty", (EMX1, EMY1), (E2X1, EMY1), outside="wood")
e2.door("stair-top", "mumty", (E2X1 - 0.05, E2Y0), (E2X0 + 0.05, E2Y0))
e2.opening("door-terrace", "door", "mumty", (11.5, EMY1), (9.25, EMY1), height=2.3)
e2.window("win-mumty", "mumty", (EMX0, 20), (EMX0, 23), 1.2, 0.9)
# Its roof: as wide as in the model, curving down to the right over the full
# depth of the room, to a planter at its foot.
e2.sweep("mumty-roof", [(EMX1 - 0.3, 3.3), (23.0, 3.24), (24.25, 2.95), (25.5, 2.3), (26.75, 1.45), (27.9, 0.8), (EHUMP, 0.55)],
         EMY0 - 0.5, EMY1 + 1.0, 0.3, solid=True, color=D_SHELL)
# The roof slab over the lounge carries on over the balcony and past the
# right-hand wall, with a rounded-looking thick edge.
e2.sweep("front-slab", [(ECURL + 0.6, -0.36), (35.6, -0.36)], EB3F + INT, EBAL + 0.4, 0.36, solid=True, color=D_TRIM)
e2.put("hump-planter", "Planter", "planter", "terrace", (EMX1 + INT + R) / 2 + 0.25, EB3F - 0.95, 0, [m(R - EMX1 - INT) - 0.3, 0.6, 0.5], "#8a867f")
e2.put("front-chair-1", "Outdoor armchair", "armchair", "terrace", 3.0, 33.0, 180, [0.75, 0.75, 0.75], "#e8e2d6")
e2.put("front-chair-2", "Outdoor armchair", "armchair", "terrace", 6.0, 33.0, 180, [0.75, 0.75, 0.75], "#e8e2d6")
e2.put("front-pot", "Potted plant", "floor-plant", "terrace", 1.6, 28.0, 0, [0.45, 0.8, 0.45], "#f2efe9")
for i, x in enumerate((3, 6)):
    e2.put(f"terrace-lounger-{i+1}", "Sun lounger", "lounger", "terrace", x, 8, 0, [0.7, 0.4, 1.9], WHITE)
e2.put("terrace-tank", "Water tank", "kitchen-tall", "terrace", 10.5, 3.0, 0, [1.2, 1.4, 1.2], "#3c3d3f")

here = os.path.dirname(os.path.abspath(__file__))
g.write(os.path.join(here, "..", "scenes", "villa-ground.json"))
f.write(os.path.join(here, "..", "scenes", "villa-first.json"))
h.write(os.path.join(here, "..", "scenes", "villa-b-ground.json"))
k.write(os.path.join(here, "..", "scenes", "villa-b-first.json"))
gc.write(os.path.join(here, "..", "scenes", "villa-c-ground.json"))
c1.write(os.path.join(here, "..", "scenes", "villa-c-first.json"))
c2.write(os.path.join(here, "..", "scenes", "villa-c-roof.json"))
d0.write(os.path.join(here, "..", "scenes", "villa-d-ground.json"))
d1.write(os.path.join(here, "..", "scenes", "villa-d-first.json"))
d2.write(os.path.join(here, "..", "scenes", "villa-d-roof.json"))
e0.write(os.path.join(here, "..", "scenes", "villa-e-ground.json"))
e1.write(os.path.join(here, "..", "scenes", "villa-e-first.json"))
e2.write(os.path.join(here, "..", "scenes", "villa-e-roof.json"))
print("wrote", len(g.rooms), "+", len(f.rooms), "and", len(h.rooms), "+", len(k.rooms), "rooms")
