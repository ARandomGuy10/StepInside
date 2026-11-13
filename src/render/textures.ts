import * as THREE from 'three';

/**
 * Small textures drawn in code, so the repo needs no image files.
 *
 * Each one is drawn in near-white shades and then multiplied by the
 * material's colour on the GPU. That keeps colour and pattern separate:
 * painting a floor changes its colour and keeps the planks.
 */

/** A repeatable random number generator, so textures look the same on every load. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  draw(canvas.getContext('2d')!, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8; // keeps the pattern sharp at shallow angles
  return texture;
}

const grey = (v: number): string => {
  const c = Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${c},${c},${c})`;
};

/** Floor planks running along the texture's horizontal axis. */
function drawPlanks(ctx: CanvasRenderingContext2D, size: number, rows: number, seed: number): void {
  const random = seeded(seed);
  const rowHeight = size / rows;
  for (let row = 0; row < rows; row++) {
    const y = row * rowHeight;
    // Each row is cut into planks of uneven length, staggered row to row.
    let x = -random() * size * 0.5;
    while (x < size) {
      const length = size * (0.45 + random() * 0.35);
      const shade = 222 + random() * 30;
      ctx.fillStyle = grey(shade);
      ctx.fillRect(x, y, length, rowHeight);
      // Grain: faint streaks along the plank.
      for (let i = 0; i < 26; i++) {
        const gy = y + random() * rowHeight;
        ctx.strokeStyle = `rgba(90,60,30,${0.03 + random() * 0.07})`;
        ctx.lineWidth = 0.6 + random() * 1.4;
        ctx.beginPath();
        ctx.moveTo(x, gy);
        ctx.bezierCurveTo(
          x + length * 0.3, gy + (random() - 0.5) * 6,
          x + length * 0.6, gy + (random() - 0.5) * 6,
          x + length, gy + (random() - 0.5) * 3,
        );
        ctx.stroke();
      }
      // The joint at the end of the plank.
      ctx.fillStyle = 'rgba(40,25,10,0.35)';
      ctx.fillRect(x + length - 1, y, 2, rowHeight);
      x += length;
    }
    // The seam between rows.
    ctx.fillStyle = 'rgba(40,25,10,0.3)';
    ctx.fillRect(0, y, size, 1.5);
  }
}

function drawTiles(ctx: CanvasRenderingContext2D, size: number, count: number): void {
  const random = seeded(7);
  const tile = size / count;
  ctx.fillStyle = grey(176);
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < count; j++) {
      ctx.fillStyle = grey(236 + random() * 16);
      ctx.fillRect(i * tile + 2, j * tile + 2, tile - 4, tile - 4);
    }
  }
}

/**
 * Stones laid in courses, like cladding or small paving setts: `rows`
 * courses across the canvas, each stone between `length[0]` and
 * `length[1]` of the canvas long, with grout lines `gap` pixels wide.
 */
function drawCourses(ctx: CanvasRenderingContext2D, size: number, rows: number, length: [number, number], gap: number, seed: number): void {
  const random = seeded(seed);
  const row = size / rows;
  ctx.fillStyle = grey(150);
  ctx.fillRect(0, 0, size, size);
  for (let r = 0; r < rows; r++) {
    // Each course starts at a random point and wraps round, so the pattern tiles.
    let x = -random() * size * length[1];
    const start = x;
    while (x < size + start) {
      const w = size * (length[0] + random() * (length[1] - length[0]));
      const shade = 222 + random() * 30;
      for (const dx of [0, size]) {
        ctx.fillStyle = grey(shade);
        ctx.fillRect(x + dx + gap / 2, r * row + gap / 2, w - gap, row - gap);
        // A faint grain across each stone.
        ctx.fillStyle = `rgba(0,0,0,${0.03 + random() * 0.04})`;
        ctx.fillRect(x + dx + gap / 2, r * row + row * (0.3 + random() * 0.4), w - gap, 1 + random() * 2);
      }
      x += w;
    }
  }
}

/**
 * Short grass blades in many shades, for a lawn, with the faint light and
 * dark stripes a mower leaves (two stripes across the texture).
 */
function drawLawn(ctx: CanvasRenderingContext2D, size: number): void {
  const random = seeded(31);
  ctx.fillStyle = grey(232);
  ctx.fillRect(0, 0, size / 2, size);
  ctx.fillStyle = grey(212);
  ctx.fillRect(size / 2, 0, size / 2, size);
  for (let i = 0; i < 16000; i++) {
    const x = random() * size;
    const y = random() * size;
    const g = Math.round((x < size / 2 ? 200 : 180) + random() * 55);
    ctx.strokeStyle = `rgb(${g},${g},${g})`;
    ctx.lineWidth = 1 + random();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (random() - 0.5) * 4, y - 3 - random() * 5);
    ctx.stroke();
  }
}

/** White and pale grey pebbles, packed tight, for a gravel bed. */
function drawPebbles(ctx: CanvasRenderingContext2D, size: number): void {
  const random = seeded(41);
  ctx.fillStyle = grey(120);
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2600; i++) {
    const x = random() * size;
    const y = random() * size;
    const r = 3 + random() * 6;
    const shade = 205 + random() * 50;
    const flat = 0.6 + random() * 0.35;
    const turn = random() * Math.PI;
    for (const [dx, dy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
      ctx.fillStyle = grey(shade);
      ctx.beginPath();
      ctx.ellipse(x + dx, y + dy, r, r * flat, turn, 0, Math.PI * 2);
      ctx.fill();
      // A highlight on the top left of each pebble.
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.ellipse(x + dx - r * 0.25, y + dy - r * 0.25, r * 0.4, r * 0.25, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Small overlapping leaves, for clipped hedges, box balls and tree crowns. */
function drawLeaves(ctx: CanvasRenderingContext2D, size: number): void {
  const random = seeded(53);
  ctx.fillStyle = grey(110);
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 7000; i++) {
    const x = random() * size;
    const y = random() * size;
    const r = 2.5 + random() * 3.5;
    ctx.fillStyle = grey(150 + random() * 105);
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.5, random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Fine speckle, for fabric and woven rugs. */
function drawWeave(ctx: CanvasRenderingContext2D, size: number, contrast: number): void {
  const random = seeded(11);
  const cell = 4;
  for (let x = 0; x < size; x += cell) {
    for (let y = 0; y < size; y += cell) {
      const stripe = ((x / cell) % 2 === 0 ? 4 : -4) + ((y / cell) % 2 === 0 ? 3 : -3);
      ctx.fillStyle = grey(236 + stripe + (random() - 0.5) * contrast);
      ctx.fillRect(x, y, cell, cell);
    }
  }
}

const cache = new Map<string, THREE.Texture>();

function cached(key: string, make: () => THREE.Texture): THREE.Texture {
  let texture = cache.get(key);
  if (!texture) {
    texture = make();
    cache.set(key, texture);
  }
  return texture;
}

export type Pattern = 'planks' | 'wood' | 'tiles' | 'fabric' | 'weave' | 'stone' | 'setts' | 'lawn' | 'pebbles' | 'leaves';

/**
 * Returns a texture for a pattern. `repeat` is how many times it tiles
 * across one unit of the surface's UV coordinates.
 */
export function pattern(kind: Pattern, repeatU = 1, repeatV = repeatU): THREE.Texture {
  const base = cached(kind, () => {
    switch (kind) {
      case 'planks':
        return canvasTexture(1024, (ctx, size) => drawPlanks(ctx, size, 8, 3));
      case 'wood':
        return canvasTexture(512, (ctx, size) => drawPlanks(ctx, size, 5, 21));
      case 'tiles':
        return canvasTexture(512, (ctx, size) => drawTiles(ctx, size, 4));
      case 'fabric':
        return canvasTexture(256, (ctx, size) => drawWeave(ctx, size, 14));
      case 'weave':
        return canvasTexture(256, (ctx, size) => drawWeave(ctx, size, 44));
      case 'stone':
        return canvasTexture(1024, (ctx, size) => drawCourses(ctx, size, 8, [0.25, 0.5], 3, 17));
      case 'setts':
        return canvasTexture(1024, (ctx, size) => drawCourses(ctx, size, 16, [0.09, 0.16], 5, 23));
      case 'lawn':
        return canvasTexture(512, (ctx, size) => drawLawn(ctx, size));
      case 'pebbles':
        return canvasTexture(512, (ctx, size) => drawPebbles(ctx, size));
      case 'leaves':
        return canvasTexture(512, (ctx, size) => drawLeaves(ctx, size));
    }
  });
  const texture = base.clone();
  texture.repeat.set(repeatU, repeatV);
  texture.needsUpdate = true;
  return texture;
}

/** The pattern and scale for a floor's `material` label in the scene file. */
export function floorTexture(material: string | undefined): THREE.Texture | null {
  // Floor UVs are in metres. A repeat of 1/1.6 makes the texture span 1.6 m.
  switch (material) {
    case 'laminate':
      return pattern('planks', 1 / 1.6);
    case 'decking':
      return pattern('planks', 1 / 1.2);
    case 'tile':
      return pattern('tiles', 1 / 1.2);
    case 'lawn':
      return pattern('lawn', 1 / 1.5);
    case 'setts':
      // The setts pattern spans 1.6 m: courses 10 cm deep.
      return pattern('setts', 1 / 1.6);
    case 'large-tile':
      // Four tiles across the pattern, so each tile is 80 cm.
      return pattern('tiles', 1 / 3.2);
    default:
      return null;
  }
}

/** A soft sky: pale at the horizon, bluer overhead. */
export function skyTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, '#8fbbe6');
  gradient.addColorStop(0.55, '#d6e6f4');
  gradient.addColorStop(1, '#f3efe6');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 4, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * A picture for a painting, drawn in code. `style` picks one of four
 * looks; the canvas has the painting's proportions so nothing stretches.
 */
export function artTexture(style: number, aspect: number): THREE.Texture {
  return cached(`art:${style}:${aspect.toFixed(2)}`, () => {
    const canvas = document.createElement('canvas');
    const h = 512;
    const w = Math.max(64, Math.round(h * aspect));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const random = seeded(100 + style);
    if (style === 1) {
      // A soft landscape: sky, a low sun and layered hills.
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#e9c9a8');
      sky.addColorStop(0.6, '#f3e3cf');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#d9773f';
      ctx.beginPath();
      ctx.arc(w * 0.68, h * 0.4, h * 0.13, 0, Math.PI * 2);
      ctx.fill();
      const hills = ['#b9a48a', '#8c9a84', '#5f7566', '#39503f'];
      hills.forEach((color, i) => {
        const base = h * (0.52 + i * 0.11);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, h);
        ctx.lineTo(0, base);
        for (let x = 0; x <= w; x += w / 6) {
          ctx.quadraticCurveTo(x + w / 12, base - (random() - 0.3) * h * 0.16, x + w / 6, base + (random() - 0.5) * h * 0.05);
        }
        ctx.lineTo(w, h);
        ctx.fill();
      });
    } else if (style === 2) {
      // Botanical: a branch with leaves on a warm paper background.
      ctx.fillStyle = '#efe6d4';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#4c5b3c';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(w * 0.5, h * 0.95);
      ctx.bezierCurveTo(w * 0.42, h * 0.6, w * 0.6, h * 0.4, w * 0.5, h * 0.08);
      ctx.stroke();
      for (let i = 0; i < 9; i++) {
        const t = 0.14 + i * 0.085;
        const side = i % 2 === 0 ? 1 : -1;
        ctx.save();
        ctx.translate(w * (0.5 + Math.sin(t * 6) * 0.03), h * (0.95 - t * 0.9));
        ctx.rotate(side * (0.9 + random() * 0.3));
        ctx.fillStyle = i % 3 === 0 ? '#7f9467' : '#566b45';
        ctx.beginPath();
        ctx.ellipse(0, -h * 0.07, h * 0.03, h * 0.08, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    } else if (style === 3) {
      // Geometric: a few flat blocks and an arc.
      ctx.fillStyle = '#f1ece2';
      ctx.fillRect(0, 0, w, h);
      const blocks: [string, number, number, number, number][] = [
        ['#c8553d', 0.08, 0.1, 0.42, 0.5],
        ['#28536b', 0.42, 0.34, 0.5, 0.56],
        ['#e3b23c', 0.14, 0.66, 0.3, 0.24],
      ];
      for (const [color, x, y, bw, bh] of blocks) {
        ctx.fillStyle = color;
        ctx.fillRect(w * x, h * y, w * bw, h * bh);
      }
      ctx.fillStyle = '#22201d';
      ctx.beginPath();
      ctx.arc(w * 0.72, h * 0.3, h * 0.16, Math.PI, 0);
      ctx.fill();
    } else {
      // A line drawing with a wide white border, like a framed print.
      ctx.fillStyle = '#fbfaf7';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#1f1f1f';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(w * 0.3, h * 0.72);
      ctx.bezierCurveTo(w * 0.1, h * 0.4, w * 0.5, h * 0.2, w * 0.55, h * 0.42);
      ctx.bezierCurveTo(w * 0.6, h * 0.62, w * 0.35, h * 0.55, w * 0.5, h * 0.36);
      ctx.bezierCurveTo(w * 0.62, h * 0.2, w * 0.8, h * 0.4, w * 0.7, h * 0.74);
      ctx.stroke();
      ctx.fillStyle = '#d98c5f';
      ctx.beginPath();
      ctx.arc(w * 0.66, h * 0.3, h * 0.045, 0, Math.PI * 2);
      ctx.fill();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  });
}
