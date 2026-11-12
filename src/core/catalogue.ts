import type { CatalogueItem } from './edits';

/** The pieces that can be added from the panel. Sizes are width, height, depth in metres. */
export const CATALOGUE: readonly CatalogueItem[] = [
  { key: 'painting-wide', name: 'Painting, wide', model: 'painting-1', size: [1.2, 0.8, 0.04], color: '#2b2520', mount: 'wall', elevation: 1.25 },
  { key: 'painting-tall', name: 'Painting, tall', model: 'painting-2', size: [0.6, 0.9, 0.04], color: '#d8c7a6', mount: 'wall', elevation: 1.15 },
  { key: 'painting-square', name: 'Painting, square', model: 'painting-3', size: [0.7, 0.7, 0.04], color: '#f2f0ea', mount: 'wall', elevation: 1.25 },
  { key: 'print', name: 'Small print', model: 'painting-4', size: [0.4, 0.5, 0.03], color: '#1f1f1f', mount: 'wall', elevation: 1.4 },
  { key: 'wall-mirror', name: 'Round wall mirror', model: 'wall-mirror', size: [0.7, 0.7, 0.04], color: '#b08d4c', mount: 'wall', elevation: 1.2 },
  { key: 'wall-shelf', name: 'Wall shelf', model: 'wall-shelf', size: [0.9, 0.25, 0.2], color: '#5a3d2b', mount: 'wall', elevation: 1.5 },
  { key: 'plant', name: 'Floor plant', model: 'floor-plant', size: [0.6, 1.5, 0.6], color: '#c9c3b8' },
  { key: 'floor-lamp', name: 'Floor lamp', model: 'floor-lamp', size: [0.4, 1.6, 0.4], color: '#2b2b2b' },
  { key: 'armchair', name: 'Armchair', model: 'armchair', size: [0.85, 0.8, 0.85], color: '#7d8a74' },
  { key: 'side-table', name: 'Side table', model: 'side-table', size: [0.45, 0.5, 0.45], color: '#5a3d2b' },
  { key: 'bookcase', name: 'Bookcase', model: 'bookcase', size: [0.9, 1.9, 0.32], color: '#e9e6df' },
  { key: 'rug', name: 'Rug', model: 'rug', size: [1.6, 0.02, 2.3], color: '#a9b0a2' },
  { key: 'bed', name: 'Double bed', model: 'bed', size: [1.7, 0.9, 2.1], color: '#8f97a3' },
  { key: 'desk', name: 'Desk', model: 'desk', size: [1.3, 0.75, 0.65], color: '#b9a68c' },
  { key: 'wardrobe', name: 'Wardrobe', model: 'wardrobe', size: [1.5, 2.2, 0.6], color: '#e9e6df' },
  { key: 'sofa-2', name: 'Two-seat sofa', model: 'sofa', size: [1.7, 0.75, 0.9], color: '#8c8577' },
  { key: 'chair', name: 'Dining chair', model: 'dining-chair', size: [0.5, 0.9, 0.5], color: '#7a4a35' },
  { key: 'coffee-table', name: 'Coffee table', model: 'coffee-table', size: [1.0, 0.42, 0.55], color: '#3a2a22' },
];
