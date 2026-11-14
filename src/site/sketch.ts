/**
 * Draws the "before" picture of the landing page: a rough hand sketch of a
 * floor plan, as SVG. The points come from `plan-sketch.json`, which
 * `scripts/site-shots.cjs` writes from the real model, seen from the same
 * spot as the 3D picture. So the sketch lies exactly under the model.
 */
export interface SketchData {
  width: number;
  height: number;
  /** The sheet of paper the sketch is on, as four corners. */
  sheet: [number, number][];
  /** The plot's outline. */
  plot: [number, number][];
  rooms: { name: string; size: string; outline: [number, number][]; centre: [number, number] }[];
}

export interface SketchLook {
  paper: string;
  /** Faint squares printed on the paper; leave out for plain paper. */
  grid?: string;
  ink: string;
  /** Colour of the sizes written under the room names. */
  note: string;
  /** Font for the handwriting. */
  hand: string;
  /** False leaves the sheet out, for a sketch drawn straight on the page. */
  sheet?: boolean;
}

/** A small repeatable random source, so the sketch looks the same on every visit. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (v: number): string => v.toFixed(1);

/** A line from a to b the way a hand draws it: slightly bowed, overshooting its ends. */
function stroke(a: [number, number], b: [number, number], rnd: () => number, wobble: number): string {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const [ux, uy] = [dx / len, dy / len];
  const over = 3 + rnd() * 5;
  const start = [a[0] - ux * over + (rnd() - 0.5) * wobble, a[1] - uy * over + (rnd() - 0.5) * wobble];
  const end = [b[0] + ux * over + (rnd() - 0.5) * wobble, b[1] + uy * over + (rnd() - 0.5) * wobble];
  const bow = (rnd() - 0.5) * wobble * 2.4;
  const c1 = [a[0] + dx * 0.3 - uy * bow, a[1] + dy * 0.3 + ux * bow];
  const c2 = [a[0] + dx * 0.7 - uy * bow * 0.6, a[1] + dy * 0.7 + ux * bow * 0.6];
  return `M${f(start[0])} ${f(start[1])}C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(end[0])} ${f(end[1])}`;
}

const mix = (a: [number, number], b: [number, number], t: number): [number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** The sketch as an SVG string with the picture's own size as its viewBox. */
export function sketchSvg(data: SketchData, look: SketchLook): string {
  const rnd = random(7);
  const [a, b, c, d] = data.sheet;
  const parts: string[] = [];
  if (look.sheet !== false) {
    const corners = data.sheet.map((p) => `${f(p[0])},${f(p[1])}`).join(' ');
    parts.push(`<polygon points="${corners}" fill="${look.paper}"/>`);
    if (look.grid) {
      // Printed squares, in the paper's own perspective.
      const lines: string[] = [];
      for (let i = 1; i < 22; i++) {
        const p = mix(a, b, i / 22);
        const q = mix(d, c, i / 22);
        lines.push(`M${f(p[0])} ${f(p[1])}L${f(q[0])} ${f(q[1])}`);
      }
      for (let i = 1; i < 34; i++) {
        const p = mix(a, d, i / 34);
        const q = mix(b, c, i / 34);
        lines.push(`M${f(p[0])} ${f(p[1])}L${f(q[0])} ${f(q[1])}`);
      }
      parts.push(`<path d="${lines.join('')}" stroke="${look.grid}" stroke-width="1" fill="none"/>`);
    }
  }

  // Walls: every room's outline, drawn twice the way a pen goes over a line.
  const walls: string[] = [];
  for (const room of data.rooms) {
    room.outline.forEach((p, i) => {
      const q = room.outline[(i + 1) % room.outline.length];
      walls.push(stroke(p, q, rnd, 2.2));
      if (rnd() > 0.45) walls.push(stroke(p, q, rnd, 3));
    });
  }
  parts.push(`<path d="${walls.join('')}" stroke="${look.ink}" stroke-width="2.1" stroke-linecap="round" fill="none" opacity="0.92"/>`);
  const outer: string[] = [];
  data.plot.forEach((p, i) => outer.push(stroke(p, data.plot[(i + 1) % 4], rnd, 2), stroke(p, data.plot[(i + 1) % 4], rnd, 3.4)));
  parts.push(`<path d="${outer.join('')}" stroke="${look.ink}" stroke-width="2.8" stroke-linecap="round" fill="none"/>`);

  // Handwriting follows the plan's own slant on the page.
  const slant = (Math.atan2(data.plot[1][1] - data.plot[0][1], data.plot[1][0] - data.plot[0][0]) * 180) / Math.PI;
  for (const room of data.rooms) {
    const xs = room.outline.map((p) => p[0]);
    const span = Math.max(...xs) - Math.min(...xs);
    const small = span < 150;
    const size = small ? 17 : 24;
    const [x, y] = room.centre;
    const tilt = slant + (rnd() - 0.5) * 3;
    parts.push(
      `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(tilt)})" font-family="${look.hand}" text-anchor="middle">` +
        `<text y="-2" font-size="${size}" fill="${look.ink}">${room.name.toLowerCase()}</text>` +
        (small ? '' : `<text y="${size - 2}" font-size="${size - 6}" fill="${look.note}">${room.size.replace(/ x /, ' × ')}</text>`) +
        '</g>',
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${data.width} ${data.height}" role="img" aria-label="A rough hand sketch of a floor plan">${parts.join('')}</svg>`;
}
