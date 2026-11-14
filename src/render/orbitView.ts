import * as THREE from 'three';

/**
 * A camera that circles the whole home from outside, like turning a
 * model in your hands. Drag turns it, the wheel zooms, and a right-drag
 * (or Shift-drag, or two fingers) slides it across the screen.
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
  private viewHeight = 800;
  // Where the camera looks: the home's centre plus a slide across the ground.
  private readonly centre: THREE.Vector2;
  private shift = new THREE.Vector2();
  private goalShift = new THREE.Vector2();
  private readonly reach: number;
  // A flat plan looks straight down through a long lens, so it reads as a
  // drawing: `lens` glides from 0 (normal) to 1 (flat).
  private flatOn = false;
  private lens = 0;
  private tilt: number | null = null;

  /** `bounds` is the home's outline on the plan, `height` its total height. */
  constructor(bounds: THREE.Box2, height: number, start = { azimuth: 0.45, polar: 1.0, reach: 1.25 }) {
    const center = bounds.getCenter(new THREE.Vector2());
    const size = bounds.getSize(new THREE.Vector2());
    this.target = new THREE.Vector3(center.x, height * 0.35, center.y);
    this.centre = center.clone();
    this.reach = Math.max(size.length() * 0.75, 10);
    // By default: from the front, a little to one side and well above the roof.
    this.home = { azimuth: start.azimuth, polar: start.polar, distance: Math.max(size.length(), height * 2) * start.reach };
    this.reset(true);
  }

  reset(jump = false): void {
    this.goal = { ...this.home };
    if (this.flatOn) {
      this.tilt = this.goal.polar;
      this.goal.polar = 0.0005;
      this.goal.azimuth = 0;
    }
    this.goalShift.set(0, 0);
    if (jump) {
      ({ azimuth: this.azimuth, polar: this.polar, distance: this.distance } = this.home);
      this.shift.set(0, 0);
    }
    this.place();
  }

  /** Turns by angles in radians: `around` the home, and `over` the top of it. */
  turn(around: number, over = 0, jump = false): void {
    this.goal.azimuth += around;
    if (!this.flatOn) this.goal.polar = Math.max(0.02, Math.min(1.5, this.goal.polar + over));
    if (jump) {
      this.azimuth = this.goal.azimuth;
      this.polar = this.goal.polar;
      this.place();
    }
  }

  /**
   * Slides the home across the screen by a drag of `dx`, `dy` pixels, so the
   * part under the pointer follows it. The slide stays within reach of the home.
   */
  pan(dx: number, dy: number): void {
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const perPixel = (2 * Math.tan(fov / 2) * this.distance * this.fit) / this.viewHeight;
    // Moving up the screen covers more ground the flatter the view is.
    const along = perPixel / Math.max(Math.cos(this.polar), 0.35);
    const sin = Math.sin(this.azimuth);
    const cos = Math.cos(this.azimuth);
    // Screen right on the ground is (cos, -sin); into the screen is (-sin, -cos).
    this.goalShift.x += -dx * perPixel * cos + dy * along * -sin;
    this.goalShift.y += dx * perPixel * sin + dy * along * -cos;
    if (this.goalShift.length() > this.reach) this.goalShift.setLength(this.reach);
    this.shift.copy(this.goalShift);
    this.place();
  }

  /** The camera's angles and distance, and the slide when there is one, to put in a link. */
  get state(): number[] {
    const view = [this.goal.azimuth, this.goal.polar, this.goal.distance];
    return this.goalShift.lengthSq() > 1e-6 ? [...view, this.goalShift.x, this.goalShift.y] : view;
  }

  /** Goes back to angles, distance and slide from `state`, jumping straight there. */
  restore([azimuth, polar, distance, x = 0, z = 0]: readonly number[]): void {
    if (![azimuth, polar, distance, x, z].every(Number.isFinite)) return;
    if (this.flatOn) polar = 0.0005;
    this.goalShift.set(x, z);
    if (this.goalShift.length() > this.reach) this.goalShift.setLength(this.reach);
    this.shift.copy(this.goalShift);
    this.goal = {
      azimuth,
      polar: this.flatOn ? polar : Math.max(0.02, Math.min(1.5, polar)),
      distance: Math.max(this.home.distance * 0.25, Math.min(this.home.distance * 2, distance)),
    };
    ({ azimuth: this.azimuth, polar: this.polar, distance: this.distance } = this.goal);
    this.place();
  }

  /** True while the view is a flat, straight-down plan. */
  get flat(): boolean {
    return this.flatOn;
  }

  /**
   * Flat: looks straight down with almost no perspective, the plan's front
   * at the bottom, like a drawing. Turning still works; tilting does not.
   */
  setFlat(on: boolean): void {
    if (on === this.flatOn) return;
    this.flatOn = on;
    if (on) {
      this.tilt = this.goal.polar;
      this.goal.polar = 0.0005;
      // Square to the page: the nearest quarter turn.
      this.goal.azimuth = Math.round(this.goal.azimuth / (Math.PI / 2)) * (Math.PI / 2);
    } else {
      this.goal.polar = this.tilt ?? this.home.polar;
    }
  }

  /** Jumps straight to where the view is gliding to, lens included. */
  snap(): void {
    ({ azimuth: this.azimuth, polar: this.polar, distance: this.distance } = this.goal);
    this.shift.copy(this.goalShift);
    this.lens = this.flatOn ? 1 : 0;
    this.place();
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
    this.shift.lerp(this.goalShift, k);
    this.lens += ((this.flatOn ? 1 : 0) - this.lens) * k;
    if (Math.abs(this.lens - (this.flatOn ? 1 : 0)) < 0.001) this.lens = this.flatOn ? 1 : 0;
    this.place();
  }

  /**
   * Fits the picture to the window. `left` and `bottom` are strips, in
   * pixels, covered by the panel and the view bar: the home is centred in
   * what is left over, so the buttons do not sit on top of it.
   */
  resize(width: number, height: number, left = 0, bottom = 0): void {
    this.camera.aspect = width / height;
    this.viewHeight = height;
    // A view offset slides the picture without changing its perspective.
    this.camera.setViewOffset(width, height, -left / 2, bottom / 2, width, height);
    // Stand further back by as much as the free area is smaller than the window.
    this.fit = Math.max(width / Math.max(200, width - left), height / Math.max(200, height - bottom));
    this.camera.updateProjectionMatrix();
    this.place();
  }

  private place(): void {
    // `polar` is the angle down from straight above; azimuth 0 looks from the front.
    this.target.x = this.centre.x + this.shift.x;
    this.target.z = this.centre.y + this.shift.y;
    // The long lens stands further back by as much as it narrows the view.
    const fov = 40 + (6 - 40) * this.lens;
    const distance = ((this.distance * this.fit) * Math.tan(THREE.MathUtils.degToRad(20))) / Math.tan(THREE.MathUtils.degToRad(fov / 2));
    const near = this.lens > 0.5 ? distance * 0.5 : 0.1;
    if (this.camera.fov !== fov || this.camera.near !== near) {
      this.camera.fov = fov;
      this.camera.near = near;
      this.camera.far = distance + 400;
      this.camera.updateProjectionMatrix();
    }
    const flat = Math.sin(this.polar) * distance;
    this.camera.position.set(
      this.target.x + Math.sin(this.azimuth) * flat,
      this.target.y + Math.cos(this.polar) * distance,
      this.target.z + Math.cos(this.azimuth) * flat,
    );
    this.camera.lookAt(this.target);
  }
}
