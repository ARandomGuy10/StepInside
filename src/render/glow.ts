import * as THREE from 'three';

/**
 * Outdoor lights glow, and wash light over walls and paths, more strongly
 * as it gets dark. Real lights would cost a lot to draw, so a lamp is a
 * glowing part plus soft see-through shapes added on top of what is behind
 * them. The sun panel turns the glow up at dusk.
 */
const washes = new Set<THREE.Material>();
const bulbs = new Set<THREE.MeshStandardMaterial>();
let night = 0;

function texture(draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number): THREE.Texture {
  if (typeof document === 'undefined') return new THREE.Texture();
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!, w, h);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

let pool: THREE.Texture | null = null;
let beam: THREE.Texture | null = null;

/** A round pool of light, brightest in the middle. */
function poolTexture(): THREE.Texture {
  pool ??= texture((g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }, 128, 128);
  return pool;
}

/** A beam fanning out from the bottom edge and fading towards the top. */
function beamTexture(): THREE.Texture {
  beam ??= texture((g, w, h) => {
    const grad = g.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(w * 0.42, h);
    g.lineTo(w * 0.58, h);
    g.lineTo(w, 0);
    g.lineTo(0, 0);
    g.closePath();
    g.fill();
    // Soften the sides.
    g.globalCompositeOperation = 'destination-in';
    const side = g.createLinearGradient(0, 0, w, 0);
    side.addColorStop(0, 'rgba(0,0,0,0)');
    side.addColorStop(0.3, 'rgba(0,0,0,1)');
    side.addColorStop(0.7, 'rgba(0,0,0,1)');
    side.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = side;
    g.fillRect(0, 0, w, h);
  }, 64, 256);
  return beam;
}

function wash(map: THREE.Texture, color: THREE.ColorRepresentation): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    map, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  });
  material.userData.strength = 0.9;
  material.opacity = strength();
  washes.add(material);
  return material;
}

const strength = (): number => 0.06 + 0.94 * night;

/** A soft round pool of light, as a flat disc of radius `r` facing up (+y). */
export function lightPool(r: number, color: THREE.ColorRepresentation = '#ffcf8a'): THREE.Mesh {
  const disc = new THREE.Mesh(new THREE.PlaneGeometry(2 * r, 2 * r), wash(poolTexture(), color));
  disc.rotation.x = -Math.PI / 2;
  disc.name = 'glow';
  return disc;
}

/** A beam of light `length` long, `width` wide at its far end, starting at the origin and running along +y. */
export function lightBeam(length: number, width: number, color: THREE.ColorRepresentation = '#ffcf8a'): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(width, length);
  geometry.translate(0, length / 2, 0);
  const plane = new THREE.Mesh(geometry, wash(beamTexture(), color));
  plane.name = 'glow';
  return plane;
}

/** The lit part of a lamp: warm, and brighter at night. */
export function bulb(color: THREE.ColorRepresentation = '#fff1d6'): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color('#ffd9a0'), roughness: 0.4 });
  material.emissiveIntensity = 0.6 + 1.6 * night;
  bulbs.add(material);
  return material;
}

/** 0 in daylight, 1 at night. Called by the sun panel. */
export function setNight(value: number): void {
  night = THREE.MathUtils.clamp(value, 0, 1);
  for (const m of washes) m.opacity = strength();
  for (const m of bulbs) m.emissiveIntensity = 0.6 + 1.6 * night;
}
