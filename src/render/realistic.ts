import * as THREE from 'three';
import { WebGLPathTracer } from 'three-gpu-pathtracer';

/**
 * Realistic mode: a path-traced picture of the view.
 *
 * The normal picture is drawn the fast way games use, which fakes light that
 * bounces between surfaces. Path tracing follows rays of light as they really
 * travel: from the sun and the sky, through the windows, off the floor and up
 * the walls. It is far too slow to do while the view moves, so it starts when
 * the view has been still for a moment and then sharpens pass by pass. Moving
 * the view goes straight back to the fast picture.
 */
export class Realistic {
  on = false;
  /** Passes drawn so far for the view on screen. */
  passes = 0;
  /** True from the moment the view rests until the first traced pass is on screen. */
  preparing = false;
  readonly maxPasses = 400;

  private tracer: WebGLPathTracer | null = null;
  private stale = true;
  private announced = false;
  private lastView = '';
  private restedAt = 0;
  private tracedView = '';
  private readonly size = new THREE.Vector2();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly world: THREE.Scene,
    /** Draws the fast picture, used underneath while the first passes come in. */
    private readonly drawFast: () => void,
  ) {}

  /** Something in the home, the light or what is shown has changed: trace it afresh. */
  invalidate(): void {
    this.stale = true;
    this.passes = 0;
  }

  /**
   * Call once a frame. Returns true if it drew the frame; false means the
   * caller should draw the fast picture (the view is moving, or the mode is off).
   * Throws if the device cannot path trace.
   */
  render(camera: THREE.Camera, time: number): boolean {
    if (!this.on) return false;
    camera.updateMatrixWorld();
    const p = (camera as THREE.PerspectiveCamera).projectionMatrix.elements;
    this.renderer.getSize(this.size);
    const view = `${camera.matrixWorld.elements.map((n) => n.toFixed(4)).join()}|${p[0].toFixed(4)},${p[5].toFixed(4)},${p[8].toFixed(4)},${p[9].toFixed(4)}|${this.size.x}x${this.size.y}`;
    if (view !== this.lastView) {
      this.lastView = view;
      this.restedAt = time;
      this.passes = 0;
      this.preparing = false;
      this.announced = false;
      return false;
    }
    if (time - this.restedAt < 350) return false;

    if (this.stale) {
      // Building takes a moment and holds the page, so let one frame through first
      // for the "preparing" note to appear.
      this.preparing = true;
      if (!this.announced) {
        this.announced = true;
        return false;
      }
      this.build(camera);
      this.tracedView = view;
    } else if (view !== this.tracedView) {
      this.tracer!.setCamera(camera);
      this.tracedView = view;
    }
    const tracer = this.tracer!;
    tracer.pausePathTracing = tracer.samples >= this.maxPasses;
    tracer.renderSample();
    this.passes = Math.floor(tracer.samples);
    if (this.passes >= tracer.minSamples) this.preparing = false;
    return true;
  }

  private build(camera: THREE.Camera): void {
    if (!this.tracer) {
      const tracer = new WebGLPathTracer(this.renderer);
      tracer.bounces = 6;
      tracer.transmissiveBounces = 6;
      tracer.filterGlossyFactor = 0.5;
      tracer.renderDelay = 0;
      tracer.minSamples = 3;
      tracer.fadeDuration = 350;
      tracer.dynamicLowRes = false;
      // One traced pixel per screen point: a sharper screen would only make each pass slower.
      tracer.renderScale = 1 / this.renderer.getPixelRatio();
      tracer.tiles.set(2, 2);
      tracer.rasterizeSceneCallback = () => this.drawFast();
      this.tracer = tracer;
    }
    const world = this.world;
    // The fast picture's helpers have no meaning to a ray of light: glows painted on
    // top of the scene, the selection box. Leave them out while the scene is read.
    const hidden: THREE.Object3D[] = [];
    world.traverseVisible((o) => {
      const material = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (!material || Array.isArray(material)) return;
      if ((material as THREE.MeshBasicMaterial).isMeshBasicMaterial || material.blending !== THREE.NormalBlending) hidden.push(o);
    });
    for (const o of hidden) o.visible = false;
    // The sky lights a path-traced scene by itself, so it needs the real panorama at
    // full strength, not the dimmed, pre-blurred copy the fast picture reflects.
    const environment = world.environment;
    const intensity = world.environmentIntensity;
    const panorama = (world.userData.panorama as THREE.Texture | undefined) ?? (world.background as THREE.Texture | null);
    if (panorama && (panorama as THREE.Texture).isTexture) {
      world.environment = panorama;
      world.environmentIntensity = Math.min(1.6, intensity * 2.6);
    }
    try {
      this.tracer.setScene(world, camera);
    } finally {
      world.environment = environment;
      world.environmentIntensity = intensity;
      for (const o of hidden) o.visible = true;
    }
    this.stale = false;
  }
}
