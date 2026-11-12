import * as THREE from 'three';
import { moveWithCollision, type Segment } from '../core/collision';

const EYE_HEIGHT = 1.65;
const BODY_RADIUS = 0.25;
const WALK_SPEED = 1.6; // metres per second
const FAST_SPEED = 3.2;
const LOOK_SENSITIVITY = 0.0022; // radians per pixel of mouse movement
const MAX_PITCH = THREE.MathUtils.degToRad(85);

/**
 * First-person walking. Mouse look uses the browser's Pointer Lock API,
 * which hides the cursor and reports raw mouse movement until Esc.
 */
export class FirstPersonControls {
  private yaw = 0;
  private pitch = 0;
  private readonly keys = new Set<string>();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
    private walls: Segment[],
    start: { x: number; y: number; yawDeg?: number },
  ) {
    this.camera.rotation.order = 'YXZ'; // turn left/right first, then look up/down
    this.camera.position.set(start.x, EYE_HEIGHT, start.y);
    this.yaw = THREE.MathUtils.degToRad(start.yawDeg ?? 0);
    this.applyRotation();

    canvas.addEventListener('click', () => {
      if (!this.locked) void canvas.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      document.body.classList.toggle('walking', this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * LOOK_SENSITIVITY;
      this.pitch -= e.movementY * LOOK_SENSITIVITY;
      this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch));
      this.applyRotation();
    });
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  setWalls(walls: Segment[]): void {
    this.walls = walls;
  }

  /** Call once per frame with the time since the last frame, in seconds. */
  update(dt: number): void {
    const forward = Number(this.down('KeyW', 'ArrowUp')) - Number(this.down('KeyS', 'ArrowDown'));
    const strafe = Number(this.down('KeyD', 'ArrowRight')) - Number(this.down('KeyA', 'ArrowLeft'));
    if (forward === 0 && strafe === 0) return;

    const speed = this.down('ShiftLeft', 'ShiftRight') ? FAST_SPEED : WALK_SPEED;
    const scale = (speed * dt) / Math.hypot(forward, strafe);
    // At yaw 0 the camera looks along -Z, which is "up the page" on the plan.
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const delta = {
      x: (-sin * forward + cos * strafe) * scale,
      y: (-cos * forward - sin * strafe) * scale,
    };
    const next = moveWithCollision(
      { x: this.camera.position.x, y: this.camera.position.z },
      delta,
      BODY_RADIUS,
      this.walls,
    );
    this.camera.position.set(next.x, EYE_HEIGHT, next.y);
  }

  private down(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  private applyRotation(): void {
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
