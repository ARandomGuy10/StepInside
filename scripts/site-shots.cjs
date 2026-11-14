// Renders the pictures the website uses from the real viewer: the 3D model
// cut out of its background, and the same view's room outlines for the
// hand-drawn "before" sketch. Run with the dev server up:
//   node scripts/site-shots.cjs http://localhost:5173 public/site
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const [, , base = 'http://localhost:5173', outDir = 'public/site', quality = 'fast'] = process.argv;
const W = 1600, H = 1200;

async function open(browser, query, width = W, height = H, keep = '') {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(`${base}/studio.html?${query}${quality === 'fast' ? '&fast' : ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.walkthrough, null, { timeout: 120000 });
  await page.addStyleTag({ content: `body > *:not(#view)${keep} { display: none !important; }` });
  return page;
}

/** Shows the view, hides the surroundings, and returns the canvas as a PNG on `background`. */
async function shot(page, view, background, extra) {
  await page.evaluate(({ view, background, extra }) => {
    const w = window.walkthrough;
    w.showView(view);
    if (view.view === 'plan') w.plan.snap();
    const Color = w.world.children.find((o) => o.isLight).color.constructor;
    w.world.background = new Color(background);
    w.marker.visible = false;
    w.world.traverse((o) => {
      if (o.name === 'site' || o.name === 'street') o.visible = false;
    });
    if (extra) new Function('w', extra)(w);
  }, { view, background, extra });
  await page.waitForTimeout(quality === 'fast' ? 1500 : 6000);
  return page.screenshot({ type: 'png', timeout: 180000 });
}

/** Two shots, on black and on white, give the model with a true transparent background. */
async function cutout(page, view, file, keep, extra) {
  const black = await shot(page, view, '#000000', extra);
  const white = await shot(page, view, '#ffffff', extra);
  const png = await page.evaluate(async ({ black, white, keep }) => {
    const load = (b64) => new Promise((done) => {
      const img = new Image();
      img.onload = () => done(img);
      img.src = `data:image/png;base64,${b64}`;
    });
    const [a, b] = await Promise.all([load(black), load(white)]);
    const canvas = document.createElement('canvas');
    canvas.width = a.width;
    canvas.height = a.height;
    const g = canvas.getContext('2d');
    g.drawImage(a, 0, 0);
    const onBlack = g.getImageData(0, 0, a.width, a.height);
    g.drawImage(b, 0, 0);
    const onWhite = g.getImageData(0, 0, a.width, a.height);
    const out = onBlack.data;
    // The corner is pure background: how bright "white" comes out after tone mapping.
    const lo = out[0], hi = onWhite.data[0];
    for (let i = 0; i < out.length; i += 4) {
      const diff = (onWhite.data[i] - out[i] + onWhite.data[i + 1] - out[i + 1] + onWhite.data[i + 2] - out[i + 2]) / 3;
      const alpha = Math.max(0, Math.min(1, 1 - diff / (hi - lo)));
      for (let c = 0; c < 3; c++) out[i + c] = alpha > 0.01 ? Math.min(255, (out[i + c] - lo * (1 - alpha)) / alpha) : 0;
      out[i + 3] = Math.round(alpha * 255);
    }
    g.putImageData(onBlack, 0, 0);
    // Trim to the model, or to `keep` (a box that must stay in) when it is bigger.
    let x0 = keep ? keep[0] : a.width, y0 = keep ? keep[1] : a.height, x1 = keep ? keep[2] : 0, y1 = keep ? keep[3] : 0;
    for (let y = 0; y < a.height; y++) {
      for (let x = 0; x < a.width; x++) {
        if (out[(y * a.width + x) * 4 + 3] < 8) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    const pad = 12;
    x0 = Math.max(0, Math.floor(x0 - pad)); y0 = Math.max(0, Math.floor(y0 - pad));
    x1 = Math.min(a.width, Math.ceil(x1 + pad)); y1 = Math.min(a.height, Math.ceil(y1 + pad));
    const trimmed = document.createElement('canvas');
    trimmed.width = x1 - x0;
    trimmed.height = y1 - y0;
    trimmed.getContext('2d').drawImage(canvas, -x0, -y0);
    return { data: trimmed.toDataURL('image/png').split(',')[1], box: [x0, y0, x1, y1] };
  }, { black: black.toString('base64'), white: white.toString('base64'), keep });
  fs.writeFileSync(file, Buffer.from(png.data, 'base64'));
  console.log('wrote', file, png.box.join(','));
  return png.box;
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

  // The ground floor with its lid off: the "after" of the slider.
  const page = await open(browser, 'home=villa-d&view=plan&floor=0');
  const cam = JSON.parse(process.env.PLAN_CAM || '[0.34,0.52,25]');
  const view = { view: 'plan', floor: 0, cam };
  await page.evaluate((view) => { window.walkthrough.showView(view); window.walkthrough.plan.snap(); }, view);

  // The same view's rooms, as points on the picture, for the sketch.
  const sketch = await page.evaluate(({ W, H }) => {
    const w = window.walkthrough;
    const camera = w.planCamera;
    const V = camera.position.constructor;
    const at = (x, z) => {
      const p = new V(x, 0.02, z).project(camera);
      return [Math.round(((p.x + 1) / 2) * W * 10) / 10, Math.round(((1 - p.y) / 2) * H * 10) / 10];
    };
    const FT = 0.3048;
    const feet = (m) => {
      const inches = Math.round(m / FT * 2) * 6;
      return inches % 12 ? `${Math.floor(inches / 12)}'${inches % 12}"` : `${inches / 12}'`;
    };
    const scene = w.history.current[0];
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const rooms = scene.rooms.filter((r) => r.kind !== 'void').map((r) => {
      const xs = r.polygon.map((p) => p[0]), zs = r.polygon.map((p) => p[1]);
      x0 = Math.min(x0, ...xs); x1 = Math.max(x1, ...xs); z0 = Math.min(z0, ...zs); z1 = Math.max(z1, ...zs);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
      return {
        name: r.name ?? r.id,
        size: `${feet(Math.max(...xs) - Math.min(...xs))} x ${feet(Math.max(...zs) - Math.min(...zs))}`,
        outline: r.polygon.map((p) => at(p[0], p[1])),
        centre: at(cx, cz),
      };
    });
    const pad = 1.6;
    return {
      width: W, height: H, rooms,
      plot: [at(x0, z0), at(x1, z0), at(x1, z1), at(x0, z1)],
      sheet: [at(x0 - pad, z0 - pad), at(x1 + pad, z0 - pad), at(x1 + pad, z1 + pad), at(x0 - pad, z1 + pad)],
    };
  }, { W, H });
  const xs = sketch.sheet.map((p) => p[0]), ys = sketch.sheet.map((p) => p[1]);
  const box = await cutout(page, view, path.join(outDir, 'plan-model.png'), [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
  const move = (p) => [Math.round((p[0] - box[0]) * 10) / 10, Math.round((p[1] - box[1]) * 10) / 10];
  sketch.width = box[2] - box[0];
  sketch.height = box[3] - box[1];
  sketch.plot = sketch.plot.map(move);
  sketch.sheet = sketch.sheet.map(move);
  for (const r of sketch.rooms) { r.outline = r.outline.map(move); r.centre = move(r.centre); }
  fs.writeFileSync(path.join(outDir, 'plan-sketch.json'), JSON.stringify(sketch));
  console.log('wrote sketch', sketch.rooms.length, 'rooms');
  await page.close();

  // The whole house from outside.
  const outside = await open(browser, 'home=villa-d');
  await cutout(outside, { view: 'whole', floor: 0, cam: JSON.parse(process.env.WHOLE_CAM || '[0.55,1.0,27]') }, path.join(outDir, 'house.png'), null);
  await outside.close();

  // Standing in the living and dining room, at eye height.
  const walk = await open(browser, 'home=villa-d&view=walk', 1400, 1000);
  await walk.evaluate(() => window.walkthrough.showView({ view: 'walk', floor: 0, at: [1.0, 9.6, -53, -4] }));
  await walk.waitForTimeout(quality === 'fast' ? 1500 : 8000);
  fs.writeFileSync(path.join(outDir, 'walk.png'), await walk.screenshot({ type: 'png', timeout: 180000 }));
  await walk.close();

  // A flat plan with its room names and sizes.
  const flat = await open(browser, 'home=villa-d&view=plan&floor=0&flat=1', 1400, 1100, ':not(#labels)');
  await flat.waitForTimeout(quality === 'fast' ? 2500 : 8000);
  fs.writeFileSync(path.join(outDir, 'plan-flat.png'), await flat.screenshot({ type: 'png', timeout: 180000 }));
  await flat.close();

  // The house as the light goes, with its outdoor lamps on.
  const dusk = await open(browser, 'home=villa-d&date=2026-11-14&time=17.2', 1400, 1100);
  await dusk.evaluate(() => {
    window.walkthrough.showView({ view: 'whole', floor: 0, cam: [0.5, 1.12, 30] });
    window.walkthrough.marker.visible = false;
  });
  await dusk.waitForTimeout(quality === 'fast' ? 2500 : 8000);
  fs.writeFileSync(path.join(outDir, 'dusk.png'), await dusk.screenshot({ type: 'png', timeout: 180000 }));
  await dusk.close();
  await browser.close();
})();
