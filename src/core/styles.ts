/**
 * Ready-made interior styles. Applying one repaints a whole storey in one
 * go: walls, ceilings, floors and their materials, and the colours of the
 * soft furnishings, wooden furniture and kitchen units. The layout is not
 * touched, and outdoor spaces (balconies, terraces, gardens) are left as
 * they are. It is one undo step, like any other edit.
 */
import type { Furniture, Room, Scene } from './scene';

export interface Style {
  key: string;
  name: string;
  about: string;
  /** Walls and ceilings of ordinary rooms. */
  wall: string;
  ceiling: string;
  /** Floors of living rooms, bedrooms and halls. */
  floor: { material?: string; color: string };
  /** Floors of bathrooms, toilets and kitchens. */
  wetFloor: { material?: string; color: string };
  /** Walls of bathrooms and toilets, which get a material too. */
  bathWall: { material?: string; color: string };
  /** Sofas, armchairs, beds and curtains. */
  fabric: string;
  /** Tables, chairs, cupboards and other wooden pieces. */
  wood: string;
  /** Kitchen units. */
  kitchen: string;
  rug: string;
}

export const STYLES: readonly Style[] = [
  {
    key: 'modern', name: 'Modern', about: 'White walls, light oak, soft greys',
    wall: '#f4f2ee', ceiling: '#ffffff',
    floor: { material: 'laminate', color: '#c9a77c' },
    wetFloor: { material: 'large-tile', color: '#d9d6d0' },
    bathWall: { material: 'tile', color: '#ecebe8' },
    fabric: '#8a8f98', wood: '#b8946b', kitchen: '#f2f2f0', rug: '#cfc8bd',
  },
  {
    key: 'scandinavian', name: 'Scandinavian', about: 'Pale wood, warm whites, linen',
    wall: '#f7f5f0', ceiling: '#ffffff',
    floor: { material: 'laminate', color: '#e0c9a6' },
    wetFloor: { material: 'tile', color: '#e9e6df' },
    bathWall: { material: 'tile', color: '#f3f1ec' },
    fabric: '#e6dccb', wood: '#d8c3a0', kitchen: '#ffffff', rug: '#efe9de',
  },
  {
    key: 'japandi', name: 'Japandi', about: 'Calm beige, dark oak, natural stone',
    wall: '#ece4d6', ceiling: '#f5f0e6',
    floor: { material: 'laminate', color: '#b08a62' },
    wetFloor: { material: 'stone', color: '#cbbfae' },
    bathWall: { material: 'stone', color: '#d8cdbd' },
    fabric: '#c9b79c', wood: '#6e5440', kitchen: '#d8cbb5', rug: '#d6c8b0',
  },
  {
    key: 'industrial', name: 'Industrial', about: 'Concrete, black steel, leather',
    wall: '#a9a6a0', ceiling: '#d6d3cd',
    floor: { material: 'concrete', color: '#8a8780' },
    wetFloor: { material: 'large-tile', color: '#4a4a4a' },
    bathWall: { material: 'tile', color: '#3b3d3f' },
    fabric: '#6b4a35', wood: '#4a3a30', kitchen: '#2b2b2d', rug: '#5a5550',
  },
  {
    key: 'coastal', name: 'Coastal', about: 'Sea blues, sand, whitewashed wood',
    wall: '#f5f7f6', ceiling: '#ffffff',
    floor: { material: 'laminate', color: '#d9c7a8' },
    wetFloor: { material: 'tile', color: '#dbe7ea' },
    bathWall: { material: 'tile', color: '#cfe0e6' },
    fabric: '#9fb4c7', wood: '#e6dccb', kitchen: '#eef3f4', rug: '#e8dfcc',
  },
  {
    key: 'mediterranean', name: 'Mediterranean', about: 'Lime white, terracotta, deep blue',
    wall: '#faf6ee', ceiling: '#fffdf8',
    floor: { material: 'tile', color: '#c27a5a' },
    wetFloor: { material: 'tile', color: '#e9e1d2' },
    bathWall: { material: 'tile', color: '#e6eef5' },
    fabric: '#f2e3b3', wood: '#8f6b4a', kitchen: '#4f6d8a', rug: '#d9c4a0',
  },
  {
    key: 'dark-luxe', name: 'Dark luxe', about: 'Charcoal, walnut, green velvet',
    wall: '#3b3f3d', ceiling: '#f2efe8',
    floor: { material: 'laminate', color: '#6a4a33' },
    wetFloor: { material: 'large-tile', color: '#2a2a2c' },
    bathWall: { material: 'stone', color: '#4a4c4e' },
    fabric: '#2f4a3f', wood: '#3a2a20', kitchen: '#1f2326', rug: '#6b5a48',
  },
];

const FABRIC = new Set(['sofa', 'sofa-l', 'armchair', 'bed', 'curtain', 'lounger']);
const WOOD = new Set([
  'dining-table', 'dining-chair', 'coffee-table', 'side-table', 'round-table', 'tv-unit', 'sideboard', 'desk',
  'chest', 'bureau', 'wardrobe', 'bench', 'wicker-drawers', 'plant-shelf', 'bar-trolley', 'wall-shelf',
]);

const WET_ROOM = /bath|toilet|shower|\bwc\b|badkamer|^wc|powder/i;
const KITCHEN = /kitchen|keuken/i;

/** A room inside the home: not a balcony, terrace, garden or hole in the floor. */
export function isIndoor(room: Room): boolean {
  if (room.kind === 'balcony' || room.kind === 'void') return false;
  return !['lawn', 'decking', 'setts'].includes(room.floor?.material ?? '');
}

const isWet = (room: Room): boolean => WET_ROOM.test(room.id) || WET_ROOM.test(room.name);
const isKitchen = (room: Room): boolean => KITCHEN.test(room.id) || KITCHEN.test(room.name);

/** The colour a style gives a piece of furniture, or undefined to leave it be. */
function furnitureColor(style: Style, f: Furniture): string | undefined {
  if (FABRIC.has(f.model)) return style.fabric;
  if (WOOD.has(f.model)) return style.wood;
  if (f.model.startsWith('kitchen-')) return style.kitchen;
  if (f.model === 'rug') return style.rug;
  return undefined;
}

/** Restyles every indoor room of a storey. Returns the same scene if nothing changes. */
export function applyStyle(scene: Scene, style: Style): Scene {
  const indoor = new Set(scene.rooms.filter(isIndoor).map((r) => r.id));
  if (indoor.size === 0) return scene;
  const rooms = scene.rooms.map((room): Room => {
    if (!indoor.has(room.id)) return room;
    const wet = isWet(room);
    const floor = wet || isKitchen(room) ? style.wetFloor : style.floor;
    const wall = wet ? style.bathWall : { color: style.wall };
    // Keep what a wall override says about height and the outside finish.
    const walls = room.polygon.map((_, edge) => {
      const old = room.walls?.find((w) => w.edge === edge);
      const { material: _m, color: _c, ...keep } = old ?? { edge };
      return { ...keep, edge, color: wall.color, ...(wall.material ? { material: wall.material } : {}) };
    });
    return {
      ...room,
      floor: { color: floor.color, ...(floor.material ? { material: floor.material } : {}) },
      ceiling: { color: style.ceiling },
      walls,
    };
  });
  const furniture = scene.furniture.map((f) => {
    if (f.fixed || !indoor.has(f.room)) return f;
    const color = furnitureColor(style, f);
    return color && color !== f.color ? { ...f, color } : f;
  });
  return { ...scene, rooms, furniture };
}
