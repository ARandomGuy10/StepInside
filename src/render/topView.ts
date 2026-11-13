import * as THREE from 'three';

/**
 * A camera that looks straight down at the home.
 * It is orthographic: no perspective, so it reads like a floor plan and
 * distances on screen are true to scale.
 */
export class TopView {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  /** Shows where the walker stands and which way they face. */
  readonly marker: THREE.Mesh;

  constructor(private readonly bounds: THREE.Box2) {
    const center = bounds.getCenter(new THREE.Vector2());
    this.camera.position.set(center.x, 60, center.y);
    // "Up" on screen is up the page of the floor plan, which is -Z in 3D.
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(center.x, 0, center.y);

    const arrow = new THREE.Shape();
    arrow.moveTo(0, 0.28);
    arrow.lineTo(0.18, -0.18);
    arrow.lineTo(0, -0.08);
    arrow.lineTo(-0.18, -0.18);
    arrow.closePath();
    const geometry = new THREE.ShapeGeometry(arrow);
    geometry.rotateX(-Math.PI / 2);
    this.marker = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xe5484d }));
    this.marker.name = 'walker-marker';
    this.marker.visible = false;
  }

  setActive(active: boolean): void {
    this.marker.visible = active;
  }

  /** Fits the whole home into a viewport of the given size, leaving room for the panel. */
  resize(width: number, height: number, leftInset: number): void {
    const size = this.bounds.getSize(new THREE.Vector2());
    const margin = 0.8;
    const usable = Math.max(100, width - leftInset);
    const metresPerPixel = Math.max((size.x + 2 * margin) / usable, (size.y + 2 * margin) / height);
    const halfH = (metresPerPixel * height) / 2;
    const halfW = (metresPerPixel * width) / 2;
    const shift = (metresPerPixel * leftInset) / 2;
    this.camera.left = -halfW - shift;
    this.camera.right = halfW - shift;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
  }

  placeMarker(x: number, y: number, yaw: number, floor = 0): void {
    this.marker.position.set(x, floor + 2.9, y);
    this.marker.rotation.y = yaw;
  }
}
