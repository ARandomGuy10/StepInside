import * as THREE from 'three';

/**
 * The surroundings of a plot: a street along the front (the bottom of
 * the plan) with a pavement, and a path from the pavement to the gate.
 * Flat coloured slabs are enough to place the home in a street.
 */
export function buildStreet(bounds: THREE.Box2, wall: number, reach: number, gateX: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'street';
  const front = bounds.max.y + wall;
  const x0 = bounds.min.x - reach;
  const x1 = bounds.max.x + reach;
  const strip = (name: string, color: string, fromX: number, toX: number, fromY: number, toY: number, top: number): void => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(toX - fromX, 0.04, toY - fromY),
      new THREE.MeshStandardMaterial({ color, roughness: 0.95 }),
    );
    mesh.name = name;
    mesh.position.set((fromX + toX) / 2, top - 0.02, (fromY + toY) / 2);
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  strip('verge', '#8fb26b', x0, x1, front, front + 1.6, -0.012);
  strip('pavement', '#d8d3c8', x0, x1, front + 1.6, front + 3.4, -0.004);
  strip('kerb', '#bdb8ad', x0, x1, front + 3.4, front + 3.55, -0.03);
  strip('road', '#5d6066', x0, x1, front + 3.55, Math.min(front + 11, bounds.max.y + reach), -0.06);
  strip('path', '#e3dccb', gateX - 0.75, gateX + 0.75, front, front + 1.6, -0.006);
  return group;
}
