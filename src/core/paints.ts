/**
 * The ready-made paints in the Finishes panel, with plain names, in groups
 * the way a paint card is laid out. The names are ours, not a brand's.
 */
export interface Paint {
  hex: string;
  name: string;
}

export const PAINT_GROUPS: readonly { name: string; paints: readonly Paint[] }[] = [
  {
    name: 'Whites and creams',
    paints: [
      { hex: '#ffffff', name: 'Pure white' },
      { hex: '#f1ece3', name: 'Lime wash' },
      { hex: '#e6dccb', name: 'Oat' },
      { hex: '#d8c7a6', name: 'Sandstone' },
      { hex: '#f2e3b3', name: 'Butter' },
      { hex: '#f3dcd4', name: 'Shell pink' },
    ],
  },
  {
    name: 'Earth',
    paints: [
      { hex: '#c9b79c', name: 'Mud plaster' },
      { hex: '#b8946b', name: 'Biscuit' },
      { hex: '#8c7b6b', name: 'Taupe' },
      { hex: '#4a3a30', name: 'Walnut' },
      { hex: '#e2a89a', name: 'Clay' },
      { hex: '#c8553d', name: 'Terracotta' },
      { hex: '#8f3f34', name: 'Brick red' },
      { hex: '#e3b23c', name: 'Turmeric' },
    ],
  },
  {
    name: 'Greens and blues',
    paints: [
      { hex: '#dfe5dc', name: 'Mist green' },
      { hex: '#b7c4b1', name: 'Sage' },
      { hex: '#7d8a74', name: 'Olive leaf' },
      { hex: '#40513b', name: 'Forest' },
      { hex: '#dbe4ea', name: 'Morning sky' },
      { hex: '#9fb4c7', name: 'Rain blue' },
      { hex: '#4f6d8a', name: 'Indigo wash' },
      { hex: '#22313f', name: 'Midnight' },
    ],
  },
  {
    name: 'Greys',
    paints: [
      { hex: '#8a8f98', name: 'Slate' },
      { hex: '#22201d', name: 'Charcoal' },
    ],
  },
];

const BY_HEX = new Map(PAINT_GROUPS.flatMap((g) => g.paints).map((p) => [p.hex, p.name]));

/** The name of a ready-made paint, or undefined for a colour mixed by hand. */
export function paintName(hex: string): string | undefined {
  return BY_HEX.get(hex.toLowerCase());
}
