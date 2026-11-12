import * as THREE from 'three';
import type { DemoRoom, Wall } from '../core/demoRoom';

/**
 * Builds the 3D shell of a room: floor, ceiling and walls.
 * Plan (x, y) maps to 3D (x, height, z). Three.js uses Y as "up".
 */
export function buildRoom(room: DemoRoom): THREE.Group {
  const group = new THREE.Group();
  group.name = 'room';

  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xb08968, roughness: 0.8 });
  const ceilingMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xf2efe9, roughness: 0.95 });

  // Floor and ceiling are thin slabs that extend under and over the walls,
  // so no light leaks in along the edges.
  const t = room.wallThickness;
  const slab = new THREE.BoxGeometry(room.width + 2 * t, 0.1, room.depth + 2 * t);

  const floor = new THREE.Mesh(slab, floorMaterial);
  floor.name = 'floor';
  floor.position.set(room.width / 2, -0.05, room.depth / 2);
  floor.receiveShadow = true;
  group.add(floor);

  const ceiling = new THREE.Mesh(slab, ceilingMaterial);
  ceiling.name = 'ceiling';
  ceiling.position.set(room.width / 2, room.ceilingHeight + 0.05, room.depth / 2);
  ceiling.castShadow = true;
  group.add(ceiling);

  room.walls.forEach((wall, i) => {
    const mesh = buildWall(wall, room.ceilingHeight, t, wallMaterial);
    mesh.name = `wall-${i}`;
    group.add(mesh);
  });

  return group;
}

/**
 * One wall, as a flat outline (length by height) with holes for its
 * openings, extruded to the wall thickness. The inside face sits exactly
 * on the plan line from a to b and the thickness goes outwards. Walls
 * are extended by one thickness at each end so the corners close.
 */
function buildWall(
  wall: Wall,
  height: number,
  thickness: number,
  material: THREE.Material,
): THREE.Mesh {
  const dx = wall.b.x - wall.a.x;
  const dy = wall.b.y - wall.a.y;
  const length = Math.hypot(dx, dy);

  const outline = new THREE.Shape();
  outline.moveTo(-thickness, 0);
  outline.lineTo(length + thickness, 0);
  outline.lineTo(length + thickness, height);
  outline.lineTo(-thickness, height);
  outline.closePath();

  for (const o of wall.openings) {
    const hole = new THREE.Path();
    hole.moveTo(o.offset, o.sill);
    hole.lineTo(o.offset + o.width, o.sill);
    hole.lineTo(o.offset + o.width, o.sill + o.height);
    hole.lineTo(o.offset, o.sill + o.height);
    hole.closePath();
    outline.holes.push(hole);
  }

  const geometry = new THREE.ExtrudeGeometry(outline, { depth: thickness, bevelEnabled: false });
  // The extrusion runs along local +Z, which ends up pointing into the
  // room, so shift it back to make the thickness go outwards instead.
  geometry.translate(0, 0, -thickness);

  const mesh = new THREE.Mesh(geometry, material);
  // Local X runs along the wall, local Y is up, local Z points into the room
  // (for a room whose corners are listed clockwise on the plan).
  const along = new THREE.Vector3(dx / length, 0, dy / length);
  const up = new THREE.Vector3(0, 1, 0);
  const inward = new THREE.Vector3().crossVectors(along, up);
  mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(along, up, inward));
  mesh.position.set(wall.a.x, 0, wall.a.y);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
