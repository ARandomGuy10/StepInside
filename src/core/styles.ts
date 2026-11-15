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
  {
    key: 'minimal', name: 'Minimal', about: 'All white, pale stone, almost nothing else',
    wall: '#fbfbf9', ceiling: '#ffffff',
    floor: { material: 'large-tile', color: '#e4e2dd' },
    wetFloor: { material: 'large-tile', color: '#e9e7e2' },
    bathWall: { material: 'tile', color: '#f4f3f0' },
    fabric: '#dcdad4', wood: '#cfc4b2', kitchen: '#fafaf8', rug: '#ecebe6',
  },
  {
    key: 'warm-minimal', name: 'Warm minimal', about: 'Cream plaster, honey oak, oatmeal',
    wall: '#f1e9dc', ceiling: '#faf6ee',
    floor: { material: 'laminate', color: '#cfa97a' },
    wetFloor: { material: 'stone', color: '#d9cdb9' },
    bathWall: { material: 'stone', color: '#e6dccb' },
    fabric: '#d9c9ae', wood: '#b98d5e', kitchen: '#efe6d6', rug: '#e3d6bf',
  },
  {
    key: 'mid-century', name: 'Mid-century', about: 'Teak, mustard, olive green',
    wall: '#f3eee2', ceiling: '#fbf8f0',
    floor: { material: 'laminate', color: '#a8683c' },
    wetFloor: { material: 'tile', color: '#d9d2c0' },
    bathWall: { material: 'tile', color: '#e9e2cf' },
    fabric: '#c79a2e', wood: '#8a5230', kitchen: '#5f6b3e', rug: '#b8643a',
  },
  {
    key: 'art-deco', name: 'Art deco', about: 'Emerald, black marble, brass tones',
    wall: '#1f4a40', ceiling: '#f3ecdc',
    floor: { material: 'large-tile', color: '#2b2b2b' },
    wetFloor: { material: 'large-tile', color: '#1c1c1e' },
    bathWall: { material: 'stone', color: '#e9e3d6' },
    fabric: '#b08d4a', wood: '#2a1f18', kitchen: '#16302a', rug: '#8a6a2f',
  },
  {
    key: 'bohemian', name: 'Bohemian', about: 'Terracotta, ochre, patterned warmth',
    wall: '#f2e2cf', ceiling: '#fbf3e6',
    floor: { material: 'laminate', color: '#b47a4c' },
    wetFloor: { material: 'tile', color: '#c98a5e' },
    bathWall: { material: 'tile', color: '#e8cfae' },
    fabric: '#b5533c', wood: '#8a5a35', kitchen: '#3f6b62', rug: '#c4472f',
  },
  {
    key: 'farmhouse', name: 'Farmhouse', about: 'Shiplap white, worn oak, sage',
    wall: '#f4f1e8', ceiling: '#ffffff',
    floor: { material: 'laminate', color: '#b89468' },
    wetFloor: { material: 'tile', color: '#d8d3c6' },
    bathWall: { material: 'wood', color: '#eeeade' },
    fabric: '#a9b39a', wood: '#9a7550', kitchen: '#8c9a84', rug: '#d9cfbb',
  },
  {
    key: 'rustic', name: 'Rustic', about: 'Stone walls, heavy timber, wool',
    wall: '#d9c9b0', ceiling: '#efe6d6',
    floor: { material: 'laminate', color: '#7a5536' },
    wetFloor: { material: 'stone', color: '#a89880' },
    bathWall: { material: 'stone', color: '#b8a890' },
    fabric: '#8a6a4a', wood: '#5a3d28', kitchen: '#6e5238', rug: '#9a5a3a',
  },
  {
    key: 'tropical', name: 'Tropical', about: 'Palm green, rattan, bright white',
    wall: '#f6f7f1', ceiling: '#ffffff',
    floor: { material: 'laminate', color: '#c8a06a' },
    wetFloor: { material: 'tile', color: '#dfe9e0' },
    bathWall: { material: 'tile', color: '#cfe3d3' },
    fabric: '#3f7a5a', wood: '#c49a5e', kitchen: '#eef1e8', rug: '#d8c79a',
  },
  {
    key: 'desert', name: 'Desert', about: 'Sand, clay pink, sun-bleached wood',
    wall: '#ead8c2', ceiling: '#f7efe2',
    floor: { material: 'tile', color: '#d2a47e' },
    wetFloor: { material: 'tile', color: '#e3cdb3' },
    bathWall: { material: 'stone', color: '#e0c6aa' },
    fabric: '#c98b6b', wood: '#b99466', kitchen: '#d9b596', rug: '#b86a4a',
  },
  {
    key: 'wabi-sabi', name: 'Wabi-sabi', about: 'Raw plaster, ash grey, weathered wood',
    wall: '#d8d2c6', ceiling: '#e6e1d6',
    floor: { material: 'concrete', color: '#b3ada1' },
    wetFloor: { material: 'stone', color: '#a9a396' },
    bathWall: { material: 'stone', color: '#bdb7aa' },
    fabric: '#a39a8a', wood: '#7a6a58', kitchen: '#b8b0a2', rug: '#c2b9a8',
  },
  {
    key: 'french-country', name: 'French country', about: 'Chalk white, pale blue, limed oak',
    wall: '#f5f1e8', ceiling: '#fdfbf5',
    floor: { material: 'laminate', color: '#c9b089' },
    wetFloor: { material: 'tile', color: '#e6e3da' },
    bathWall: { material: 'tile', color: '#dfe7ee' },
    fabric: '#b7c6d6', wood: '#c8b592', kitchen: '#dfe6ea', rug: '#e6d9c2',
  },
  {
    key: 'english-cottage', name: 'English cottage', about: 'Rose, moss green, dark oak',
    wall: '#f1e6dc', ceiling: '#faf5ee',
    floor: { material: 'laminate', color: '#8f6844' },
    wetFloor: { material: 'tile', color: '#d3c9b8' },
    bathWall: { material: 'tile', color: '#e2e9dc' },
    fabric: '#b9767a', wood: '#6a4a30', kitchen: '#566b4c', rug: '#a84f4f',
  },
  {
    key: 'urban-loft', name: 'Urban loft', about: 'Brick red, raw concrete, black',
    wall: '#9a5a48', ceiling: '#cfccc6',
    floor: { material: 'concrete', color: '#9b9892' },
    wetFloor: { material: 'concrete', color: '#7d7a75' },
    bathWall: { material: 'tile', color: '#2f3133' },
    fabric: '#3a3c3f', wood: '#3b2d24', kitchen: '#1e1f21', rug: '#6b6661',
  },
  {
    key: 'monochrome', name: 'Monochrome', about: 'Black, white and one grey',
    wall: '#ffffff', ceiling: '#ffffff',
    floor: { material: 'large-tile', color: '#1f1f21' },
    wetFloor: { material: 'tile', color: '#f2f2f2' },
    bathWall: { material: 'tile', color: '#1f1f21' },
    fabric: '#2b2b2d', wood: '#1a1a1c', kitchen: '#111113', rug: '#8c8c8e',
  },
  {
    key: 'greige', name: 'Greige', about: 'Grey-beige everything, quietly',
    wall: '#ddd6ca', ceiling: '#f1ede5',
    floor: { material: 'laminate', color: '#b9a58a' },
    wetFloor: { material: 'large-tile', color: '#cfc7b9' },
    bathWall: { material: 'tile', color: '#e2dccf' },
    fabric: '#b8ae9e', wood: '#a08a6e', kitchen: '#d2cabc', rug: '#c9c0b0',
  },
  {
    key: 'earthy', name: 'Earthy', about: 'Olive, clay, walnut',
    wall: '#cdbf9f', ceiling: '#eee6d3',
    floor: { material: 'laminate', color: '#7d5a3c' },
    wetFloor: { material: 'stone', color: '#b3a385' },
    bathWall: { material: 'stone', color: '#c4b596' },
    fabric: '#6b6f45', wood: '#5e422c', kitchen: '#77623f', rug: '#a85f3d',
  },
  {
    key: 'pastel', name: 'Pastel', about: 'Blush, mint, butter yellow',
    wall: '#f8e6e2', ceiling: '#fffaf7',
    floor: { material: 'laminate', color: '#e3cdaa' },
    wetFloor: { material: 'tile', color: '#dcefe6' },
    bathWall: { material: 'tile', color: '#e3f1ea' },
    fabric: '#b9dccb', wood: '#e8d4b0', kitchen: '#f3e7a8', rug: '#f1c9c2',
  },
  {
    key: 'jewel', name: 'Jewel tones', about: 'Sapphire, plum, dark walnut',
    wall: '#27406b', ceiling: '#f0ebe0',
    floor: { material: 'laminate', color: '#553726' },
    wetFloor: { material: 'large-tile', color: '#2a2530' },
    bathWall: { material: 'tile', color: '#3b2f4a' },
    fabric: '#6a2d5a', wood: '#3a251a', kitchen: '#1f2f4f', rug: '#8a2f3f',
  },
  {
    key: 'nordic-dark', name: 'Nordic dark', about: 'Ink blue, smoked oak, wool grey',
    wall: '#2f3a44', ceiling: '#e9e7e2',
    floor: { material: 'laminate', color: '#6f5a48' },
    wetFloor: { material: 'large-tile', color: '#3a3f44' },
    bathWall: { material: 'tile', color: '#4a5259' },
    fabric: '#8b9096', wood: '#4f4034', kitchen: '#232a31', rug: '#9a958c',
  },
  {
    key: 'zen', name: 'Zen', about: 'Bamboo, off-white, river stone',
    wall: '#f2efe6', ceiling: '#faf8f1',
    floor: { material: 'laminate', color: '#d2b98a' },
    wetFloor: { material: 'stone', color: '#b9b5aa' },
    bathWall: { material: 'stone', color: '#c9c5ba' },
    fabric: '#d9d2c0', wood: '#a98f62', kitchen: '#e6e0d0', rug: '#c8c0a8',
  },
  {
    key: 'hamptons', name: 'Hamptons', about: 'Navy, crisp white, weathered grey oak',
    wall: '#f7f8f8', ceiling: '#ffffff',
    floor: { material: 'laminate', color: '#b3a794' },
    wetFloor: { material: 'tile', color: '#e9edf0' },
    bathWall: { material: 'tile', color: '#dbe3ea' },
    fabric: '#2f4666', wood: '#ded8cc', kitchen: '#ffffff', rug: '#c9d3de',
  },
  {
    key: 'modern-indian', name: 'Modern Indian', about: 'Warm white, teak, marigold and indigo',
    wall: '#f6efe1', ceiling: '#fdf9f0',
    floor: { material: 'large-tile', color: '#e6dccb' },
    wetFloor: { material: 'tile', color: '#d9cdb8' },
    bathWall: { material: 'tile', color: '#e9e0cf' },
    fabric: '#d98a1f', wood: '#7a4a28', kitchen: '#2f3f7a', rug: '#a3312f',
  },
  {
    key: 'terracotta', name: 'Terracotta', about: 'Baked clay floors, lime wash, olive wood',
    wall: '#f3e9da', ceiling: '#faf4e9',
    floor: { material: 'tile', color: '#b9684a' },
    wetFloor: { material: 'tile', color: '#c98463' },
    bathWall: { material: 'tile', color: '#ead9c2' },
    fabric: '#8a8f5a', wood: '#9a744e', kitchen: '#e6d6bd', rug: '#d6a36a',
  },
  {
    key: 'glam', name: 'Glam', about: 'Blush velvet, marble, champagne',
    wall: '#f3e9e6', ceiling: '#fffdfb',
    floor: { material: 'large-tile', color: '#eeeae4' },
    wetFloor: { material: 'large-tile', color: '#e6e1da' },
    bathWall: { material: 'stone', color: '#f1ece6' },
    fabric: '#d9a9ad', wood: '#c9b089', kitchen: '#f7f3ee', rug: '#cdb8a0',
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
