const { chromium } = require('playwright');
// Renders the landing page's sun, style, plan and compare pictures from Design D.
// Usage, with `npm run dev` running: node scripts/site-shots-more.cjs [fit,sun,style,compare] [outDir]
const OUT = process.argv[3] || '.';
const HIDE = '#panel,#hint,#view-bar,#sun-bar,#toast,#crosshair,#walk-pad{display:none!important}';
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const open = async (query, w, h) => {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    p.on('pageerror', e => console.log('PAGEERROR', e.message));
    await p.goto(`http://localhost:5173/studio.html?${query}&fast`, { waitUntil: 'load' });
    await p.waitForFunction(() => window.walkthrough, null, { timeout: 120000 });
    await p.addStyleTag({ content: HIDE });
    await p.waitForTimeout(2500);
    return p;
  };
  const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png`, timeout: 180000 });
  const only = process.argv[2] || 'fit,sun,style,compare';
  if (only.includes('fit')) {
    const p = await open('home=villa-d&view=plan&floor=0', 1100, 900);
    await p.evaluate(() => { const w = window.walkthrough; w.showView({ view: 'plan', floor: 0, cam: [0.5, 0.42, 20] }); w.plan.snap(); w.marker.visible = false; });
    await p.waitForTimeout(2500); await shot(p, 'fit'); await p.close();
  }
  if (only.includes('sun')) {
    for (const [name, time] of [['sun-am', '8'], ['sun-pm', '16.6']]) {
      const p = await open(`home=villa-d&view=plan&floor=0&date=2026-11-14&time=${time}`, 1000, 900);
      await p.evaluate(() => { const w = window.walkthrough; w.showView({ view: 'plan', floor: 0, cam: [0.5, 0.42, 19] }); w.plan.snap(); w.marker.visible = false; document.querySelector('#btn-dimensions').click(); });
      await p.waitForTimeout(2500); await shot(p, name); await p.close();
    }
  }
  if (only.includes('style')) {
    for (const [name, style] of [['style-a', 'Scandinavian'], ['style-b', 'Dark luxe'], ['style-c', 'Mediterranean']]) {
      const p = await open('home=villa-d&view=walk', 1000, 800);
      await p.evaluate((style) => { const w = window.walkthrough; w.showView({ view: 'walk', floor: 0, at: [1.0, 9.6, -53, -4] }); document.querySelector('#tab-style').click(); const btn = [...document.querySelectorAll('#styles button')].find(x => x.textContent.includes(style)); if (!btn) throw new Error('no style ' + [...document.querySelectorAll('#styles button')].map(x => x.textContent)); btn.click(); }, style);
      await p.waitForTimeout(3000); await shot(p, name); await p.close();
    }
  }
  if (only.includes('compare')) {
    const p = await b.newPage({ viewport: { width: 1400, height: 760 } });
    await p.goto('http://localhost:5173/studio.html?compare=villa-d,villa&fast', { waitUntil: 'load' });
    await p.waitForTimeout(25000);
    await p.screenshot({ path: `${OUT}/compare.png`, timeout: 180000 }); await p.close();
  }
  await b.close();
})();
