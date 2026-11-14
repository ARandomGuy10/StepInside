import type { Vec2 } from '../core/collision';
import type { TourRoute } from '../core/tour';

const SPEED = 1.0; // metres a second: an unhurried walk
const TURN_RATE = 2.2; // how quickly the view swings round to face the way it walks
const LOOK_TIME = 3.2; // seconds spent looking round at each stop
const LOOK_SWING = 0.75; // radians to each side while looking round

/** Where the camera is at one moment of the tour. */
export interface TourFrame {
  x: number;
  y: number;
  /** Radians; 0 looks up the page. */
  yaw: number;
  /** The room being shown, while looking round in it. */
  room?: string;
  done: boolean;
}

/** The yaw that faces from `a` towards `b`. */
const heading = (a: Vec2, b: Vec2): number => Math.atan2(-(b.x - a.x), -(b.y - a.y));

/** The difference between two angles, from -π to π. */
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Plays one storey's tour route: walks along the path, turning smoothly to
 * face the way it goes, and at each stop pauses to look left and right.
 */
export class TourPlayer {
  private leg = 0; // walking from path[leg] to path[leg + 1]
  private along = 0; // metres along the current leg
  private looking = -1; // seconds into a look round, or -1 while walking
  private yaw: number;
  private baseYaw = 0;

  constructor(private readonly route: TourRoute, startYaw: number) {
    this.yaw = startYaw;
    // The first point may itself be a stop: look round there first.
    if (this.stopAt(0)) this.startLook();
  }

  private stopAt(index: number) {
    return this.route.stops.find((s) => s.at === index);
  }

  private startLook(): void {
    this.looking = 0;
    this.baseYaw = this.yaw;
  }

  update(dt: number): TourFrame {
    const { path } = this.route;
    if (path.length === 0) return { x: 0, y: 0, yaw: this.yaw, done: true };
    const last = path.length - 1;

    if (this.looking >= 0) {
      this.looking += dt;
      const t = Math.min(1, this.looking / LOOK_TIME);
      // Left, right, and back to the middle, eased so it never jerks.
      this.yaw = this.baseYaw + Math.sin(t * Math.PI * 2) * LOOK_SWING * Math.sin(t * Math.PI);
      const p = path[this.leg];
      const room = this.stopAt(this.leg)?.name;
      if (t >= 1) {
        this.looking = -1;
        if (this.leg >= last) return { x: p.x, y: p.y, yaw: this.yaw, room, done: true };
      }
      return { x: p.x, y: p.y, yaw: this.yaw, room, done: false };
    }

    if (this.leg >= last) {
      const p = path[last];
      return { x: p.x, y: p.y, yaw: this.yaw, done: true };
    }
    const a = path[this.leg];
    const b = path[this.leg + 1];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const want = heading(a, b);
    // Slow down on sharp turns, so the view has time to come round.
    const off = Math.abs(wrap(want - this.yaw));
    this.yaw += wrap(want - this.yaw) * (1 - Math.exp(-dt * TURN_RATE));
    this.along += dt * SPEED * Math.max(0.15, Math.cos(Math.min(off, Math.PI / 2)));
    if (this.along >= length) {
      this.leg += 1;
      this.along = 0;
      if (this.stopAt(this.leg)) this.startLook();
      const p = path[this.leg];
      return { x: p.x, y: p.y, yaw: this.yaw, done: false };
    }
    const k = this.along / length;
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, yaw: this.yaw, done: false };
  }
}
