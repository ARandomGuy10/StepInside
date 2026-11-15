import type { CatalogueItem } from './edits';

/** The shelves of the catalogue, in the order the panel shows them. */
export const GROUPS = ['Seating', 'Tables', 'Beds and storage', 'Lighting', 'On the wall', 'Decor', 'Outside'] as const;

type Shelf = (typeof GROUPS)[number];
const on = (group: Shelf, items: Omit<CatalogueItem, 'group'>[]): CatalogueItem[] => items.map((item) => ({ ...item, group }));

/**
 * The pieces that can be added from the panel. Sizes are width, height,
 * depth in metres, close to common shop sizes, so a piece shows how much
 * room the real thing would take.
 */
export const CATALOGUE: readonly CatalogueItem[] = [
  ...on('Seating', [
    { key: 'sofa-2', name: 'Two-seat sofa', model: 'sofa', size: [1.7, 0.75, 0.9], color: '#8c8577' },
    { key: 'sofa-3', name: 'Three-seat sofa', model: 'sofa', size: [2.2, 0.8, 0.95], color: '#d9d3c6' },
    { key: 'sofa-l', name: 'Corner sofa', model: 'sofa-l', size: [2.8, 0.78, 1.7], color: '#cfc8bc' },
    { key: 'armchair', name: 'Armchair', model: 'armchair', size: [0.85, 0.8, 0.85], color: '#7d8a74' },
    { key: 'chair', name: 'Dining chair', model: 'dining-chair', size: [0.5, 0.9, 0.5], color: '#7a4a35' },
    { key: 'ottoman', name: 'Footstool', model: 'ottoman', size: [0.5, 0.42, 0.5], color: '#7d8a74' },
    { key: 'bench', name: 'Bench', model: 'bench', size: [1.2, 0.45, 0.4], color: '#c8a57a' },
  ]),
  ...on('Tables', [
    { key: 'dining-6', name: 'Dining table, 6 seats', model: 'dining-table', size: [1.9, 0.75, 0.95], color: '#8a6243' },
    { key: 'round-table', name: 'Round table, 4 seats', model: 'round-table', size: [1.1, 0.75, 1.1], color: '#c8a57a' },
    { key: 'coffee-table', name: 'Coffee table', model: 'coffee-table', size: [1.0, 0.42, 0.55], color: '#3a2a22' },
    { key: 'side-table', name: 'Side table', model: 'side-table', size: [0.45, 0.5, 0.45], color: '#5a3d2b' },
    { key: 'desk', name: 'Desk', model: 'desk', size: [1.3, 0.75, 0.65], color: '#b9a68c' },
  ]),
  ...on('Beds and storage', [
    { key: 'bed', name: 'Double bed', model: 'bed', size: [1.7, 0.9, 2.1], color: '#8f97a3' },
    { key: 'bed-king', name: 'King bed', model: 'bed', size: [1.9, 0.95, 2.1], color: '#9aa7b8' },
    { key: 'bed-single', name: 'Single bed', model: 'bed', size: [1.0, 0.85, 2.0], color: '#b9b2a5' },
    { key: 'wardrobe', name: 'Wardrobe', model: 'wardrobe', size: [1.5, 2.2, 0.6], color: '#e9e6df' },
    { key: 'bookcase', name: 'Bookcase', model: 'bookcase', size: [0.9, 1.9, 0.32], color: '#e9e6df' },
    { key: 'sideboard', name: 'Sideboard', model: 'sideboard', size: [1.8, 0.8, 0.45], color: '#8a6243' },
    { key: 'tv-unit', name: 'TV unit', model: 'tv-unit', size: [1.8, 0.55, 0.42], color: '#8a6243' },
    { key: 'chest', name: 'Chest of drawers', model: 'chest', size: [1.0, 0.5, 0.45], color: '#4a2f22' },
  ]),
  ...on('Lighting', [
    { key: 'floor-lamp', name: 'Floor lamp', model: 'floor-lamp', size: [0.4, 1.6, 0.4], color: '#2b2b2b' },
    { key: 'table-lamp', name: 'Table lamp', model: 'table-lamp', size: [0.28, 0.5, 0.28], color: '#d9d2c3' },
  ]),
  ...on('On the wall', [
    { key: 'painting-wide', name: 'Painting, wide', model: 'painting-1', size: [1.2, 0.8, 0.04], color: '#2b2520', mount: 'wall', elevation: 1.25 },
    { key: 'painting-tall', name: 'Painting, tall', model: 'painting-2', size: [0.6, 0.9, 0.04], color: '#d8c7a6', mount: 'wall', elevation: 1.15 },
    { key: 'painting-square', name: 'Painting, square', model: 'painting-3', size: [0.7, 0.7, 0.04], color: '#f2f0ea', mount: 'wall', elevation: 1.25 },
    { key: 'print', name: 'Small print', model: 'painting-4', size: [0.4, 0.5, 0.03], color: '#1f1f1f', mount: 'wall', elevation: 1.4 },
    { key: 'wall-mirror', name: 'Round wall mirror', model: 'wall-mirror', size: [0.7, 0.7, 0.04], color: '#b08d4c', mount: 'wall', elevation: 1.2 },
    { key: 'wall-shelf', name: 'Wall shelf', model: 'wall-shelf', size: [0.9, 0.25, 0.2], color: '#5a3d2b', mount: 'wall', elevation: 1.5 },
  ]),
  ...on('Decor', [
    { key: 'rug', name: 'Rug', model: 'rug', size: [1.6, 0.02, 2.3], color: '#a9b0a2' },
    { key: 'plant', name: 'Floor plant', model: 'floor-plant', size: [0.7, 1.6, 0.7], color: '#c9c3b8' },
    { key: 'table-plant', name: 'Small plant', model: 'table-plant', size: [0.25, 0.32, 0.25], color: '#e9e3d8' },
    { key: 'vase', name: 'Vase', model: 'vase', size: [0.2, 0.5, 0.2], color: '#c7b299' },
    { key: 'books', name: 'Stack of books', model: 'books', size: [0.24, 0.12, 0.17], color: '#8a3b2e' },
    { key: 'standing-mirror', name: 'Standing mirror', model: 'standing-mirror', size: [0.6, 1.7, 0.4], color: '#c8a57a' },
  ]),
  ...on('Outside', [
    { key: 'box-ball', name: 'Box ball shrub', model: 'shrub-ball', size: [0.7, 0.65, 0.7], color: '#3f6b34' },
    { key: 'lounger', name: 'Sun lounger', model: 'lounger', size: [0.7, 0.4, 1.9], color: '#f4f2ee' },
    { key: 'tree', name: 'Small tree', model: 'tree', size: [1.4, 3.0, 1.4], color: '#3f6b34' },
  ]),
];
