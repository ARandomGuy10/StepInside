import * as THREE from 'three';
import type { Furniture } from '../core/scene';
import { FurnitureView } from '../render/furnitureView';

const PX = 160;

/** What a picture needs to know about a piece. */
export type Pictured = Pick<Furniture, 'model' | 'size'> & { color?: string | null; mount?: 'floor' | 'wall' };

/**
 * Small pictures of pieces, drawn with a little renderer of their own and
 * handed back as image URLs. A piece is built exactly as the home builds it,
 * downloaded model and all, so the picture matches what lands in the room.
 * `show` is called with a first picture straight away and again if a better
 * model arrives a moment later.
 */
export class Thumbnails {
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly stage = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(28, 1, 0.01, 100);
  private readonly done = new Map<string, string>();

  constructor() {
    this.stage.add(new THREE.HemisphereLight('#ffffff', '#b9b3a8', 2.2));
    const sun = new THREE.DirectionalLight('#ffffff', 2.4);
    sun.position.set(-2, 4, -3);
    this.stage.add(sun);
  }

  /** A catalogue picture: seen from the front, a little to one side and above. */
  of(key: string, piece: Pictured, show: (url: string) => void): void {
    const known = this.done.get(key);
    if (known) return show(known);
    this.draw(piece, (group) => {
      // Our pieces face up the plan, which is -z here, so the camera stands at -z.
      const onWall = piece.mount === 'wall';
      const flat = piece.size[1] < 0.05; // a rug is better seen from above
      const sphere = new THREE.Box3().setFromObject(group).getBoundingSphere(new THREE.Sphere());
      const look = onWall ? new THREE.Vector3(0.35, 0.12, -1) : flat ? new THREE.Vector3(0.3, 1.6, -0.8) : new THREE.Vector3(0.75, 0.55, -1);
      const distance = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.02;
      this.camera.position.copy(sphere.center).addScaledVector(look.normalize(), distance);
      this.camera.lookAt(sphere.center);
      return { camera: this.camera, width: PX, height: PX };
    }, (url) => {
      this.done.set(key, url);
      show(url);
    });
  }

  /**
   * A flat drawing of a piece seen straight from the front or the side,
   * framed to its size box at `px` pixels per metre.
   */
  elevation(piece: Pictured, view: 'front' | 'side', px: number, show: (url: string) => void): void {
    const [w, h, d] = piece.size;
    const across = view === 'front' ? w : d;
    this.draw(piece, () => {
      const flat = new THREE.OrthographicCamera(-across / 2, across / 2, h, 0, 0.01, 100);
      if (view === 'front') flat.position.set(0, 0, -20);
      else flat.position.set(20, 0, 0);
      flat.lookAt(0, 0, 0);
      flat.updateProjectionMatrix();
      return { camera: flat, width: Math.max(2, Math.round(across * px)), height: Math.max(2, Math.round(h * px)) };
    }, show);
  }

  private draw(
    piece: Pictured,
    frame: (group: THREE.Group) => { camera: THREE.Camera; width: number; height: number },
    show: (url: string) => void,
  ): void {
    const renderer = this.ready();
    if (!renderer) return;
    const view = new FurnitureView();
    const render = (): void => {
      const { camera, width, height } = frame(view.group);
      renderer.setSize(width, height, false);
      this.stage.add(view.group);
      renderer.render(this.stage, camera);
      this.stage.remove(view.group);
      show(renderer.domElement.toDataURL('image/png'));
    };
    view.onModel = render;
    view.sync([{ id: 'picture', room: '', position: [0, 0], rotationDeg: 0, ...piece, color: piece.color ?? null }]);
    render();
  }

  private ready(): THREE.WebGLRenderer | null {
    if (this.renderer) return this.renderer;
    try {
      const canvas = document.createElement('canvas');
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      return this.renderer;
    } catch {
      return null;
    }
  }
}
