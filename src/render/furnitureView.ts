import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { Furniture } from '../core/scene';
import { buildModel } from './models';

const DEFAULT_COLOR = '#8a8f98';

/**
 * How each downloaded model sits in our size box. `turn` (degrees) turns
 * the model so its front faces the way ours do; `stretch` lets a model be
 * pulled to a different shape (fine for tables, wrong for chairs and plants,
 * which are scaled evenly so they keep their real proportions).
 */
const MODEL_FIT: Record<string, { turn?: number; stretch?: number }> = {
  armchair: { turn: 180 },
  'coffee-table': { stretch: 0.3 },
  'side-table': { stretch: 0.15 },
  'dining-chair': { turn: 180 },
  'round-table': {},
  'floor-plant': {},
  'table-plant': {},
  vase: {},
};

interface Item {
  data: Furniture;
  object: THREE.Group;
}

/**
 * Keeps the 3D furniture in step with the scene's furniture list.
 * Scene edits produce new Furniture objects, so comparing references
 * tells us cheaply which pieces changed.
 */
export class FurnitureView {
  readonly group = new THREE.Group();
  private readonly items = new Map<string, Item>();
  private readonly models = new Map<string, Promise<THREE.Object3D | null>>();
  private readonly loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

  constructor() {
    this.group.name = 'furniture';
  }

  sync(list: readonly Furniture[]): void {
    const present = new Set<string>();
    for (const f of list) {
      if (f.removed) continue;
      present.add(f.id);
      let item = this.items.get(f.id);
      if (item && item.data === f) continue;
      if (!item || needsRebuild(item.data, f)) {
        if (item) this.group.remove(item.object);
        item = { data: f, object: this.build(f) };
        this.items.set(f.id, item);
        this.group.add(item.object);
      }
      item.data = f;
      // Wall-hung pieces sit at their height above the floor.
      item.object.position.set(f.position[0], f.elevation ?? 0, f.position[1]);
      // Three.js turns anticlockwise seen from above; the scene file turns clockwise.
      item.object.rotation.y = -THREE.MathUtils.degToRad(f.rotationDeg);
    }
    for (const [id, item] of this.items) {
      if (present.has(id)) continue;
      this.group.remove(item.object);
      this.items.delete(id);
    }
  }

  objectFor(id: string): THREE.Object3D | undefined {
    return this.items.get(id)?.object;
  }

  /** The id of the furniture piece that `object` belongs to, if any. */
  static idOf(object: THREE.Object3D | null): string | undefined {
    for (let o = object; o; o = o.parent) {
      if (typeof o.userData.furnitureId === 'string') return o.userData.furnitureId;
    }
    return undefined;
  }

  private build(f: Furniture): THREE.Group {
    const root = new THREE.Group();
    root.name = `furniture:${f.id}`;
    root.userData.furnitureId = f.id;

    // In order of preference: a glTF file, a model built in code, a plain box.
    const [w, h, d] = f.size;
    let stand: THREE.Object3D | null = buildModel(f.model, f.size, f.color ?? DEFAULT_COLOR);
    if (!stand) {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({ color: f.color ?? DEFAULT_COLOR, roughness: 0.85 }),
      );
      box.position.y = h / 2;
      stand = box;
    }
    castShadows(stand);
    root.add(stand);
    const placeholder = stand;

    void this.loadModel(f.model).then((model) => {
      if (!model || this.items.get(f.id)?.object !== root) return;
      const copy = new THREE.Group();
      const inner = model.clone(true);
      const fit = MODEL_FIT[f.model] ?? { stretch: 1 };
      inner.rotation.y = THREE.MathUtils.degToRad(fit.turn ?? 0);
      copy.add(inner);
      fitToSize(copy, f.size, fit.stretch ?? 0);
      castShadows(copy);
      const paint = f.color;
      if (paint) {
        const tint = paintTint(paint);
        copy.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return;
          const material = (child.material as THREE.MeshStandardMaterial).clone();
          // A photographed texture already has its colour, so paint only
          // shifts its hue. A plain material takes the paint as it is.
          material.color.copy(material.map ? tint : new THREE.Color(paint));
          child.material = material;
        });
      }
      root.remove(placeholder);
      root.add(copy);
    });
    return root;
  }

  /** Loads /models/<name>.glb once. Resolves to null when there is no such file. */
  private loadModel(name: string): Promise<THREE.Object3D | null> {
    let pending = this.models.get(name);
    if (!pending) {
      pending = (async () => {
        try {
          const response = await fetch(`${import.meta.env.BASE_URL}models/${name}.glb`);
          if (!response.ok) return null;
          const bytes = await response.arrayBuffer();
          // A binary glTF file starts with the letters "glTF". The dev server
          // answers unknown paths with the HTML page, which this filters out.
          if (new TextDecoder().decode(bytes.slice(0, 4)) !== 'glTF') return null;
          return (await this.loader.parseAsync(bytes, '')).scene;
        } catch {
          return null;
        }
      })();
      this.models.set(name, pending);
    }
    return pending;
  }
}

function castShadows(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const material = child.material as THREE.Material;
    // See-through parts such as glass and sheer curtains let the light past.
    child.castShadow = !material.transparent;
    child.receiveShadow = true;
  });
}

function needsRebuild(a: Furniture, b: Furniture): boolean {
  return a.model !== b.model || a.color !== b.color || a.size.some((v, i) => v !== b.size[i]);
}

/**
 * Turns a paint colour into a tint for a textured material: the paint's hue
 * at full brightness, mixed half way with white, so the texture's own light
 * and shade still show through.
 */
function paintTint(color: string): THREE.Color {
  const c = new THREE.Color(color);
  const top = Math.max(c.r, c.g, c.b) || 1;
  return new THREE.Color(c.r / top, c.g / top, c.b / top).lerp(new THREE.Color(1, 1, 1), 0.5);
}

/**
 * Scales a model into `size` and stands it on the floor, centred. The model
 * is scaled evenly to fit inside the box; `stretch` (0 to 1) then lets each
 * side grow by up to that fraction towards the box, for pieces that can
 * change shape without looking wrong.
 */
function fitToSize(model: THREE.Object3D, size: readonly [number, number, number], stretch: number): void {
  const box = new THREE.Box3().setFromObject(model);
  const extent = box.getSize(new THREE.Vector3());
  const ratios = [size[0] / (extent.x || 1), size[1] / (extent.y || 1), size[2] / (extent.z || 1)];
  const even = Math.min(...ratios);
  const [sx, sy, sz] = ratios.map((r) => Math.min(r, even * (1 + stretch)));
  model.scale.set(sx, sy, sz);
  const scaled = new THREE.Box3().setFromObject(model);
  const center = scaled.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= scaled.min.y;
}
