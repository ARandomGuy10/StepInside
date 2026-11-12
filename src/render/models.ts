import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { artTexture, pattern, type Pattern } from './textures';

/**
 * Furniture models built in code from simple rounded shapes.
 *
 * Every builder fills the box [width, height, depth] it is given: centred
 * on x and z, standing on y = 0. The front of a piece faces -z, which is
 * "up the page" on the plan when its rotation is 0.
 *
 * A glTF file in /public/models with the same name wins over a builder,
 * and a piece with neither is drawn as a plain box.
 */

type Size = readonly [number, number, number];
type Builder = (kit: Kit, size: Size, color: THREE.Color) => void;

interface MatOptions {
  roughness?: number;
  metalness?: number;
  map?: Pattern;
  repeat?: number;
  opacity?: number;
  emissive?: THREE.ColorRepresentation;
}

const mix = (c: THREE.Color, target: THREE.ColorRepresentation, t: number): THREE.Color =>
  c.clone().lerp(new THREE.Color(target), t);
const darker = (c: THREE.Color, t = 0.25): THREE.Color => mix(c, '#000000', t);
const lighter = (c: THREE.Color, t = 0.25): THREE.Color => mix(c, '#ffffff', t);

function mat(color: THREE.ColorRepresentation, o: MatOptions = {}): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: o.roughness ?? 0.8,
    metalness: o.metalness ?? 0,
  });
  if (o.map) material.map = pattern(o.map, o.repeat ?? 1);
  if (o.opacity !== undefined) {
    material.transparent = true;
    material.opacity = o.opacity;
    material.depthWrite = false;
  }
  if (o.emissive !== undefined) material.emissive = new THREE.Color(o.emissive);
  return material;
}

const STEEL = (): THREE.MeshStandardMaterial => mat('#b9bcc0', { roughness: 0.3, metalness: 0.9 });
const BRASS = (): THREE.MeshStandardMaterial => mat('#b08d4c', { roughness: 0.35, metalness: 0.9 });
const BLACK = (): THREE.MeshStandardMaterial => mat('#1b1b1d', { roughness: 0.5 });

/** Collects the parts of one piece. Positions are the centres of the parts. */
class Kit {
  readonly group = new THREE.Group();

  box(w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material, radius = 0): THREE.Mesh {
    const r = Math.min(radius, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
    const geometry = r > 0.002 ? new RoundedBoxGeometry(w, h, d, 3, r) : new THREE.BoxGeometry(w, h, d);
    return this.add(new THREE.Mesh(geometry, material), x, y, z);
  }

  cyl(rTop: number, rBottom: number, h: number, x: number, y: number, z: number, material: THREE.Material, segments = 24): THREE.Mesh {
    return this.add(new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), material), x, y, z);
  }

  ball(r: number, x: number, y: number, z: number, material: THREE.Material): THREE.Mesh {
    return this.add(new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), material), x, y, z);
  }

  add<T extends THREE.Object3D>(object: T, x = 0, y = 0, z = 0): T {
    object.position.set(x, y, z);
    this.group.add(object);
    return object;
  }
}

function plant(kit: Kit, x: number, y: number, z: number, scale = 1): void {
  kit.cyl(0.09 * scale, 0.065 * scale, 0.15 * scale, x, y + 0.075 * scale, z, mat('#e6e2da', { roughness: 0.6 }));
  const leaf = mat('#3f7d46', { roughness: 0.7 });
  const random = (i: number): number => Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
  for (let i = 0; i < 9; i++) {
    const angle = (i / 9) * Math.PI * 2;
    const reach = (0.08 + random(i) * 0.12) * scale;
    const blob = kit.ball(0.07 * scale, x + Math.cos(angle) * reach, y + (0.24 + random(i + 3) * 0.2) * scale, z + Math.sin(angle) * reach, leaf);
    blob.scale.set(1.2, 0.35, 0.8);
    blob.rotation.set(random(i + 5) - 0.5, angle, 0.5);
  }
}

function bottles(kit: Kit, y: number, w: number, d: number, count: number): void {
  const colors = ['#3c5a3e', '#8a5a2b', '#d9d2c4', '#2f3e52', '#7a2f2f'];
  for (let i = 0; i < count; i++) {
    const x = -w / 2 + 0.08 + ((w - 0.16) * i) / Math.max(1, count - 1);
    const z = (i % 2 === 0 ? -1 : 1) * d * 0.18;
    const h = 0.18 + (i % 3) * 0.05;
    kit.cyl(0.03, 0.035, h, x, y + h / 2, z, mat(colors[i % colors.length], { roughness: 0.25, opacity: 0.85 }), 12);
    kit.cyl(0.012, 0.014, 0.06, x, y + h + 0.03, z, mat(colors[i % colors.length], { roughness: 0.25, opacity: 0.85 }), 8);
  }
}

// ---------------------------------------------------------------------------

const sofa: Builder = (k, [w, h, d], color) => {
  const fabric = mat(color, { roughness: 0.95, map: 'fabric', repeat: 3 });
  const cushion = mat(lighter(color, 0.2), { roughness: 0.95, map: 'fabric', repeat: 3 });
  const arm = 0.17;
  const back = 0.22;
  k.box(w, 0.28, d, 0, 0.2, 0, fabric, 0.06);
  k.box(w, h - 0.3, back, 0, 0.3 + (h - 0.3) / 2, d / 2 - back / 2, fabric, 0.09);
  for (const side of [-1, 1]) k.box(arm, h * 0.82 - 0.06, d, side * (w / 2 - arm / 2), 0.06 + (h * 0.82 - 0.06) / 2, 0, fabric, 0.07);
  const inner = w - 2 * arm;
  const count = Math.max(1, Math.round(inner / 0.75));
  const cw = inner / count;
  for (let i = 0; i < count; i++) {
    const x = -inner / 2 + cw * (i + 0.5);
    k.box(cw - 0.02, 0.17, d - back - 0.02, x, 0.42, -back / 2 + 0.01, cushion, 0.07);
    const pillow = k.box(cw - 0.08, 0.36, 0.17, x, 0.67, d / 2 - back - 0.09, cushion, 0.08);
    pillow.rotation.x = 0.22;
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cyl(0.025, 0.02, 0.06, sx * (w / 2 - 0.1), 0.03, sz * (d / 2 - 0.1), BLACK(), 8);
};

const ottoman: Builder = (k, [w, h, d], color) => {
  const fabric = mat(color, { roughness: 0.95, map: 'fabric', repeat: 3 });
  k.box(w, h - 0.2, d, 0, 0.06 + (h - 0.2) / 2, 0, fabric, 0.06);
  k.box(w - 0.03, 0.16, d - 0.03, 0, h - 0.08, 0, mat(lighter(color, 0.2), { roughness: 0.95, map: 'fabric', repeat: 3 }), 0.07);
};

const rug: Builder = (k, [w, h, d], color) => {
  k.box(w, h, d, 0, h / 2, 0, mat(color, { roughness: 1, map: 'weave', repeat: 6 }));
  k.box(w - 0.3, h, d - 0.3, 0, h / 2 + 0.002, 0, mat(lighter(color, 0.12), { roughness: 1, map: 'weave', repeat: 6 }));
};

const coffeeTable: Builder = (k, [w, h, d], color) => {
  const wood = mat(color, { roughness: 0.55, map: 'wood', repeat: 2 });
  k.box(w, 0.045, d, 0, h - 0.0225, 0, mat('#3a3f3d', { roughness: 0.2 }), 0.01);
  k.box(w - 0.08, 0.07, d - 0.08, 0, h - 0.08, 0, wood);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.05, h - 0.045, 0.05, sx * (w / 2 - 0.07), (h - 0.045) / 2, sz * (d / 2 - 0.07), wood, 0.008);
};

const tvUnit: Builder = (k, [w, h, d], color) => {
  const wood = mat(color, { roughness: 0.6, map: 'wood', repeat: 2 });
  k.box(w, h - 0.12, d, 0, 0.12 + (h - 0.12) / 2, 0, wood, 0.015);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cyl(0.02, 0.014, 0.12, sx * (w / 2 - 0.08), 0.06, sz * (d / 2 - 0.07), BRASS(), 10);
  const rattan = mat('#c9ad7f', { roughness: 0.9, map: 'weave', repeat: 4 });
  for (let i = 0; i < 4; i++) {
    const x = -w / 2 + (w / 4) * (i + 0.5);
    k.box(w / 4 - 0.05, h - 0.24, 0.012, x, 0.12 + (h - 0.12) / 2, -d / 2 - 0.004, rattan, 0.005);
  }
  const tv = Math.min(w * 0.8, 1.3);
  k.box(0.32, 0.02, 0.2, 0, h + 0.01, 0, BLACK());
  k.box(0.06, 0.08, 0.03, 0, h + 0.06, 0.03, BLACK());
  k.box(tv, tv * 0.57, 0.035, 0, h + 0.08 + tv * 0.285, 0.03, BLACK(), 0.008);
  k.box(tv - 0.03, tv * 0.57 - 0.03, 0.005, 0, h + 0.08 + tv * 0.285, 0.011, mat('#0c1016', { roughness: 0.08, metalness: 0.4 }));
};

const plantShelf: Builder = (k, [w, h, d]) => {
  const frame = BLACK();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.025, h, 0.025, sx * (w / 2 - 0.0125), h / 2, sz * (d / 2 - 0.0125), frame);
  const shelf = mat('#3a2a20', { roughness: 0.6, map: 'wood', repeat: 2 });
  const levels = 5;
  for (let i = 0; i < levels; i++) k.box(w - 0.03, 0.02, d - 0.02, 0, 0.12 + ((h - 0.14) * i) / (levels - 1), 0, shelf);
  const step = (h - 0.14) / (levels - 1);
  const books = ['#b5533c', '#d8c9a3', '#3f5e7a', '#6d8f5b'];
  books.forEach((c, i) => k.box(0.035, 0.2 + (i % 2) * 0.03, 0.15, -w / 2 + 0.07 + i * 0.045, 0.13 + (0.2 + (i % 2) * 0.03) / 2, 0, mat(c)));
  k.cyl(0.07, 0.05, 0.2, w / 2 - 0.13, 0.13 + step + 0.1, 0, mat('#e9e4da', { roughness: 0.4 }));
  plant(k, -w / 2 + 0.14, 0.13 + step * 2, 0, 0.8);
  k.ball(0.07, w / 2 - 0.14, 0.13 + step * 3 + 0.07, 0, mat('#f3efe6', { roughness: 0.3, emissive: '#3a3020' }));
  plant(k, 0, h, 0, 1.25);
};

const barTrolley: Builder = (k, [w, h, d]) => {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    k.cyl(0.011, 0.011, h - 0.06, sx * (w / 2 - 0.02), 0.06 + (h - 0.06) / 2, sz * (d / 2 - 0.02), BRASS(), 8);
    const wheel = k.cyl(0.03, 0.03, 0.02, sx * (w / 2 - 0.02), 0.03, sz * (d / 2 - 0.02), BLACK(), 12);
    wheel.rotation.z = Math.PI / 2;
  }
  const glass = mat('#2a2622', { roughness: 0.15, opacity: 0.75 });
  for (const y of [0.22, h - 0.12]) {
    k.box(w - 0.02, 0.012, d - 0.02, 0, y, 0, glass);
    k.box(w, 0.02, 0.012, 0, y + 0.03, -d / 2 + 0.006, BRASS());
    k.box(w, 0.02, 0.012, 0, y + 0.03, d / 2 - 0.006, BRASS());
  }
  bottles(k, 0.226, w, d, 4);
  bottles(k, h - 0.114, w, d, 5);
};

const sideboard: Builder = (k, [w, h, d], color) => {
  const wood = mat(color, { roughness: 0.5, map: 'wood', repeat: 2 });
  const relief = mat(lighter(color, 0.12), { roughness: 0.55, map: 'wood', repeat: 3 });
  k.box(w - 0.04, h - 0.1, d - 0.05, 0, 0.06 + (h - 0.1) / 2, 0.025, wood, 0.01);
  k.box(w, 0.06, d - 0.01, 0, 0.03, 0.005, mat(darker(color, 0.2), { roughness: 0.6 }), 0.01);
  k.box(w, 0.045, d, 0, h - 0.0225, 0, wood, 0.012);
  k.box(w - 0.12, 0.11, 0.02, 0, h - 0.13, -d / 2 + 0.035, relief, 0.008);
  for (const side of [-1, 1]) {
    const x = side * (w / 4 - 0.02);
    k.box(w / 2 - 0.1, h - 0.34, 0.025, x, 0.09 + (h - 0.34) / 2, -d / 2 + 0.035, relief, 0.01);
    k.box(w / 2 - 0.22, h - 0.48, 0.02, x, 0.09 + (h - 0.34) / 2, -d / 2 + 0.022, wood, 0.03);
    k.ball(0.018, side * 0.035, 0.09 + (h - 0.34) / 2, -d / 2 + 0.012, BRASS());
    k.ball(0.022, side * (w / 2 - 0.04), h - 0.13, -d / 2 + 0.02, BRASS());
  }
  // The mirror leaning on top, a serving bowl and a vase with blossom.
  const mw = Math.min(w * 0.8, 1.0);
  const frame = k.box(mw, 0.82, 0.05, w * 0.08, h + 0.42, d / 2 - 0.09, mat('#2e1f18', { roughness: 0.6, map: 'wood', repeat: 2 }), 0.01);
  frame.rotation.x = 0.16;
  const glass = k.box(mw - 0.2, 0.6, 0.012, w * 0.08, h + 0.4, d / 2 - 0.118, mat('#c3ced4', { roughness: 0.08, metalness: 0.35 }));
  glass.rotation.x = 0.16;
  k.cyl(0.14, 0.06, 0.07, -w * 0.18, h + 0.1, -0.05, STEEL());
  k.cyl(0.05, 0.05, 0.06, -w * 0.18, h + 0.03, -0.05, STEEL());
  k.cyl(0.05, 0.075, 0.24, -w / 2 + 0.12, h + 0.12, 0.05, mat('#e8dcc0', { roughness: 0.35 }));
  const blossom = mat('#e9a9b7', { roughness: 0.8 });
  for (let i = 0; i < 6; i++) {
    const twig = k.cyl(0.004, 0.006, 0.55, -w / 2 + 0.12 + (i - 2.5) * 0.03, h + 0.5, 0.05, mat('#4a3526'), 5);
    twig.rotation.z = (i - 2.5) * -0.13;
    k.ball(0.022, -w / 2 + 0.12 + (i - 2.5) * 0.1, h + 0.62 + (i % 3) * 0.06, 0.05 + (i % 2) * 0.03, blossom);
  }
};

const wickerDrawers: Builder = (k, [w, h, d], color) => {
  k.box(w, h, d - 0.02, 0, h / 2, 0.01, mat(darker(color, 0.25), { roughness: 0.7, map: 'wood', repeat: 2 }), 0.008);
  const wicker = mat(color, { roughness: 0.95, map: 'weave', repeat: 5 });
  const rows = 3;
  const rh = (h - 0.08) / rows;
  for (let i = 0; i < rows; i++) {
    k.box(w - 0.06, rh - 0.03, 0.03, 0, 0.04 + rh * (i + 0.5), -d / 2 + 0.015, wicker, 0.012);
    k.box(0.1, 0.02, 0.012, 0, 0.04 + rh * (i + 0.72), -d / 2 - 0.004, mat(darker(color, 0.4)));
  }
};

const standingMirror: Builder = (k, [w, h, d]) => {
  const wood = mat('#c8ad84', { roughness: 0.6, map: 'wood', repeat: 2 });
  const lean = Math.atan2(d - 0.06, h);
  const tilt = new THREE.Group();
  const kit = new Kit();
  kit.box(w, h, 0.03, 0, h / 2, 0, wood, 0.014);
  kit.box(w - 0.07, h - 0.07, 0.006, 0, h / 2, -0.016, mat('#c3ced4', { roughness: 0.08, metalness: 0.35 }));
  tilt.add(kit.group);
  tilt.rotation.x = lean;
  k.add(tilt, 0, 0, -d / 2 + 0.03);
  const leg = k.box(0.03, h * 0.72, 0.03, 0, h * 0.35, d / 2 - 0.1, wood);
  leg.rotation.x = -0.12;
};

const chest: Builder = (k, [w, h, d], color) => {
  const wood = mat(color, { roughness: 0.55, map: 'wood', repeat: 2 });
  const relief = mat(lighter(color, 0.1), { roughness: 0.6, map: 'wood', repeat: 3 });
  const body = h - 0.14;
  k.box(w - 0.02, body - 0.05, d - 0.02, 0, 0.05 + (body - 0.05) / 2, 0, wood, 0.008);
  k.box(w, 0.04, d, 0, body + 0.02, 0, wood, 0.01);
  for (let i = 0; i < 3; i++) k.box(w / 3 - 0.06, body - 0.16, 0.014, -w / 3 + (w / 3) * i, 0.05 + (body - 0.05) / 2, -d / 2 + 0.006, relief, 0.006);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.06, 0.05, 0.06, sx * (w / 2 - 0.05), 0.025, sz * (d / 2 - 0.05), wood);
  k.box(w * 0.42, 0.1, d * 0.85, -w * 0.22, body + 0.09, 0, mat('#e3c64f', { roughness: 0.95, map: 'fabric', repeat: 2 }), 0.045);
  k.box(w * 0.36, 0.09, d * 0.8, w * 0.24, body + 0.085, 0, mat('#d9d3c6', { roughness: 0.95, map: 'fabric', repeat: 2 }), 0.04);
};

const roundTable: Builder = (k, [w, h, d], color) => {
  const wood = mat(color, { roughness: 0.35, map: 'wood', repeat: 2 });
  const r = Math.min(w, d) / 2;
  k.cyl(r, r - 0.012, 0.035, 0, h - 0.0175, 0, wood, 48);
  k.cyl(r * 0.55, r * 0.55, 0.05, 0, h - 0.06, 0, wood, 32);
  k.cyl(0.055, 0.085, h - 0.24, 0, 0.16 + (h - 0.24) / 2, 0, wood, 16);
  k.cyl(0.1, 0.1, 0.03, 0, 0.17, 0, wood, 16);
  for (let i = 0; i < 4; i++) {
    const foot = k.box(r * 0.8, 0.05, 0.06, 0, 0.1, 0, wood, 0.02);
    foot.rotation.y = (i * Math.PI) / 2 + Math.PI / 4;
    foot.rotation.z = -0.22;
    foot.position.set(Math.cos(foot.rotation.y) * r * 0.36, 0.09, -Math.sin(foot.rotation.y) * r * 0.36);
  }
  // A stack of plates and a couple of books, as in the photos.
  k.cyl(0.13, 0.1, 0.05, r * 0.15, h + 0.025, -r * 0.1, mat('#2a2a2c', { roughness: 0.5 }));
  k.box(0.2, 0.03, 0.14, -r * 0.4, h + 0.015, r * 0.25, mat('#3f6b57'));
};

const diningChair: Builder = (k, [w, h, d], color) => {
  const wood = mat(color, { roughness: 0.45, map: 'wood', repeat: 2 });
  const seat = 0.46;
  for (const sx of [-1, 1]) {
    k.box(0.035, seat, 0.035, sx * (w / 2 - 0.03), seat / 2, -d / 2 + 0.03, wood, 0.008);
    k.box(0.035, h, 0.035, sx * (w / 2 - 0.03), h / 2, d / 2 - 0.03, wood, 0.008);
    k.box(0.035, 0.03, d - 0.08, sx * (w / 2 - 0.03), seat + 0.2, 0, wood, 0.01);
    k.box(0.03, 0.2, 0.03, sx * (w / 2 - 0.03), seat + 0.1, -d / 2 + 0.06, wood, 0.008);
  }
  k.box(w - 0.02, 0.05, d - 0.02, 0, seat - 0.03, 0, wood, 0.01);
  k.box(w - 0.07, 0.05, d - 0.08, 0, seat + 0.015, -0.005, mat('#c8946a', { roughness: 0.95, map: 'fabric', repeat: 2 }), 0.024);
  k.box(w - 0.06, 0.08, 0.03, 0, h - 0.04, d / 2 - 0.03, wood, 0.012);
  k.box(w - 0.06, 0.03, 0.025, 0, seat + 0.14, d / 2 - 0.03, wood);
  for (let i = 0; i < 3; i++) k.box(0.035, h - seat - 0.2, 0.015, (i - 1) * 0.085, seat + 0.14 + (h - seat - 0.2) / 2, d / 2 - 0.03, wood);
};

const bureau: Builder = (k, [w, h, d], color) => {
  const wood = mat(color, { roughness: 0.5, map: 'wood', repeat: 2 });
  const relief = mat(lighter(color, 0.1), { roughness: 0.55, map: 'wood', repeat: 2 });
  const lower = Math.min(1.0, h * 0.52);
  k.box(w, lower - 0.3, d, 0, (lower - 0.3) / 2, 0, wood, 0.008);
  for (let i = 0; i < 3; i++) {
    const y = 0.07 + ((lower - 0.4) / 3) * (i + 0.5);
    k.box(w - 0.08, (lower - 0.4) / 3 - 0.025, 0.014, 0, y, -d / 2 - 0.002, relief, 0.006);
    for (const sx of [-1, 1]) k.ball(0.016, sx * w * 0.25, y, -d / 2 - 0.014, BRASS());
  }
  // The sloping writing flap.
  k.box(w, 0.3, d * 0.55, 0, lower - 0.15, d * 0.225, wood, 0.008);
  const flap = k.box(w - 0.02, 0.34, 0.022, 0, lower - 0.15, -d * 0.2, relief, 0.006);
  flap.rotation.x = -0.75;
  // The glass cabinet on top.
  const upper = h - lower;
  const ud = d * 0.62;
  const uz = d / 2 - ud / 2;
  k.box(w - 0.04, upper, 0.02, 0, lower + upper / 2, d / 2 - 0.01, wood);
  for (const sx of [-1, 1]) k.box(0.025, upper, ud, sx * (w / 2 - 0.0325), lower + upper / 2, uz, wood);
  k.box(w, 0.05, ud + 0.03, 0, h - 0.025, uz - 0.01, wood, 0.012);
  for (let i = 1; i < 4; i++) k.box(w - 0.07, 0.014, ud - 0.03, 0, lower + (upper / 4) * i, uz, relief);
  k.box(w - 0.07, upper - 0.06, 0.006, 0, lower + upper / 2 - 0.01, uz - ud / 2 + 0.012, mat('#cfe0e2', { roughness: 0.05, opacity: 0.22 }));
  const lead = mat(darker(color, 0.2));
  for (const x of [-w / 4, 0, w / 4]) k.box(x === 0 ? 0.03 : 0.012, upper - 0.06, 0.016, x, lower + upper / 2 - 0.01, uz - ud / 2 + 0.008, lead);
  for (let i = 1; i < 4; i++) k.box(w - 0.07, 0.012, 0.016, 0, lower + (upper / 4) * i, uz - ud / 2 + 0.008, lead);
  const things = ['#c4b79a', '#7c5d8a', '#d8d1c2', '#8f3f34', '#4f6d7a'];
  things.forEach((c, i) => k.box(0.05, 0.13 + (i % 2) * 0.05, 0.1, -w / 2 + 0.14 + i * 0.14, lower + (upper / 4) * (1 + (i % 3)) + 0.08 + (i % 2) * 0.025, uz, mat(c)));
};

function kitchenBase(k: Kit, w: number, d: number, color: THREE.Color): { units: number; unitWidth: number; front: number } {
  const body = mat(color, { roughness: 0.45 });
  k.box(w, 0.1, d - 0.1, 0, 0.05, 0.05, mat('#3b3b3b'));
  k.box(w, 0.76, d - 0.02, 0, 0.48, 0.01, body);
  k.box(w, 0.04, d + 0.01, 0, 0.88, -0.005, mat('#5d412e', { roughness: 0.4, map: 'wood', repeat: 2 }), 0.006);
  // Wall cabinets above, set back against the wall.
  k.box(w, 0.72, 0.34, 0, 1.84, d / 2 - 0.17, body, 0.004);
  const units = Math.max(1, Math.round(w / 0.6));
  const unitWidth = w / units;
  for (let i = 0; i < units; i++) {
    const x = -w / 2 + unitWidth * (i + 0.5);
    k.box(unitWidth - 0.008, 0.71, 0.018, x, 1.84, d / 2 - 0.34 - 0.009, body, 0.003);
    k.box(unitWidth * 0.5, 0.012, 0.02, x, 1.53, d / 2 - 0.34 - 0.03, STEEL());
  }
  return { units, unitWidth, front: -d / 2 + 0.009 };
}

function drawers(k: Kit, x: number, unitWidth: number, front: number, color: THREE.Color, rows: number): void {
  const face = mat(color, { roughness: 0.4 });
  const rh = 0.76 / rows;
  for (let r = 0; r < rows; r++) {
    const y = 0.1 + rh * (r + 0.5);
    k.box(unitWidth - 0.008, rh - 0.008, 0.018, x, y, front, face, 0.003);
    k.box(unitWidth * 0.55, 0.012, 0.02, x, y + rh * 0.28, front - 0.022, STEEL());
  }
}

const kitchenHob: Builder = (k, [w, , d], color) => {
  const { units, unitWidth, front } = kitchenBase(k, w, d, color);
  for (let i = 0; i < units; i++) drawers(k, -w / 2 + unitWidth * (i + 0.5), unitWidth, front, color, 3);
  const hx = w * 0.12;
  k.box(0.58, 0.012, 0.5, hx, 0.906, 0, BLACK());
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    k.cyl(0.05, 0.05, 0.02, hx + sx * 0.15, 0.92, sz * 0.12, mat('#2c2c2e', { roughness: 0.4, metalness: 0.6 }), 16);
  }
};

const kitchenSink: Builder = (k, [w, , d], color) => {
  const { units, unitWidth, front } = kitchenBase(k, w, d, color);
  for (let i = 0; i < units; i++) {
    const x = -w / 2 + unitWidth * (i + 0.5);
    if (i === 0) {
      // The washing machine at the window end.
      k.box(unitWidth - 0.02, 0.74, 0.02, x, 0.48, front, mat('#f4f4f2', { roughness: 0.35 }), 0.01);
      const door = k.cyl(0.19, 0.19, 0.03, x, 0.44, front - 0.015, mat('#c9ccd0', { roughness: 0.3, metalness: 0.7 }), 28);
      door.rotation.x = Math.PI / 2;
      const glass = k.cyl(0.14, 0.14, 0.032, x, 0.44, front - 0.018, mat('#20262c', { roughness: 0.1 }), 28);
      glass.rotation.x = Math.PI / 2;
    } else {
      drawers(k, x, unitWidth, front, color, i === units - 1 ? 1 : 2);
    }
  }
  const sx = w * 0.1;
  k.box(0.5, 0.014, 0.4, sx, 0.905, 0.02, mat('#2a2c2e', { roughness: 0.3, metalness: 0.7 }));
  k.cyl(0.014, 0.014, 0.3, sx + 0.2, 1.05, 0.2, STEEL(), 10);
  k.box(0.02, 0.02, 0.2, sx + 0.2, 1.2, 0.1, STEEL(), 0.008);
};

const kitchenTall: Builder = (k, [w, h, d], color) => {
  k.box(w, h, d - 0.02, 0, h / 2, 0.01, mat(color, { roughness: 0.45 }));
  const face = mat(color, { roughness: 0.4 });
  const split = [0.1, h * 0.38, h * 0.76, h];
  for (let i = 0; i < 3; i++) {
    const hgt = split[i + 1] - split[i];
    k.box(w - 0.008, hgt - 0.008, 0.018, 0, split[i] + hgt / 2, -d / 2 + 0.009, face, 0.003);
    k.box(0.012, Math.min(0.3, hgt * 0.5), 0.02, -w / 2 + 0.06, split[i] + hgt / 2, -d / 2 - 0.013, STEEL());
  }
  k.box(w, 0.1, d - 0.1, 0, 0.05, 0.05, mat('#3b3b3b'));
};

const kitchenOven: Builder = (k, [w, h, d], color) => {
  k.box(w, h, d - 0.02, 0, h / 2, 0.01, mat(color, { roughness: 0.5 }));
  const front = -d / 2 + 0.009;
  const glassDoor = (y: number, hgt: number): void => {
    k.box(w - 0.01, hgt, 0.018, 0, y, front, mat(lighter(color, 0.1), { roughness: 0.5 }), 0.003);
    k.box(w - 0.09, hgt - 0.09, 0.008, 0, y, front - 0.008, mat('#aebfc2', { roughness: 0.05, opacity: 0.35 }));
    k.box(0.014, hgt - 0.09, 0.012, 0, y, front - 0.01, mat(color));
    k.box(w - 0.09, 0.014, 0.012, 0, y, front - 0.01, mat(color));
  };
  glassDoor(h - 0.33, 0.6);
  k.box(w - 0.02, 0.5, 0.02, 0, 1.25, front, mat('#17181a', { roughness: 0.12, metalness: 0.5 }), 0.006);
  k.box(w - 0.02, 0.09, 0.022, 0, 1.55, front - 0.002, STEEL());
  k.box(w * 0.7, 0.014, 0.03, 0, 1.44, front - 0.03, STEEL());
  glassDoor(0.72, 0.5);
  k.box(w - 0.01, 0.36, 0.018, 0, 0.28, front, mat(lighter(color, 0.1), { roughness: 0.5 }), 0.003);
};

function wavyPanel(w: number, h: number, depth: number, material: THREE.Material): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(w, h, Math.max(8, Math.round(w * 40)), 1);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    position.setZ(i, Math.sin((position.getX(i) / w) * Math.PI * 2 * Math.max(2, w * 7)) * depth * 0.45);
  }
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

const curtain: Builder = (k, [w, h, d], color) => {
  const fabric = mat(color, { roughness: 1, map: 'fabric', repeat: 2 });
  fabric.side = THREE.DoubleSide;
  k.add(wavyPanel(w, h - 0.06, d, fabric), 0, (h - 0.06) / 2 + 0.02, 0);
};

const sheerCurtain: Builder = (k, [w, h, d], color) => {
  const fabric = mat(color, { roughness: 1, opacity: 0.4 });
  fabric.side = THREE.DoubleSide;
  k.add(wavyPanel(w, h - 0.06, d, fabric), 0, (h - 0.06) / 2 + 0.02, 0);
  k.box(w, 0.02, 0.02, 0, h - 0.02, 0, mat('#e6e6e6'));
};

const radiator: Builder = (k, [w, h, d], color) => {
  const paint = mat(color, { roughness: 0.4 });
  k.box(w, h - 0.12, d * 0.6, 0, 0.12 + (h - 0.12) / 2, d * 0.2, paint, 0.01);
  const ribs = Math.round(w / 0.07);
  for (let i = 0; i < ribs; i++) k.box(0.012, h - 0.18, 0.01, -w / 2 + (w / ribs) * (i + 0.5), 0.12 + (h - 0.12) / 2, -d * 0.1 - 0.005, mat(darker(color, 0.08)));
  for (const sx of [-1, 1]) k.box(0.03, 0.12, 0.03, sx * (w / 2 - 0.1), 0.06, d * 0.2, paint);
};

/** An L-shaped sofa in one piece: a long seat with a chaise at its left end. */
const sofaL: Builder = (k, [w, h, d], color) => {
  const fabric = mat(color, { roughness: 0.95, map: 'fabric', repeat: 3 });
  const cushion = mat(lighter(color, 0.2), { roughness: 0.95, map: 'fabric', repeat: 3 });
  const arm = 0.17;
  const back = 0.22;
  const seatDepth = Math.min(0.98, d); // the long part, front to back
  const chaise = Math.min(1.05, w * 0.4); // how wide the chaise end is
  const mainZ = d / 2 - seatDepth / 2;
  const armHeight = h * 0.82 - 0.06;
  k.box(w, 0.28, seatDepth, 0, 0.2, mainZ, fabric, 0.06);
  k.box(chaise, 0.28, d - 0.3, -w / 2 + chaise / 2, 0.2, -0.15, fabric, 0.06);
  k.box(w, h - 0.3, back, 0, 0.3 + (h - 0.3) / 2, d / 2 - back / 2, fabric, 0.09);
  for (const side of [-1, 1]) k.box(arm, armHeight, seatDepth, side * (w / 2 - arm / 2), 0.06 + armHeight / 2, mainZ, fabric, 0.07);
  const left = -w / 2 + arm;
  const right = w / 2 - arm;
  const split = -w / 2 + chaise;
  // One long cushion on the chaise, then seat cushions along the rest.
  k.box(split - left - 0.02, 0.17, d - back - 0.04, (left + split) / 2, 0.42, -back / 2, cushion, 0.07);
  const count = Math.max(1, Math.round((right - split) / 0.8));
  const cw = (right - split) / count;
  for (let i = 0; i < count; i++) {
    k.box(cw - 0.02, 0.17, seatDepth - back - 0.02, split + cw * (i + 0.5), 0.42, mainZ - back / 2 + 0.01, cushion, 0.07);
  }
  const pillows = Math.max(2, Math.round((right - left) / 0.8));
  const pw = (right - left) / pillows;
  for (let i = 0; i < pillows; i++) {
    const pillow = k.box(pw - 0.08, 0.36, 0.17, left + pw * (i + 0.5), 0.67, d / 2 - back - 0.09, cushion, 0.08);
    pillow.rotation.x = 0.22;
  }
  const feet: [number, number][] = [
    [w / 2 - 0.1, d / 2 - 0.1], [w / 2 - 0.1, d / 2 - seatDepth + 0.1], [-w / 2 + 0.1, d / 2 - 0.1],
    [-w / 2 + 0.1, -d / 2 + 0.1], [-w / 2 + chaise - 0.1, -d / 2 + 0.1],
  ];
  for (const [x, z] of feet) k.cyl(0.025, 0.02, 0.06, x, 0.03, z, BLACK(), 8);
};

// Wall-hung pieces: the back (+z) sits against the wall, y = 0 is the bottom edge.

const painting = (style: number, border: number): Builder => (k, [w, h, d], color) => {
  k.box(w, h, d, 0, h / 2, 0, mat(color, { roughness: 0.6 }), 0.004);
  const picture = new THREE.Mesh(
    new THREE.PlaneGeometry(w - 2 * border, h - 2 * border),
    new THREE.MeshStandardMaterial({ map: artTexture(style, (w - 2 * border) / (h - 2 * border)), roughness: 0.9 }),
  );
  picture.rotation.y = Math.PI; // a plane faces +z; the front of a piece is -z
  k.add(picture, 0, h / 2, -d / 2 - 0.002);
};

const wallMirror: Builder = (k, [w, h, d], color) => {
  const r = Math.min(w, h) / 2;
  const rim = k.cyl(r, r, d, 0, h / 2, 0, mat(color, { roughness: 0.35, metalness: 0.8 }), 48);
  rim.rotation.x = Math.PI / 2;
  const glass = k.cyl(r - 0.025, r - 0.025, 0.004, 0, h / 2, -d / 2 - 0.001, mat('#c3ced4', { roughness: 0.08, metalness: 0.35 }), 48);
  glass.rotation.x = Math.PI / 2;
};

const wallShelf: Builder = (k, [w, , d], color) => {
  const wood = mat(color, { roughness: 0.55, map: 'wood', repeat: 2 });
  k.box(w, 0.03, d, 0, 0.015, 0, wood, 0.004);
  for (const sx of [-1, 1]) k.box(0.02, 0.1, d - 0.04, sx * (w / 2 - 0.1), -0.05, 0.02, BLACK());
  const books = ['#b5533c', '#d8c9a3', '#3f5e7a', '#6d8f5b', '#2f2f33'];
  books.forEach((c, i) => k.box(0.03, 0.15 + (i % 2) * 0.03, d * 0.7, -w / 2 + 0.08 + i * 0.036, 0.03 + (0.15 + (i % 2) * 0.03) / 2, 0, mat(c)));
  plant(k, w / 2 - 0.14, 0.03, 0, 0.55);
  k.cyl(0.035, 0.05, 0.14, 0.02, 0.1, 0, mat('#e8dcc0', { roughness: 0.35 }));
};

const floorPlant: Builder = (k, [w, h, d], color) => {
  const r = Math.min(w, d) / 2;
  k.cyl(r * 0.55, r * 0.42, h * 0.25, 0, h * 0.125, 0, mat(color, { roughness: 0.6 }));
  k.cyl(r * 0.5, r * 0.5, 0.02, 0, h * 0.25 - 0.012, 0, mat('#3b2a1e', { roughness: 1 }));
  k.cyl(0.018, 0.025, h * 0.5, 0, h * 0.5, 0, mat('#5a4530'), 8);
  const random = (i: number): number => Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
  const greens = [mat('#3f7d46', { roughness: 0.7 }), mat('#2f6238', { roughness: 0.7 }), mat('#5b9456', { roughness: 0.7 })];
  for (let i = 0; i < 22; i++) {
    const angle = i * 2.4;
    const up = 0.4 + random(i) * 0.55;
    const reach = r * (0.25 + random(i + 7) * 0.7) * (1.1 - Math.abs(up - 0.7));
    const leaf = k.ball(r * 0.42, Math.cos(angle) * reach, h * up, Math.sin(angle) * reach, greens[i % 3]);
    leaf.scale.set(1.25, 0.28, 0.7);
    leaf.rotation.set(random(i + 3) - 0.5, -angle, 0.55);
  }
};

const floorLamp: Builder = (k, [w, h, d], color) => {
  const r = Math.min(w, d) / 2;
  const metal = mat(color, { roughness: 0.4, metalness: 0.7 });
  k.cyl(r * 0.7, r * 0.75, 0.025, 0, 0.0125, 0, metal, 32);
  k.cyl(0.012, 0.012, h - 0.3, 0, (h - 0.3) / 2, 0, metal, 10);
  const shade = mat('#f1e3c6', { roughness: 0.9, emissive: '#8a6a3a' });
  shade.side = THREE.DoubleSide;
  k.add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.75, r, 0.3, 32, 1, true), shade), 0, h - 0.15, 0);
  k.ball(0.04, 0, h - 0.17, 0, mat('#fff4d6', { emissive: '#ffe2a8' }));
};

const sideTable: Builder = (k, [w, h, d], color) => {
  const wood = mat(color, { roughness: 0.45, map: 'wood', repeat: 1 });
  const r = Math.min(w, d) / 2;
  k.cyl(r, r - 0.01, 0.03, 0, h - 0.015, 0, wood, 40);
  for (let i = 0; i < 3; i++) {
    const angle = (i * Math.PI * 2) / 3 + 0.5;
    const leg = k.cyl(0.016, 0.012, h - 0.03, Math.cos(angle) * r * 0.62, (h - 0.03) / 2, Math.sin(angle) * r * 0.62, wood, 8);
    leg.rotation.set(Math.sin(angle) * 0.12, 0, -Math.cos(angle) * 0.12);
  }
};

const bookcase: Builder = (k, [w, h, d], color) => {
  const body = mat(color, { roughness: 0.6 });
  k.box(w, h, 0.015, 0, h / 2, d / 2 - 0.0075, mat(darker(color, 0.08), { roughness: 0.7 }));
  for (const sx of [-1, 1]) k.box(0.025, h, d, sx * (w / 2 - 0.0125), h / 2, 0, body);
  const levels = Math.max(3, Math.round(h / 0.36));
  const step = (h - 0.08) / levels;
  const random = seededRandom(5);
  const spines = ['#b5533c', '#d8c9a3', '#3f5e7a', '#6d8f5b', '#2f2f33', '#c79a3b', '#7c5d8a', '#e9e4da'];
  for (let i = 0; i <= levels; i++) k.box(w - 0.05, 0.022, d - 0.01, 0, 0.06 + step * i + (i === levels ? -0.011 : 0.011), 0, body);
  k.box(w - 0.05, 0.06, d - 0.04, 0, 0.03, 0.02, body);
  for (let i = 0; i < levels; i++) {
    const y = 0.06 + step * i + 0.022;
    let x = -w / 2 + 0.05;
    const until = w / 2 - 0.05 - (i % 2 === 0 ? w * 0.25 : 0.02);
    while (x < until) {
      const bw = 0.022 + random() * 0.03;
      const bh = step * (0.55 + random() * 0.3);
      k.box(bw, bh, d * 0.7, x + bw / 2, y + bh / 2, 0.02, mat(spines[Math.floor(random() * spines.length)], { roughness: 0.8 }));
      x += bw + 0.002;
    }
    if (i % 2 === 0) k.cyl(0.045, 0.06, 0.16, w / 2 - 0.14, y + 0.08, 0, mat('#e8dcc0', { roughness: 0.35 }));
  }
};

const bed: Builder = (k, [w, h, d], color) => {
  const wood = mat('#b9a68c', { roughness: 0.55, map: 'wood', repeat: 2 });
  k.box(w, 0.2, d, 0, 0.2, 0, wood, 0.02);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.06, 0.1, 0.06, sx * (w / 2 - 0.06), 0.05, sz * (d / 2 - 0.06), wood);
  k.box(w, h, 0.06, 0, h / 2, d / 2 - 0.03, wood, 0.02);
  k.box(w - 0.06, 0.2, d - 0.1, 0, 0.4, -0.02, mat('#f4f1ea', { roughness: 0.95, map: 'fabric', repeat: 3 }), 0.06);
  k.box(w - 0.02, 0.1, d * 0.68, 0, 0.5, -d * 0.16 + 0.0, mat(color, { roughness: 1, map: 'fabric', repeat: 4 }), 0.045);
  for (const sx of [-1, 1]) {
    const pillow = k.box(w / 2 - 0.12, 0.13, 0.42, sx * (w / 4 - 0.01), 0.57, d / 2 - 0.32, mat('#fbfaf6', { roughness: 0.95, map: 'fabric', repeat: 2 }), 0.06);
    pillow.rotation.x = -0.15;
  }
};

const desk: Builder = (k, [w, h, d], color) => {
  const wood = mat(color, { roughness: 0.5, map: 'wood', repeat: 2 });
  k.box(w, 0.035, d, 0, h - 0.0175, 0, wood, 0.008);
  for (const sz of [-1, 1]) k.box(0.04, h - 0.035, 0.04, -w / 2 + 0.05, (h - 0.035) / 2, sz * (d / 2 - 0.05), BLACK());
  k.box(0.38, h - 0.13, d - 0.06, w / 2 - 0.21, 0.08 + (h - 0.13) / 2, 0, wood, 0.006);
  for (let i = 0; i < 3; i++) {
    const y = 0.1 + ((h - 0.17) / 3) * (i + 0.5);
    k.box(0.35, (h - 0.17) / 3 - 0.012, 0.012, w / 2 - 0.21, y, -d / 2 + 0.026, mat(lighter(color, 0.1), { roughness: 0.5, map: 'wood', repeat: 1 }));
    k.box(0.1, 0.012, 0.014, w / 2 - 0.21, y, -d / 2 + 0.014, BLACK());
  }
};

const wardrobe: Builder = (k, [w, h, d], color) => {
  const body = mat(color, { roughness: 0.5 });
  k.box(w, h - 0.06, d - 0.02, 0, 0.06 + (h - 0.06) / 2, 0.01, body);
  k.box(w - 0.04, 0.06, d - 0.08, 0, 0.03, 0.03, mat(darker(color, 0.3)));
  const doors = Math.max(2, Math.round(w / 0.5));
  const dw = w / doors;
  for (let i = 0; i < doors; i++) {
    const x = -w / 2 + dw * (i + 0.5);
    k.box(dw - 0.008, h - 0.075, 0.018, x, 0.065 + (h - 0.075) / 2, -d / 2 + 0.009, body, 0.003);
    k.box(0.012, 0.22, 0.02, x + (i % 2 === 0 ? 1 : -1) * (dw / 2 - 0.05), h * 0.48, -d / 2 - 0.012, STEEL());
  }
};

/** A repeatable random number generator, so a model looks the same every time. */
function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const builders: Record<string, Builder> = {
  sofa,
  'sofa-l': sofaL,
  armchair: sofa,
  'painting-1': painting(1, 0.03),
  'painting-2': painting(2, 0.03),
  'painting-3': painting(3, 0.025),
  'painting-4': painting(4, 0.02),
  'wall-mirror': wallMirror,
  'wall-shelf': wallShelf,
  'floor-plant': floorPlant,
  'floor-lamp': floorLamp,
  'side-table': sideTable,
  bookcase,
  bed,
  desk,
  wardrobe,
  ottoman,
  rug,
  'coffee-table': coffeeTable,
  'tv-unit': tvUnit,
  'plant-shelf': plantShelf,
  'bar-trolley': barTrolley,
  sideboard,
  'wicker-drawers': wickerDrawers,
  'standing-mirror': standingMirror,
  chest,
  'round-table': roundTable,
  'dining-chair': diningChair,
  bureau,
  'kitchen-counter-hob': kitchenHob,
  'kitchen-counter-sink': kitchenSink,
  'kitchen-tall': kitchenTall,
  'kitchen-oven-tall': kitchenOven,
  curtain,
  'sheer-curtain': sheerCurtain,
  radiator,
};

/** Builds the model for `name`, or returns null if there is no builder for it. */
export function buildModel(name: string, size: Size, color: string): THREE.Group | null {
  const builder = builders[name];
  if (!builder) return null;
  const kit = new Kit();
  builder(kit, size, new THREE.Color(color));
  return kit.group;
}
