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

    def room(self, id, name, poly, kind=None, floor=None, lamp=True):
        if len(poly) == 4 and not isinstance(poly[0], (list, tuple)):
            x0, y0, x1, y1 = poly
            poly = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        r = {"id": id, "name": name, "polygon": [[m(x), m(y)] for x, y in poly]}
        if kind: r["kind"] = kind
        if floor: r["floor"] = floor
        self.rooms.append(r)
        r["_ft"] = poly
        if lamp and kind != "balcony":
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

    def put(self, id, name, model, room, x, y, rot, size, color):
        """x, y in feet; size is [width, height, depth] in metres."""
        self.furniture.append({"id": id, "name": name, "model": model, "room": room,
                               "position": [m(x), m(y)], "rotationDeg": rot, "size": size, "color": color})

    def write(self, path):
        for r in self.rooms: r.pop("_ft")
        scene = {
            "schemaVersion": 1, "name": self.name, "units": "m", "northDeg": 0,
            "sun": {"azimuthDeg": 220, "elevationDeg": 40, "intensity": 3.2, "color": "#fff1dc"},
            "defaults": {"ceilingHeight": 3.0, "exteriorWallThickness": m(EXT), "railingHeight": 1.1,
                         "wallColor": "#f1ece3", "floorColor": "#d9cdb8", "ceilingColor": "#f7f4ee"},
            "start": {"position": [m(self.start[0]), m(self.start[1])], "yawDeg": self.yaw},
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


TILE = {"material": "tile", "color": "#e6e2da"}
BATH = {"material": "tile", "color": "#cfd8dc"}
DECK = {"material": "decking", "color": "#9a7352"}
GRASS = {"color": "#6f9a4e"}
WOOD, DARK, WHITE, FABRIC, GREEN = "#8a6243", "#3a2a22", "#f4f2ee", "#d9d3c6", "#7d8a74"

L, R, T, B = EXT, 35 - EXT, EXT, 55 - EXT          # inside faces of the outside walls
ROW1 = T + 15                                       # bottom of the rear row of rooms
MID0, MID1 = ROW1 + INT, ROW1 + INT + 25            # the middle band: dining + living, pool
ROW3 = MID1 + INT                                   # top of the front row
SPLIT = L + 18                                      # right side of the dining/living column

# ---------------------------------------------------------------- ground floor
g = Home("New house, ground floor", (15.5, 39), 0)
g.room("kitchen", "Kitchen", (L, T, L + 12, ROW1), floor=TILE)
g.room("master", "Master bedroom", (L + 12.5, T, L + 25.5, ROW1))
g.room("bath", "Bath", (L + 26, T, R, T + 9), floor=BATH)
g.room("wardrobe", "Wardrobe", (L + 26, T + 9.5, R, ROW1))
g.room("living", "Dining + Living", (L, MID0, SPLIT, MID1), floor=TILE)
g.room("pool-court", "Pool court", (SPLIT + INT, MID0, R, MID0 + 18.5), kind="balcony", floor=DECK)
g.room("toilet", "Toilet", (SPLIT + INT, MID0 + 19, SPLIT + 9, MID1), floor=BATH)
g.room("pool-shower", "Pool shower", (SPLIT + 9.5, MID0 + 19, R, MID1), floor=BATH)
g.room("guest", "Guest room", (L, ROW3, L + 12, B))
g.room("garden", "Garden", (L + 12.5, ROW3, L + 32.5, B), kind="balcony", floor=GRASS)

g.door("door-kitchen", "kitchen", (7, ROW1), (10, ROW1))
g.door("door-master", "master", (14, ROW1), (17, ROW1))
g.door("door-wardrobe", "wardrobe", (L + 26, 11.5), (L + 26, 14.25))
g.door("door-bath", "bath", (29.5, T + 9), (32, T + 9))
g.door("door-deck", "living", (SPLIT, MID0 + 0.5), (SPLIT, MID0 + 3.5))
g.door("door-toilet", "living", (SPLIT, 36.5), (SPLIT, 39))
g.door("door-pool-shower", "pool-shower", (31, MID0 + 19), (33.5, MID0 + 19))
g.door("door-guest", "living", (8.5, MID1), (11.25, MID1))
g.door("door-main", "living", (14, MID1), (17.25, MID1))
g.door("door-guest-garden", "guest", (L + 12, 43), (L + 12, 45.75))
g.window("win-kitchen", "kitchen", (4, T), (9.5, T), 1.1, 1.1)
g.window("win-kitchen-side", "kitchen", (L, 6), (L, 10), 1.1, 1.1)
g.window("win-master", "master", (16, T), (23.5, T))
g.window("win-bath", "bath", (29.5, T), (31.5, T), 0.6, 1.7)
g.window("win-dining", "living", (L, 18.5), (L, 24.5))
g.window("win-living", "living", (L, 27), (L, 32))
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
g.put("rug", "Rug", "rug", "living", 10, 31.5, 0, [2.6, 0.02, 3.2], "#b8a98c")
g.put("sofa", "Sofa", "sofa", "living", 7.6, 31.5, 90, [2.4, 0.8, 0.95], FABRIC)
g.put("armchair", "Armchair", "armchair", "living", 10.5, 26.7, 180, [0.85, 0.8, 0.85], GREEN)
g.put("coffee-table", "Coffee table", "coffee-table", "living", 11.6, 31.5, 90, [1.1, 0.42, 0.6], DARK)
g.put("tv-unit", "TV unit", "tv-unit", "living", 17.9, 31.2, 270, [1.8, 0.55, 0.42], WOOD)
g.put("stairs", "Staircase", "stairs", "living", 2.5, 36.9, 0, [1.0, 3.0, 2.55], "#c9c2b6")
g.put("toilet-wc", "Toilet", "toilet", "toilet", 22.5, 36.4, 180, [0.4, 0.78, 0.68], WHITE)
g.put("toilet-basin", "Basin", "basin", "toilet", 25.6, 36.1, 180, [0.6, 0.85, 0.48], WOOD)
g.put("pool-shower-tray", "Shower", "shower", "pool-shower", 31.25, 39.2, 0, [1.1, 2.0, 1.1], "#cfe0e2")
g.put("pool", "Swimming pool", "pool", "pool-court", 25.25, MID0 + 2 + 8.25, 0, [m(12), 0.06, m(16.5)], "#3fa9d6")
g.put("lounger-1", "Sun lounger", "lounger", "pool-court", 32.8, 22.2, 0, [0.7, 0.4, 1.9], WHITE)
g.put("lounger-2", "Sun lounger", "lounger", "pool-court", 32.8, 29.6, 0, [0.7, 0.4, 1.9], WHITE)
g.put("guest-bed", "Guest bed", "bed", "guest", 4.6, 47.6, 90, [1.6, 0.9, 2.0], GREEN)
g.put("guest-table", "Bedside table", "side-table", "guest", 1.8, 43.3, 0, [0.45, 0.5, 0.45], WOOD)
g.put("guest-wardrobe", "Wardrobe", "wardrobe", "guest", 11.7, 50, 270, [1.2, 2.2, 0.55], "#e9e6df")
for i, (x, y) in enumerate(((19, 47.8), (24, 51), (29.5, 47.4))):
    g.put(f"tree-{i+1}", "Garden tree", "floor-plant", "garden", x, y, 0, [1.3, 2.6, 1.3], "#8a6243")

# ----------------------------------------------------------------- first floor
f = Home("New house, first floor", (10, 21), 180)
f.room("bedroom2", "Bedroom 2", (L, T, L + 13.5, ROW1))
f.room("bedroom1", "Bedroom 1", (L + 14, T, L + 27.5, ROW1))
f.room("bath1", "Bath", (L + 28, T, R, T + 10), floor=BATH)
f.room("dressing", "Dressing", (L + 28, T + 10.5, R, ROW1))
# The lounge wraps round the double-height void: the stairs come up its
# left arm, and its right arm is the passage to bedroom 3 and the balcony.
f.room("lounge", "Sitting lounge", [(L, MID0), (SPLIT, MID0), (SPLIT, MID1), (SPLIT - 3.5, MID1), (SPLIT - 3.5, MID0 + 10),
                                     (L + 4, MID0 + 10), (L + 4, MID1), (L, MID1)], floor=TILE)
f.room("void", "Double-height void", (L + 4.5, MID0 + 10.5, SPLIT - 4, MID1), kind="balcony", floor={"color": "#5a4634"})
f.room("bath3", "Bath", (L, ROW3, L + 5.5, B), floor=BATH)
f.room("bedroom3", "Bedroom 3", (L + 6, ROW3, SPLIT, B))
f.room("balcony", "Balcony", (SPLIT + INT, B - 18, R, B), kind="balcony", floor=TILE)

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
f.window("win-lounge", "lounge", (L, 18.5), (L, 24.5))
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
f.put("lounge-tv", "TV unit", "tv-unit", "lounge", 1.6, 21, 90, [1.8, 0.55, 0.42], WOOD)
f.put("lounge-rug", "Rug", "rug", "lounge", 8.5, 21.2, 0, [3.0, 0.02, 2.2], "#b8a98c")
f.put("lounge-sofa", "Sofa", "sofa", "lounge", 9, 21.2, 270, [2.0, 0.8, 0.9], FABRIC)
f.put("lounge-table", "Side table", "side-table", "lounge", 5.6, 21.2, 0, [0.7, 0.42, 0.7], DARK)
f.put("lounge-armchair", "Armchair", "armchair", "lounge", 14.8, 18.6, 180, [0.85, 0.8, 0.85], WHITE)
f.put("stairs-down", "Staircase down", "stairs-down", "lounge", 2.75, 34, 0, [1.0, 1.0, 4.0], "#c9c2b6")
f.put("bed3", "Bed", "bed", "bedroom3", 12.75, 50.6, 0, [1.6, 0.95, 2.0], "#5b6b84")
f.put("bed3-unit", "TV unit", "tv-unit", "bedroom3", 7.6, 46.5, 90, [1.6, 0.55, 0.42], WOOD)
f.put("bath3-toilet", "Toilet", "toilet", "bath3", 2.1, 42.9, 180, [0.4, 0.78, 0.68], WHITE)
f.put("bath3-basin", "Basin", "basin", "bath3", 1.65, 46.6, 90, [0.6, 0.85, 0.48], WOOD)
f.put("bath3-shower", "Shower", "shower", "bath3", 3.5, 51.6, 0, [1.2, 2.0, 1.2], "#cfe0e2")
f.put("balcony-table", "Round table", "round-table", "balcony", 25.5, 46.5, 0, [1.1, 0.75, 1.1], "#5a3324")
for i, (x, y) in enumerate(((25.5, 44), (28, 46.5), (25.5, 49), (23, 46.5))):
    f.put(f"balcony-chair-{i+1}", "Chair", "dining-chair", "balcony", x, y, (180, 270, 0, 90)[i], [0.5, 0.9, 0.5], "#7a4a35")
f.put("balcony-lounger", "Sun lounger", "lounger", "balcony", 32.7, 45, 0, [0.7, 0.4, 1.9], WHITE)

here = os.path.dirname(os.path.abspath(__file__))
g.write(os.path.join(here, "..", "scenes", "villa-ground.json"))
f.write(os.path.join(here, "..", "scenes", "villa-first.json"))
print("wrote", len(g.rooms), "+", len(f.rooms), "rooms")
