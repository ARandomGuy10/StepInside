/** The landing page: the sketch-to-model slider, the tape, and the sample home's real numbers. */
import './common';
import villaDFirst from '../../scenes/villa-d-first.json';
import villaDGround from '../../scenes/villa-d-ground.json';
import villaDRoof from '../../scenes/villa-d-roof.json';
import { formatArea, summarizeAreas } from '../core/areas';
import { parseScene } from '../core/scene';
import sketchData from './plan-sketch.json';
import { sketchSvg, type SketchData } from './sketch';

const data = sketchData as unknown as SketchData;
const plot = document.getElementById('plot')!;
const range = document.getElementById('plot-range') as HTMLInputElement;

// ---- The "before": a hand sketch of the same floor, drawn from the model's own rooms ----

document.getElementById('plot-before')!.innerHTML = sketchSvg(data, {
  paper: '#fbfaf6',
  grid: 'rgba(40,60,90,0.12)',
  ink: '#27324f',
  note: '#b3123f',
  hand: 'Kalam, cursive',
});

// Setting-out lines: the plot's edges in thin ink, run on past the corners to a peg at each end.
{
  const lines: string[] = [];
  const pegs: string[] = [];
  data.plot.forEach((p, i) => {
    const q = data.plot[(i + 1) % 4];
    const ex = (q[0] - p[0]) * 0.16;
    const ey = (q[1] - p[1]) * 0.16;
    const ends: [number, number][] = [[p[0] - ex, p[1] - ey], [q[0] + ex, q[1] + ey]];
    lines.push(`M${ends[0][0]} ${ends[0][1]}L${ends[1][0]} ${ends[1][1]}`);
    for (const [x, y] of ends) {
      pegs.push(`<rect x="${x - 5}" y="${y - 5}" width="10" height="10" fill="oklch(0.19 0.008 70)" transform="rotate(20 ${x} ${y})"/>`);
    }
  });
  const marks = document.getElementById('plot-marks')!;
  marks.setAttribute('viewBox', `0 0 ${data.width} ${data.height}`);
  marks.innerHTML = `<path d="${lines.join('')}" stroke="oklch(0.19 0.008 70)" stroke-width="2" opacity="0.55" fill="none"/>${pegs.join('')}`;
}

// ---- The slider ----

const setAt = (percent: number): void => {
  const at = Math.max(0, Math.min(100, percent));
  plot.style.setProperty('--at', `${at}%`);
  range.value = String(at);
};

let rising = 0;
const stopRising = (): void => cancelAnimationFrame(rising);

range.addEventListener('input', () => {
  stopRising();
  setAt(Number(range.value));
});

// Dragging anywhere on the plan moves the string, not only its block on the tape.
let dragging = false;
const follow = (e: PointerEvent): void => {
  const box = plot.getBoundingClientRect();
  setAt(((e.clientX - box.left) / box.width) * 100);
};
plot.addEventListener('pointerdown', (e) => {
  if (e.target === range || (e.pointerType === 'mouse' && e.button !== 0)) return;
  stopRising();
  dragging = true;
  plot.setPointerCapture(e.pointerId);
  follow(e);
});
plot.addEventListener('pointermove', (e) => {
  if (dragging) follow(e);
});
const release = (): void => {
  dragging = false;
};
plot.addEventListener('pointerup', release);
plot.addEventListener('pointercancel', release);

// Once, as the page opens: the string is drawn across the sketch and the house comes up behind it.
if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const from = 96;
  const to = 47;
  const began = performance.now() + 350;
  setAt(from);
  const step = (time: number): void => {
    const t = Math.max(0, Math.min(1, (time - began) / 1900));
    setAt(from + (to - from) * (1 - Math.pow(2, -10 * t)) * (t === 1 ? 1 : 1.001));
    if (t < 1) rising = requestAnimationFrame(step);
    else setAt(to);
  };
  rising = requestAnimationFrame(step);
}

// ---- The tape: a tick every half foot, a number every five ----

function drawTape(): void {
  const tape = document.getElementById('tape')!;
  const width = tape.parentElement!.clientWidth;
  const parts: string[] = [];
  for (let i = 0, x = 20; x < width; i++, x += 12) {
    const five = i % 10 === 0;
    parts.push(`<rect x="${x}" y="0" width="${five ? 2 : 1.2}" height="${five ? 17 : i % 2 === 0 ? 11 : 6}" fill="currentColor"/>`);
    if (five) parts.push(`<text x="${x + 5}" y="31">${i / 2}</text>`);
  }
  tape.setAttribute('viewBox', `0 0 ${width} 38`);
  tape.setAttribute('preserveAspectRatio', 'xMinYMid slice');
  tape.innerHTML = parts.join('');
}
drawTape();
window.addEventListener('resize', drawTape);

// ---- The sample home's figures, worked out from its scene files ----

try {
  const floors = [
    { name: 'Ground floor', scene: parseScene(villaDGround) },
    { name: 'First floor', scene: parseScene(villaDFirst) },
    { name: 'Roof', scene: parseScene(villaDRoof) },
  ];
  const summary = summarizeAreas(floors);
  const rooms = floors.reduce((n, f) => n + f.scene.rooms.filter((r) => r.kind !== 'void').length, 0);
  const facts = document.getElementById('facts')!;
  const add = (term: string, value: string): void => {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    facts.append(dt, dd);
  };
  add('Rooms and outdoor spaces', String(rooms));
  add('Built-up area', formatArea(summary.builtUp, 'ft'));
  add('Carpet area', formatArea(summary.carpet, 'ft'));
} catch {
  // The two facts written in the page stand on their own.
}
