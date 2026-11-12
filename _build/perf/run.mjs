// Walk every slide in real GPU Chrome, like a person pressing →, and measure each flight:
//   fps / longest frame gap, checkerboarded (missing) tiles in flight and after arrival,
//   GPU tile-memory OOM, longest main-thread task, plus a screenshot on arrival.
// usage (from _build/perf, after pnpm install in _build):
//   node run.mjs <label> [deckUrl] [--from N] [--to M] [--no-shots]   → out/<label>/results.json + screenshots
//   node summary.cjs <label> [N worst]
// Opens a separate Chrome profile (perf/chrome-prof) on macOS Chrome; change executablePath elsewhere.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const label = args[0] || 'run';
const DECK = args[1] && !args[1].startsWith('--') ? args[1] : new URL('../../index.html', import.meta.url).href;
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? +args[i + 1] : d; };
const FROM = opt('--from', 0), TO = opt('--to', 9999), SHOTS = !args.includes('--no-shots');
const OUT = fileURLToPath(new URL(`./out/${label}/`, import.meta.url));
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: false, defaultViewport: null,
  userDataDir: fileURLToPath(new URL('./chrome-prof', import.meta.url)),
  args: ['--window-size=1920,1080', '--window-position=0,0', '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required'],
});
const [page] = await browser.pages();
await page.goto(DECK, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 2500));
const meta = await page.evaluate(() => {
  const st = [...document.querySelectorAll('#impress .step:not(.skip)')];
  const def = +document.getElementById('impress').dataset.transitionDuration || 1000;
  return { vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio, steps: st.map((s) => ({ id: s.id, scale: +(s.dataset.scale || 1), dur: +(s.dataset.transitionDuration || def) })) };
});
console.log(`viewport ${meta.vw}x${meta.vh} @${meta.dpr}x, ${meta.steps.length} steps`);

const CATS = ['cc', 'viz', 'gpu', 'benchmark', 'devtools.timeline', 'toplevel'];
const rows = [];
const start = Math.max(FROM, 1), end = Math.min(TO, meta.steps.length - 1);
if (start > 1) { await page.evaluate((i) => impress().goto(i, 0), start - 1); await new Promise((r) => setTimeout(r, 1500)); }
for (let i = start; i <= end; i++) {
  const st = meta.steps[i], prev = meta.steps[i - 1];
  await page.tracing.start({ categories: CATS });
  await page.evaluate(() => console.timeStamp('goto'));
  await page.evaluate((k) => impress().next(), i);
  // impress staggers zoom and pan by half the duration whenever both change
  const total = st.scale !== prev.scale ? st.dur * 1.5 : st.dur;
  await new Promise((r) => setTimeout(r, total + 1000));
  const ev = JSON.parse(Buffer.from(await page.tracing.stop()).toString()).traceEvents;
  const t0 = (ev.find((e) => e.name === 'TimeStamp' && e.args?.data?.message === 'goto') || ev[0]).ts;
  const t1 = t0 + total * 1000, t2 = t1 + 1000 * 1000;
  // frames actually put on screen
  const swaps = ev.filter((e) => e.name === 'Graphics.Pipeline.DrawAndSwap' && (e.ph === 'b' || e.ph === 'X')).map((e) => e.ts).sort((a, b) => a - b);
  const inFlight = swaps.filter((t) => t >= t0 && t <= t1);
  let gap = 0; for (let k = 1; k < inFlight.length; k++) gap = Math.max(gap, inFlight[k] - inFlight[k - 1]);
  const cb = ev.filter((e) => e.name === 'TileBasedLayerImpl::AppendQuads checkerboard');
  const miss = (a, b) => cb.filter((e) => e.ts >= a && e.ts < b).reduce((s, e) => s + (e.args?.missing_tile_count || 0), 0);
  const cbFrames = (a, b) => new Set(cb.filter((e) => e.ts >= a && e.ts < b).map((e) => Math.round(e.ts / 8000))).size;
  const oom = ev.filter((e) => e.name === 'TileManager::AssignGpuMemoryToTiles' && e.args && e.args.had_enough_memory_to_schedule_tiles_needed_now === false).length;
  const oom2 = ev.filter((e) => e.name === 'DidPrepareTiles' && e.args?.state?.did_oom_on_last_assign).length;
  const maxTiles = Math.max(0, ...ev.filter((e) => e.name === 'DidPrepareTiles').map((e) => e.args?.state?.tile_count || 0));
  const mainTid = (ev.find((e) => e.name === 'thread_name' && e.args?.name === 'CrRendererMain') || {}).tid;
  const main = ev.filter((e) => /RunTask/.test(e.name) && e.tid === mainTid && e.ph === 'X' && e.ts >= t0 - 50000 && e.ts <= t2);
  const longTask = Math.max(0, ...main.map((e) => e.dur || 0)) / 1000;
  const row = {
    i, id: st.id, from: prev.id, zoom: +(Math.max(st.scale, prev.scale) / Math.min(st.scale, prev.scale)).toFixed(1), dur: st.dur,
    fps: +(inFlight.length / (total / 1000)).toFixed(0), gapMs: +(gap / 1000).toFixed(0),
    missFlight: miss(t0, t1), cbFramesFlight: cbFrames(t0, t1), missAfter: miss(t1 + 250000, t2),
    oom: oom + oom2, maxTiles, longTaskMs: +longTask.toFixed(0),
  };
  if (SHOTS) await page.screenshot({ path: `${OUT}/${String(i).padStart(3, '0')}-${st.id}.jpg`, type: 'jpeg', quality: 55 });
  rows.push(row);
  console.log(JSON.stringify(row));
}
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ meta, rows }, null, 1));
await browser.close();
