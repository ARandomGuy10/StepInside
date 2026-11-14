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
  /** Set to false to freeze walking and looking, as in the top view. */
  enabled = true;
  /** Height of the floor the walker stands on: a storey, or part-way up a stair. */
  baseHeight = 0;
  private yaw = 0;
  private pitch = 0;
  private rightDrag = false;
  private readonly keys = new Set<string>();
  /** Movement from the on-screen stick on a phone: forward and sideways, each -1..1. */
  private stick = { forward: 0, strafe: 0 };
  private touchLook: { id: number; x: number; y: number } | null = null;

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

    // Holding the right mouse button also looks around, without locking the mouse.
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 2) this.rightDrag = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.rightDrag = false;
    });
    document.addEventListener('pointerlockchange', () => {
      document.body.classList.toggle('walking', this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.enabled || (!this.locked && !this.rightDrag)) return;
      this.yaw -= e.movementX * LOOK_SENSITIVITY;
      this.pitch -= e.movementY * LOOK_SENSITIVITY;
      this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch));
      this.applyRotation();
    });
    // On a touch screen a finger dragged across the view looks around.
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' && !this.touchLook) this.touchLook = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointermove', (e) => {
      const t = this.touchLook;
      if (!t || t.id !== e.pointerId || !this.enabled || document.body.classList.contains('dragging')) return;
      this.yaw += (e.clientX - t.x) * 0.005;
      this.pitch += (e.clientY - t.y) * 0.005;
      this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch));
      t.x = e.clientX;
      t.y = e.clientY;
      this.applyRotation();
    });
    const endTouch = (e: PointerEvent): void => {
      if (this.touchLook?.id === e.pointerId) this.touchLook = null;
    };
    canvas.addEventListener('pointerup', endTouch);
    canvas.addEventListener('pointercancel', endTouch);
    window.addEventListener('keydown', (e) => {
      if (!e.metaKey && !e.ctrlKey) this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  /**
   * Hides the cursor and starts mouse look. Must be called from a click.
   * Phones and iPads have no pointer lock; there a finger drag looks around.
   */
  lock(): void {
    if (this.locked || typeof this.canvas.requestPointerLock !== 'function') return;
    if (window.matchMedia('(pointer: coarse)').matches) return;
    try {
      const result = this.canvas.requestPointerLock() as unknown;
      if (result instanceof Promise) result.catch(() => {});
    } catch {
      // Some browsers refuse outside a user gesture; mouse look just stays off.
    }
  }

  /** Lets the mouse go again, where the browser supports locking it. */
  unlock(): void {
    if (typeof document.exitPointerLock === 'function' && document.pointerLockElement) document.exitPointerLock();
  }

  /** Sets the on-screen stick's push: forward and sideways, each from -1 to 1. */
  setStick(forward: number, strafe: number): void {
    this.stick = { forward, strafe };
  }

  /** Where the walker stands on the plan, and the way they face in radians. */
  get pose(): { x: number; y: number; yaw: number } {
    return { x: this.camera.position.x, y: this.camera.position.z, yaw: this.yaw };
  }

  /** How far up (positive) or down the walker looks, in degrees. */
  get pitchDeg(): number {
    return THREE.MathUtils.radToDeg(this.pitch);
  }

  setWalls(walls: Segment[]): void {
    this.walls = walls;
  }

  /** Puts the walker at a plan position, facing `yawDeg` (0 looks up the page). */
  teleport(x: number, y: number, yawDeg: number, pitchDeg = 0): void {
    this.camera.position.set(x, EYE_HEIGHT + this.baseHeight, y);
    this.yaw = THREE.MathUtils.degToRad(yawDeg);
    this.pitch = THREE.MathUtils.degToRad(pitchDeg);
    this.applyRotation();
  }

  /** Call once per frame with the time since the last frame, in seconds. */
  update(dt: number): void {
    if (!this.enabled) return;
    const keyForward = Number(this.down('KeyW', 'ArrowUp')) - Number(this.down('KeyS', 'ArrowDown'));
    const keyStrafe = Number(this.down('KeyD', 'ArrowRight')) - Number(this.down('KeyA', 'ArrowLeft'));
    const forward = keyForward || this.stick.forward;
    const strafe = keyStrafe || this.stick.strafe;
    const push = Math.min(1, Math.hypot(forward, strafe));
    if (push < 0.05) return;

    const speed = this.down('ShiftLeft', 'ShiftRight') ? FAST_SPEED : WALK_SPEED;
    // Keys walk at full speed; the stick walks slower the less it is pushed.
    const scale = (speed * dt * push) / Math.hypot(forward, strafe);
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
    this.camera.position.set(next.x, EYE_HEIGHT + this.baseHeight, next.y);
  }

  /** Call after changing baseHeight while standing still. */
  settle(): void {
    this.camera.position.y = EYE_HEIGHT + this.baseHeight;
  }

  private down(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  private applyRotation(): void {
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
