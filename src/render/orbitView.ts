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
  private fit = 1;

  /** `bounds` is the home's outline on the plan, `height` its total height. */
  constructor(bounds: THREE.Box2, height: number, start = { azimuth: 0.45, polar: 1.0, reach: 1.25 }) {
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

  /**
   * Fits the picture to the window. `left` and `bottom` are strips, in
   * pixels, covered by the panel and the view bar: the home is centred in
   * what is left over, so the buttons do not sit on top of it.
   */
  resize(width: number, height: number, left = 0, bottom = 0): void {
    this.camera.aspect = width / height;
    // A view offset slides the picture without changing its perspective.
    this.camera.setViewOffset(width, height, -left / 2, bottom / 2, width, height);
    // Stand further back by as much as the free area is smaller than the window.
    this.fit = Math.max(width / Math.max(200, width - left), height / Math.max(200, height - bottom));
    this.camera.updateProjectionMatrix();
    this.place();
  }

  private place(): void {
    // `polar` is the angle down from straight above; azimuth 0 looks from the front.
    const distance = this.distance * this.fit;
    const flat = Math.sin(this.polar) * distance;
    this.camera.position.set(
      this.target.x + Math.sin(this.azimuth) * flat,
      this.target.y + Math.cos(this.polar) * distance,
      this.target.z + Math.cos(this.azimuth) * flat,
    );
    this.camera.lookAt(this.target);
  }
}
