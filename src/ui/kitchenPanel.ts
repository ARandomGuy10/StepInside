import { fitKitchen, isKitchen, KITCHEN_DEFAULTS, type KitchenOptions } from '../core/kitchen';
import { edgeLength } from '../core/layoutEdits';
import { formatLength, type Units } from '../core/measure';
import type { Room, Scene } from '../core/scene';

export interface KitchenHost {
  now(): Scene;
  apply(next: Scene, blocked: string): boolean;
  units(): Units;
  toast(message: string): void;
}

/** Door and drawer colours offered for a fitted kitchen. */
const FRONTS: readonly [string, string][] = [
  ['#ecebe6', 'Chalk'], ['#e6dccb', 'Oat'], ['#b7c4b1', 'Sage'],
  ['#9fb4c7', 'Rain blue'], ['#22313f', 'Midnight'], ['#4a3a30', 'Walnut'],
];
const TOPS: readonly [KitchenOptions['worktop'], string][] = [['stone', 'Stone'], ['wood', 'Wood'], ['dark', 'Dark']];
const SVG = 'http://www.w3.org/2000/svg';

/**
 * The kitchen part of Furnish: a small plan of the room whose walls can be
 * clicked to fit a run of units, and the choices for fronts, worktop and
 * cupboards. Changing a choice refits the runs fitted here.
 */
export class KitchenPanel {
  private options: KitchenOptions = { ...KITCHEN_DEFAULTS };
  /** Walls fitted in this visit, per room, so a new choice can refit them. */
  private readonly fitted = new Map<string, Set<number>>();
  private key = '';
  private drawnFrom: Scene | null = null;

  constructor(private readonly host: KitchenHost, private readonly box: HTMLElement) {}

  render(show: boolean, room: Room | undefined): void {
    const scene = this.host.now();
    const visible = show && !!room && room.kind !== 'balcony' && room.kind !== 'void' && isKitchen(scene, room);
    this.box.hidden = !visible;
    if (!visible || !room) return;
    const key = `${room.id}|${JSON.stringify(this.options)}|${this.host.units()}|${[...(this.fitted.get(room.id) ?? [])].join(',')}`;
    if (key === this.key && scene === this.drawnFrom) return;
    this.key = key;
    this.drawnFrom = scene;
    this.draw(scene, room);
  }

  private draw(scene: Scene, room: Room): void {
    const title = document.createElement('h2');
    title.textContent = 'Fitted kitchen';
    const help = document.createElement('p');
    help.className = 'muted';
    help.textContent = 'Click a wall on this plan to fit a run of units along it: sink by the window, hob away from it, a tall fridge unit at the end.';
    this.box.replaceChildren(title, help, this.plan(scene, room), this.choices(room));
  }

  /** The room's outline with each wall a target. Fitted walls are drawn in the string's pink. */
  private plan(scene: Scene, room: Room): SVGSVGElement {
    const xs = room.polygon.map((p) => p[0]);
    const ys = room.polygon.map((p) => p[1]);
    const pad = 0.5;
    const [x0, y0] = [Math.min(...xs) - pad, Math.min(...ys) - pad];
    const [w, h] = [Math.max(...xs) - x0 + pad, Math.max(...ys) - y0 + pad];
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', `${x0} ${y0} ${w} ${h}`);
    svg.setAttribute('class', 'kitchen-plan');
    const scale = Math.max(w, h);
    const floor = document.createElementNS(SVG, 'polygon');
    floor.setAttribute('points', room.polygon.map((p) => p.join(',')).join(' '));
    floor.setAttribute('class', 'floor');
    svg.append(floor);
    // The units now in the room, as their footprints.
    for (const f of scene.furniture) {
      if (f.room !== room.id || f.removed || f.mount === 'wall') continue;
      const r = document.createElementNS(SVG, 'rect');
      r.setAttribute('x', String(-f.size[0] / 2));
      r.setAttribute('y', String(-f.size[2] / 2));
      r.setAttribute('width', String(f.size[0]));
      r.setAttribute('height', String(f.size[2]));
      r.setAttribute('transform', `translate(${f.position[0]} ${f.position[1]}) rotate(${f.rotationDeg})`);
      r.setAttribute('class', f.model.startsWith('kitchen') ? 'unit' : 'piece');
      svg.append(r);
    }
    const fitted = this.fitted.get(room.id) ?? new Set();
    room.polygon.forEach((p, edge) => {
      const q = room.polygon[(edge + 1) % room.polygon.length];
      const length = edgeLength(room, edge);
      const line = document.createElementNS(SVG, 'line');
      line.setAttribute('x1', String(p[0]));
      line.setAttribute('y1', String(p[1]));
      line.setAttribute('x2', String(q[0]));
      line.setAttribute('y2', String(q[1]));
      line.setAttribute('class', `wall${fitted.has(edge) ? ' fitted' : ''}`);
      line.style.strokeWidth = String(scale * 0.045);
      const tip = document.createElementNS(SVG, 'title');
      tip.textContent = `Fit units along this wall (${formatLength(length, this.host.units())})`;
      line.append(tip);
      line.addEventListener('click', () => this.fit(room.id, edge));
      svg.append(line);
    });
    for (const o of scene.openings.filter((x) => x.room === room.id)) {
      const p = room.polygon[o.edge];
      const q = room.polygon[(o.edge + 1) % room.polygon.length];
      const len = edgeLength(room, o.edge);
      const t0 = o.offset / len;
      const t1 = (o.offset + o.width) / len;
      const mark = document.createElementNS(SVG, 'line');
      mark.setAttribute('x1', String(p[0] + (q[0] - p[0]) * t0));
      mark.setAttribute('y1', String(p[1] + (q[1] - p[1]) * t0));
      mark.setAttribute('x2', String(p[0] + (q[0] - p[0]) * t1));
      mark.setAttribute('y2', String(p[1] + (q[1] - p[1]) * t1));
      mark.setAttribute('class', o.type);
      mark.style.strokeWidth = String(scale * 0.05);
      svg.append(mark);
    }
    return svg;
  }

  private choices(room: Room): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'kitchen-choices';
    const label = (text: string): HTMLSpanElement => {
      const span = document.createElement('span');
      span.textContent = text;
      return span;
    };
    const fronts = document.createElement('div');
    fronts.className = 'fronts';
    for (const [hex, name] of FRONTS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.title = name;
      b.setAttribute('aria-label', name);
      b.style.background = hex;
      b.classList.toggle('current', this.options.fronts === hex);
      b.addEventListener('click', () => this.choose(room.id, { fronts: hex }));
      fronts.append(b);
    }
    const tops = document.createElement('div');
    tops.className = 'segments';
    for (const [value, name] of TOPS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = name;
      b.classList.toggle('active', this.options.worktop === value);
      b.addEventListener('click', () => this.choose(room.id, { worktop: value }));
      tops.append(b);
    }
    const toggle = (name: string, on: boolean, change: (v: boolean) => Partial<KitchenOptions>): HTMLLabelElement => {
      const l = document.createElement('label');
      l.className = 'check';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = on;
      input.addEventListener('change', () => this.choose(room.id, change(input.checked)));
      l.append(input, ` ${name}`);
      return l;
    };
    wrap.append(
      label('Fronts'), fronts,
      label('Worktop'), tops,
    );
    const toggles = document.createElement('div');
    toggles.append(
      toggle('Tall fridge unit', this.options.tall, (v) => ({ tall: v })),
      toggle('Wall cupboards', this.options.wallUnits, (v) => ({ wallUnits: v })),
    );
    const box = document.createElement('div');
    box.append(wrap, toggles);
    return box;
  }

  private fit(roomId: string, edge: number): void {
    const next = fitKitchen(this.host.now(), roomId, edge, this.options);
    if (this.host.apply(next, 'This wall is too short for units, or a door takes it up.')) {
      const walls = this.fitted.get(roomId) ?? new Set<number>();
      walls.add(edge);
      this.fitted.set(roomId, walls);
      this.host.toast('Units fitted. Each one can still be moved, painted or taken out.');
    }
  }

  /** A new choice refits every wall fitted here, in one undo step. */
  private choose(roomId: string, change: Partial<KitchenOptions>): void {
    this.options = { ...this.options, ...change };
    const walls = [...(this.fitted.get(roomId) ?? [])];
    if (walls.length) {
      const next = walls.reduce((s, edge) => fitKitchen(s, roomId, edge, this.options), this.host.now());
      this.host.apply(next, 'Nothing to change.');
    }
    this.key = '';
  }
}
