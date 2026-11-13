import * as THREE from 'three';

/**
 * A camera that circles the whole home from outside, like turning a
 * model in your hands. Drag turns it, the wheel zooms.
 */
export class OrbitView {
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
  private readonly target: THREE.Vector3;
  private readonly home: { azimuth: number; polar: number; distance: number };
  private azimuth = 0;
  private polar = 0;
  private distance = 0;
  // The view glides towards these, so buttons and the wheel feel smooth.
  private goal = { azimuth: 0, polar: 0, distance: 0 };

  /** `bounds` is the home's outline on the plan, `height` its total height. */
  constructor(bounds: THREE.Box2, height: number, start = { azimuth: 0.6, polar: 0.95, reach: 1.75 }) {
    const center = bounds.getCenter(new THREE.Vector2());
    const size = bounds.getSize(new THREE.Vector2());
    this.target = new THREE.Vector3(center.x, height * 0.35, center.y);
    // By default: from the front, a little to one side and well above the roof.
    this.home = { azimuth: start.azimuth, polar: start.polar, distance: Math.max(size.length(), height * 2) * start.reach };
    this.reset(true);
  }

  reset(jump = false): void {
    this.goal = { ...this.home };
    if (jump) ({ azimuth: this.azimuth, polar: this.polar, distance: this.distance } = this.home);
    this.place();
  }

  /** Turns by angles in radians: `around` the home, and `over` the top of it. */
  turn(around: number, over = 0, jump = false): void {
    this.goal.azimuth += around;
    this.goal.polar = Math.max(0.02, Math.min(1.5, this.goal.polar + over));
    if (jump) {
      this.azimuth = this.goal.azimuth;
      this.polar = this.goal.polar;
      this.place();
    }
  }

  /** Looks at a point this high above the ground: the floor of a storey. */
  lookAtHeight(y: number): void {
    this.target.y = y;
  }

  /** Zooms by a factor: below 1 moves closer. */
  zoom(factor: number): void {
    this.goal.distance = Math.max(this.home.distance * 0.25, Math.min(this.home.distance * 2, this.goal.distance * factor));
  }

  /** Call once per frame with the time since the last frame, in seconds. */
  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 10);
    this.azimuth += (this.goal.azimuth - this.azimuth) * k;
    this.polar += (this.goal.polar - this.polar) * k;
    this.distance += (this.goal.distance - this.distance) * k;
    this.place();
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private place(): void {
    // `polar` is the angle down from straight above; azimuth 0 looks from the front.
    const flat = Math.sin(this.polar) * this.distance;
    this.camera.position.set(
      this.target.x + Math.sin(this.azimuth) * flat,
      this.target.y + Math.cos(this.polar) * this.distance,
      this.target.z + Math.cos(this.azimuth) * flat,
    );
    this.camera.lookAt(this.target);
  }
}
