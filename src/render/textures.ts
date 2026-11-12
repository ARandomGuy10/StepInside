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

export type Pattern = 'planks' | 'wood' | 'tiles' | 'fabric' | 'weave';

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
