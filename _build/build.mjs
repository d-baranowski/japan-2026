// Builds japan-presentation/index.html (impress.js) from data.json + media.json.
// usage: node build.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { feature } from 'topojson-client';

const OUT = process.argv[2];
const HERE = path.dirname(new URL(import.meta.url).pathname);
const data = JSON.parse(fs.readFileSync(path.join(HERE, 'data.json'), 'utf8'));
const media = JSON.parse(fs.readFileSync(path.join(HERE, 'media.json'), 'utf8'));

// ---------------------------------------------------------------- projection
const K = 20000, KY = K * 1.228, LON0 = 138.0, LAT0 = 35.8;
const P = (lat, lon) => [(lon - LON0) * K, (LAT0 - lat) * KY];
const BBOX = { lon0: 134.6, lon1: 141.4, lat0: 33.8, lat1: 37.6 };
const [VX0, VY0] = P(BBOX.lat1, BBOX.lon0), [VX1, VY1] = P(BBOX.lat0, BBOX.lon1);
const MAPSCALE = 10;
const r0 = (v) => Math.round(v);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (n) => n.toLocaleString('en-US');

const MODE = {
  train: { name: 'Train & bus', color: '#5aa2ff' },
  foot: { name: 'On foot', color: '#ff5a36' },
  bike: { name: 'By bike', color: '#2fd3a0' },
  flight: { name: 'Flight', color: '#f4c44e' },
};
const DAYMODE = {};
const setMode = (from, to, m) => { for (let d = from; d <= to; d++) DAYMODE[d] = m; };
// day index: 0 = 5 Oct ... 27 = 1 Nov
setMode(0, 27, 'train'); setMode(0, 1, 'flight'); DAYMODE[3] = 'foot'; setMode(8, 13, 'foot');
setMode(15, 19, 'bike'); DAYMODE[27] = 'flight';
const T0 = Date.UTC(2026, 9, 5);
const tOf = (dt) => { // '2026:10:07 12:08:00' or '2026-10-07T12:08'
  const m = dt.match(/(\d{4})\D(\d\d)\D(\d\d)\D(\d\d):(\d\d)/);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
};
const dayIdx = (dt) => Math.floor((tOf(dt) - T0) / 864e5);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dateLabel = (dt) => { const d = new Date(tOf(dt)); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const isoDate = (dt) => new Date(tOf(dt)).toISOString().slice(0, 10);

// ---------------------------------------------------------------- map geometry
const inView = (ring) => ring.some(([lon, lat]) => lon > BBOX.lon0 - 0.5 && lon < BBOX.lon1 + 0.5 && lat > BBOX.lat0 - 0.5 && lat < BBOX.lat1 + 0.5);
// Douglas-Peucker in canvas px: 1 canvas px = 1 screen px at photo zoom, so 18 px is invisible at the overview
const simplify = (pts, tol) => {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let idx = -1, md = tol;
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / L; if (d > md) { md = d; idx = i; } }
    if (idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
};
let ptsIn = 0, ptsOut = 0;
const ringPath = (ring) => {
  const xy = ring.map(([lon, lat]) => P(lat, lon));
  // closed ring: split at the point farthest from the start so both halves are open polylines
  let far = 0, fd = -1;
  xy.forEach((p, i) => { const d = Math.hypot(p[0] - xy[0][0], p[1] - xy[0][1]); if (d > fd) { fd = d; far = i; } });
  const s = (far > 0 ? [...simplify(xy.slice(0, far + 1), 18), ...simplify(xy.slice(far), 18).slice(1)] : xy).map((p) => p.map(r0));
  ptsIn += xy.length; ptsOut += s.length;
  if (s.length < 3) return '';
  return 'M' + s.map((p) => p.join(' ')).join('L') + 'Z';
};
const polysOf = (geom) => geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
const topo = JSON.parse(fs.readFileSync(path.join(HERE, 'node_modules/world-atlas/countries-10m.json'), 'utf8'));
const japan = feature(topo, topo.objects.countries).features.find((f) => f.id === '392');
let landD = '';
for (const poly of polysOf(japan.geometry)) for (const ring of poly) if (inView(ring)) landD += ringPath(ring);
const lakes = JSON.parse(fs.readFileSync(path.join(HERE, 'ne_10m_lakes.geojson'), 'utf8'));
let lakeD = '';
for (const f of lakes.features) for (const poly of polysOf(f.geometry)) {
  if (!poly[0].every(([lon, lat]) => lon > BBOX.lon0 && lon < BBOX.lon1 && lat > BBOX.lat0 && lat < BBOX.lat1)) continue;
  for (const ring of poly) lakeD += ringPath(ring);
}

// ---------------------------------------------------------------- route legs
const LEGS = [
  ['depart', 'train', [[35.77, 140.39], [35.73, 140.0], [35.695, 139.70]]],
  ['tokyo', 'train', [[35.695, 139.70], [35.686, 139.71], [35.671, 139.703], [35.676, 139.699], [35.65, 139.79]]],
  ['takao', 'train', [[35.69, 139.70], [35.66, 139.45], [35.632, 139.27]]],
  ['takao', 'foot', [[35.632, 139.27], [35.6354, 139.2616], [35.6299, 139.2533], [35.625, 139.243], [35.6298, 139.2208], [35.6287, 139.2588], [35.632, 139.27]]],
  ['takao', 'train', [[35.632, 139.27], [35.66, 139.45], [35.69, 139.70], [35.698, 139.773]]],
  ['nikko', 'train', [[35.71, 139.80], [36.06, 139.68], [36.50, 139.72], [36.75, 139.62], [36.745, 139.55], [36.738, 139.50]]],
  ['nikko', 'train', [[36.738, 139.50], [36.753, 139.60], [36.75, 139.62], [36.50, 139.72], [36.06, 139.68], [35.72, 139.71]]],
  ['kofu', 'train', [[35.69, 139.70], [35.655, 139.34], [35.61, 138.94], [35.667, 138.569], [35.73, 138.57], [35.667, 138.569]]],
  ['alps', 'train', [[35.667, 138.569], [35.635, 138.345]]],
  ['alps', 'foot', [[35.635, 138.345], [35.6384, 138.3364], [35.665, 138.320], [35.6822, 138.3166], [35.690, 138.305], [35.697, 138.301], [35.706, 138.297], [35.7111, 138.2984], [35.7106, 138.2963], [35.7098, 138.2878], [35.6939, 138.2635], [35.6925, 138.2594], [35.676, 138.261], [35.686, 138.2524], [35.6843, 138.2434], [35.6827, 138.2398], [35.6745, 138.2386], [35.665, 138.235], [35.6615, 138.2299], [35.646, 138.228], [35.6615, 138.2299], [35.6561, 138.2082], [35.6708, 138.2013], [35.6748, 138.2032], [35.705, 138.215], [35.735, 138.233]]],
  ['alps', 'train', [[35.735, 138.233], [35.785, 138.125]]],
  ['kyoto1', 'train', [[35.785, 138.125], [35.83, 137.95], [35.50, 137.80], [35.17, 136.88], [34.985, 135.758], [35.004, 135.778]]],
  ['saba', 'bike', [[35.004, 135.778], [35.05, 135.80], [35.12, 135.835], [35.20, 135.86], [35.33, 135.905], [35.454, 135.918], [35.50, 135.85], [35.52, 135.80], [35.495, 135.746]]],
  ['wakasa', 'bike', [[35.495, 135.746], [35.53, 135.67], [35.52, 135.62], [35.49, 135.57]]],
  ['miyama', 'bike', [[35.49, 135.57], [35.44, 135.56], [35.38, 135.59], [35.315, 135.62]]],
  ['kameoka', 'bike', [[35.315, 135.62], [35.22, 135.57], [35.10, 135.55], [35.01, 135.58]]],
  ['kyoto2', 'train', [[35.01, 135.58], [34.985, 135.758], [34.967, 135.773], [35.016, 135.707], [35.014, 135.748]]],
  ['boso', 'train', [[35.014, 135.748], [34.985, 135.758], [35.17, 136.88], [34.97, 138.39], [35.25, 139.15], [35.68, 139.767], [35.715, 139.797]]],
  ['boso', 'train', [[35.715, 139.797], [35.68, 139.767], [35.61, 140.11], [35.38, 139.92], [35.25, 139.87]]],
  ['home', 'train', [[35.25, 139.87], [35.38, 139.92], [35.61, 140.11], [35.68, 139.767]]],
];
const CH_ORDER = data.chapters.map((c) => c.id);
const chIdx = (id) => CH_ORDER.indexOf(id);
const hav = ([la1, lo1], [la2, lo2]) => {
  const R = 6371, t = Math.PI / 180, a = Math.sin((la2 - la1) * t / 2) ** 2 + Math.cos(la1 * t) * Math.cos(la2 * t) * Math.sin((lo2 - lo1) * t / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};
const KM = { train: 0, foot: 0, bike: 0 };
for (const [, m, pts] of LEGS) for (let i = 1; i < pts.length; i++) KM[m] += hav(pts[i - 1], pts[i]);
const KRK = [50.06, 19.94], WAW = [52.17, 20.97], NRT = [35.77, 140.39], TYO = [35.68, 139.77];
const FLOWN = hav(KRK, NRT) + hav(TYO, WAW);

const polyLen = (pts) => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; };
let legsSvg = '', ghostSvg = '';
LEGS.forEach(([ch, m, pts]) => {
  const xy = pts.map(([la, lo]) => P(la, lo).map(r0));
  const d = 'M' + xy.map((p) => p.join(' ')).join('L');
  const len = Math.ceil(polyLen(xy));
  ghostSvg += `<path class="ghost m-${m}" d="${d}"/>`;
  legsSvg += `<path class="leg m-${m}" data-ch="${chIdx(ch)}" style="--len:${len}" d="${d}"/>`;
});

// photo GPS dots
const dots = media.fixes.filter((f) => f.lat > BBOX.lat0 && f.lat < BBOX.lat1 && f.lon > BBOX.lon0 && f.lon < BBOX.lon1)
  .map((f) => { const [x, y] = P(f.lat, f.lon).map(r0); return `<circle class="pdot" data-day="${dayIdx(f.dt)}" cx="${x}" cy="${y}"/>`; }).join('');

// labels
const LABELS = [
  ['Tokyo', '東京', 35.68, 139.77, 'city'], ['Kyoto', '京都', 35.01, 135.77, 'city'], ['Nikkō', '日光', 36.75, 139.60, 'town'],
  ['Kōfu', '甲府', 35.66, 138.57, 'town'], ['Obama', '小浜', 35.495, 135.746, 'town'], ['Kameoka', '亀岡', 35.01, 135.58, 'town left'],
  ['Narita', '成田', 35.77, 140.39, 'town'], ['Futtsu', '富津', 35.30, 139.86, 'town'], ['Miyama', '美山', 35.315, 135.62, 'town'],
  ['Ina', '伊那', 35.83, 137.95, 'town left'], ['Nagoya', '名古屋', 35.17, 136.88, 'dim'], ['Osaka', '大阪', 34.69, 135.50, 'dim'],
  ['Yokohama', '横浜', 35.44, 139.64, 'dim'], ['Shizuoka', '静岡', 34.97, 138.39, 'dim'], ['Mt Takao', '高尾山', 35.625, 139.243, 'town'],
];
const WATER = [['Sea of Japan', '日本海', 36.25, 135.75], ['Pacific Ocean', '太平洋', 34.05, 138.2], ['Tokyo Bay', '東京湾', 35.47, 139.87],
  ['Lake Biwa', '琵琶湖', 35.27, 136.10], ['Wakasa Bay', '若狭湾', 35.70, 135.95], ['Sagami Bay', '相模湾', 35.16, 139.33], ['Suruga Bay', '駿河湾', 34.85, 138.62]];
const PEAKS = [['Fuji', '富士山', 3776, 35.3606, 138.7274], ['Kitadake', '北岳', 3193, 35.6745, 138.2386]];
let labelsSvg = '';
for (const [en, jp, la, lo, k] of LABELS) {
  const [x, y] = P(la, lo).map(r0);
  labelsSvg += `<g class="place ${k}" transform="translate(${x} ${y})"><circle class="pd"/><text class="pl">${esc(en)}<tspan class="jp"> ${jp}</tspan></text></g>`;
}
for (const [en, jp, la, lo] of WATER) {
  const [x, y] = P(la, lo).map(r0);
  labelsSvg += `<text class="water" x="${x}" y="${y}">${esc(en)}<tspan class="jp" dx="0.4em">${jp}</tspan></text>`;
}
for (const [en, jp, h, la, lo] of PEAKS) {
  const [x, y] = P(la, lo).map(r0);
  labelsSvg += `<g class="peak${en === 'Kitadake' ? ' left' : ''}" transform="translate(${x} ${y})"><text class="tri" text-anchor="middle" dy=".35em">▲</text><text class="pk" dy=".35em">${esc(en)} ${jp}<tspan class="ph" dx="0.4em">${fmt(h)} m</tspan></text></g>`;
}
let grat = '';
for (let lo = 135; lo <= 141; lo++) { const [x] = P(35, lo); grat += `<line class="grat" x1="${r0(x)}" y1="${r0(VY0)}" x2="${r0(x)}" y2="${r0(VY1)}"/><text class="gl" x="${r0(x)}" y="${r0(VY1)}">${lo}°E</text>`; }
for (let la = 34; la <= 37; la++) { const [, y] = P(la, 138); grat += `<line class="grat" x1="${r0(VX0)}" y1="${r0(y)}" x2="${r0(VX1)}" y2="${r0(y)}"/><text class="gl" x="${r0(VX0)}" y="${r0(y)}">${la}°N</text>`; }

const mapW = VX1 - VX0, mapH = VY1 - VY0;
const mapSvg = `<svg class="mapsvg" width="${r0(mapW / MAPSCALE)}" height="${r0(mapH / MAPSCALE)}" viewBox="${r0(VX0)} ${r0(VY0)} ${r0(mapW)} ${r0(mapH)}">
<g>${grat}</g><path class="land" d="${landD}"/><path class="lake" d="${lakeD}"/>
<g class="ghosts">${ghostSvg}</g><g class="legs">${legsSvg}</g><g class="dots">${dots}</g><g class="labels">${labelsSvg}</g></svg>`;

// flight arcs (world step)
const KR = [-150000, -60000], WA = [-146000, -66000];
const NR = P(...NRT), TY = P(...TYO);
const arc = (a, b, lift) => { const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2 - lift; return { d: `M${r0(a[0])} ${r0(a[1])}Q${r0(mx)} ${r0(my)} ${r0(b[0])} ${r0(b[1])}`, mid: [0.25 * a[0] + 0.5 * mx + 0.25 * b[0], 0.25 * a[1] + 0.5 * my + 0.25 * b[1]] }; };
const arcOut = arc(KR, NR, 52000), arcBack = arc(TY, WA, -16000);
const WX0 = -175000, WY0 = -115000, WX1 = 70000, WY1 = 30000, WSCALE = 25;
const worldSvg = `<svg class="worldsvg" width="${(WX1 - WX0) / WSCALE}" height="${(WY1 - WY0) / WSCALE}" viewBox="${WX0} ${WY0} ${WX1 - WX0} ${WY1 - WY0}">
<path class="flight leg m-flight" data-ch="${chIdx('depart')}" style="--len:${r0(polyLen([KR, arcOut.mid, NR]) * 1.15)}" d="${arcOut.d}"/>
<path class="flight leg m-flight" data-ch="${chIdx('home')}" style="--len:${r0(polyLen([TY, arcBack.mid, WA]) * 1.15)}" d="${arcBack.d}"/>
<g class="place city" transform="translate(${KR[0]} ${KR[1]})"><circle class="pd"/><text class="pl">Kraków</text></g>
<g class="place city" transform="translate(${WA[0]} ${WA[1]})"><circle class="pd"/><text class="pl">Warsaw</text></g>
</svg>`;

// ---------------------------------------------------------------- step helpers
const steps = [];
const add = (s) => { steps.push(s); return s; };
const fit = (w, h, mw, mh) => { const s = Math.min(mw / w, mh / h); return [Math.round(w * s), Math.round(h * s)]; };
const seeded = (i) => { const x = Math.sin(i * 9301 + 49297) * 233280; return x - Math.floor(x); };

function cardHtml(it, ch) {
  const ids = it.p !== undefined ? (Array.isArray(it.p) ? it.p : [it.p]) : [];
  let inner = '', w = 0, h = 0, dt;
  if (it.v) {
    const v = media.videos[it.v]; dt = v.dt;
    const [vw, vh] = fit(v.w, v.h, 1180, 800);
    inner = `<div class="ph" style="width:${vw}px;height:${vh}px"><video playsinline loop preload="none" poster="videos/${it.v}.jpg" data-src="videos/${it.v}.mp4"></video><span class="play">▶ video</span></div>`;
    w = vw; h = vh;
  } else {
    const box = ids.length > 1 ? [820, 740] : [1180, 790];
    const parts = ids.map((i) => { const m = media.media[i]; const [pw, ph] = fit(m.w, m.h, ...box); h = Math.max(h, ph); return { i, pw, ph }; });
    dt = media.media[ids[0]].dt;
    // equalise heights in spreads
    if (parts.length > 1) for (const p of parts) { const s = h / p.ph; p.pw = Math.round(p.pw * s); p.ph = h; }
    if (parts.length > 1) { const tw = parts.reduce((a, p) => a + p.pw, 0) + 20 * (parts.length - 1); if (tw > 1700) { const s = 1700 / tw; parts.forEach((p) => { p.pw = Math.round(p.pw * s); p.ph = Math.round(p.ph * s); }); h = parts[0].ph; } }
    w = parts.reduce((a, p) => a + p.pw, 0) + 20 * (parts.length - 1);
    inner = parts.map((p) => `<div class="ph" style="width:${p.pw}px;height:${p.ph}px"><img src="photos/thumb/p${String(p.i).padStart(3, '0')}.jpg" data-thumb="photos/thumb/p${String(p.i).padStart(3, '0')}.jpg" data-full="photos/full/p${String(p.i).padStart(3, '0')}.jpg" alt="${esc(it.cap)}"></div>`).join('');
  }
  if (it.alt) inner = inner.replace('<div class="ph" style="', `<div class="ph" data-alt="▲ ${fmt(it.alt)} m" style="`);
  const t = new Date(tOf(dt));
  const meta = `${WD[t.getUTCDay()]} ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} · ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}${it.alt ? ` · ${fmt(it.alt)} m` : ''}`;
  const mode = ch.alps ? 'foot' : ch.bike ? 'bike' : ch.id === 'takao' && it.p !== 135 && !(Array.isArray(it.p) && it.p.includes(135)) ? 'foot' : (ch.id === 'depart' ? 'flight' : 'train');
  const html = `<figure class="polaroid tape-${mode}" style="--tilt:${((seeded(steps.length) - 0.5) * 3).toFixed(2)}deg"><div class="photos">${inner}</div><figcaption><span class="cap">${esc(it.cap)}</span><span class="meta">${esc(it.place || '')} · ${meta}</span></figcaption></figure>`;
  return { html, w: w + 44, h: h + 22 + 118, dt, mode };
}

function placeAlong(ptsLatLon, n, zig) {
  const xy = ptsLatLon.map(([la, lo]) => P(la, lo));
  const segs = []; let L = 0;
  for (let i = 1; i < xy.length; i++) { const l = Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]); segs.push([xy[i - 1], xy[i], l, L]); L += l; }
  const out = [];
  for (let k = 0; k < n; k++) {
    const s = n === 1 ? L / 2 : L * k / (n - 1);
    const seg = segs.find((g) => s <= g[3] + g[2] + 1e-6) || segs[segs.length - 1];
    const f = seg[2] ? (s - seg[3]) / seg[2] : 0;
    const x = seg[0][0] + (seg[1][0] - seg[0][0]) * f, y = seg[0][1] + (seg[1][1] - seg[0][1]) * f;
    const nx = -(seg[1][1] - seg[0][1]) / seg[2], ny = (seg[1][0] - seg[0][0]) / seg[2];
    const o = (k % 2 ? 1 : -1) * zig;
    out.push([x + nx * o, y + ny * o]);
  }
  return { pts: out, L };
}

// ---------------------------------------------------------------- build steps
const [OVX, OVY] = P(35.55, 137.75);
const OVSCALE = 62;
add({ id: 'overview', cls: 'step title-step', x: OVX, y: OVY, scale: OVSCALE, ch: -1, day: -1, html: '__INTRO__' });

const anchors = {
  tokyo: [35.695, 139.70], takao: [35.66, 139.30], nikko: [36.75, 139.60], kofu: [35.667, 138.569], alps: [35.60, 138.25],
  kyoto1: [35.004, 135.778], saba: [35.12, 135.835], wakasa: [35.56, 135.70], miyama: [35.315, 135.62], kameoka: [35.01, 135.58],
  kyoto2: [34.985, 135.758], boso: [35.45, 139.88], home: [35.68, 139.767],
};
let chapterNo = 0;
const layoutReport = [];
for (const ch of data.chapters) {
  const ci = chIdx(ch.id); chapterNo++;
  const firstDt = ch.items[0].p !== undefined ? media.media[Array.isArray(ch.items[0].p) ? ch.items[0].p[0] : ch.items[0].p].dt : media.videos[ch.items[0].v].dt;
  const chHtml = `<div class="ch-inner"><div class="ch-num">${String(chapterNo).padStart(2, '0')}</div><div class="ch-jp">${ch.jp}</div><div class="ch-en">${esc(ch.en)}</div><div class="ch-dates">${esc(ch.dates)} · Day ${dayIdx(firstDt) + 1}</div><p class="ch-sub">${esc(ch.sub)}</p></div>`;
  if (ch.id === 'depart') {
    add({ id: 'ch-depart', cls: 'step chapter', x: KR[0] + 3500, y: KR[1] - 5200, scale: 3, ch: ci, dt: firstDt, place: 'Kraków', html: chHtml });
    const c1 = cardHtml(ch.items[0], ch);
    add({ id: 'c-depart-0', cls: 'step card', x: KR[0] + 1500, y: KR[1] + 1800, scale: 1, rot: -3, ch: ci, dt: c1.dt, place: ch.items[0].place, html: c1.html });
    add({ id: 'fly-out', cls: 'step flight-step', x: (KR[0] + NR[0]) / 2, y: (KR[1] + NR[1]) / 2 - 26000, scale: 105, ch: ci, dt: c1.dt, place: 'Kraków → Tokyo', html: `<div class="fly-inner"><div class="fly-big">✈</div><div class="fly-t">Kraków → Tokyo</div><div class="fly-s">≈ ${fmt(Math.round(hav(KRK, NRT) / 100) * 100)} km in a straight line · one night in the air</div></div>`, dur: 2200 });
    const c2 = cardHtml(ch.items[1], ch);
    add({ id: 'c-depart-1', cls: 'step card', x: arcOut.mid[0] + 60000, y: arcOut.mid[1] + 20000, scale: 4, rot: 4, ch: ci, dt: c2.dt, place: ch.items[1].place, html: c2.html, dur: 2200 });
    const c3 = cardHtml(ch.items[2], ch);
    add({ id: 'c-depart-2', cls: 'step card', x: NR[0] + 600, y: NR[1] + 1700, scale: 1, rot: 2, ch: ci, dt: c3.dt, place: ch.items[2].place, html: c3.html, dur: 2400 });
    continue;
  }
  const [ax, ay] = P(...anchors[ch.id]);
  const chStep = add({ id: `ch-${ch.id}`, cls: 'step chapter', x: ax, y: ay, scale: 3, ch: ci, dt: firstDt, place: ch.en, html: chHtml, dur: 2000 });
  if (ch.id === 'alps') {
    const [px, py] = P(35.40, 138.62);
    add({ id: 'viz-alps', cls: 'step viz', x: px, y: py, scale: 1.6, ch: ci, dt: firstDt, place: 'Southern Alps', html: '__ALPS__' });
  }
  if (ch.id === 'home') {
    // last items: Tokyo cards, then the flight back and Warsaw
  }
  const items = ch.id === 'home' ? ch.items.slice(0, 3) : ch.items;
  const zig = ch.alps ? 700 : 760;
  const { pts, L } = placeAlong(ch.path, items.length, zig);
  layoutReport.push(`${ch.id}: ${items.length} items, path ${Math.round(L)}px, spacing ${Math.round(L / Math.max(1, items.length - 1))}`);
  items.forEach((it, k) => {
    const c = cardHtml(it, ch);
    const s = { id: `c-${ch.id}-${k}`, cls: 'step card', x: pts[k][0], y: pts[k][1], scale: 1, rot: Math.round((seeded(k + ci * 31) - 0.5) * 14), ch: ci, dt: c.dt, place: it.place, html: c.html, w: c.w, h: c.h };
    if (it.v) s.cls += ' video-step';
    if (ch.alps) s.rot = Math.round((seeded(k) - 0.5) * 10);
    add(s);
  });
  if (ch.id === 'home') {
    const last = ch.items[3];
    add({ id: 'fly-back', cls: 'step flight-step', x: (TY[0] + WA[0]) / 2, y: (TY[1] + WA[1]) / 2 + 4000, scale: 105, ch: ci, dt: '2026:10:31 22:00:00', place: 'Tokyo → Warsaw', html: `<div class="fly-inner"><div class="fly-big">✈</div><div class="fly-t">Tokyo → Warsaw</div><div class="fly-s">overnight · ≈ ${fmt(Math.round(hav(TYO, WAW) / 100) * 100)} km</div></div>`, dur: 2200 });
    const c = cardHtml(last, ch);
    add({ id: 'c-home-3', cls: 'step card', x: WA[0] + 1600, y: WA[1] + 1800, scale: 1, rot: -2, ch: ci, dt: c.dt, place: last.place, html: c.html, dur: 2600 });
  }
}

// numbers section: in the Pacific south-east of Bōsō
const [NX, NY] = P(34.30, 139.55);
add({ id: 'route', cls: 'step title-step', x: OVX, y: OVY, scale: OVSCALE, ch: 99, day: 99, place: 'The whole route', html: '__ROUTE__', dur: 2600 });
add({ id: 'viz-alt', cls: 'step viz', x: NX, y: NY, scale: 1.6, ch: 99, day: 99, place: 'By the numbers', html: '__ALT__', dur: 2400 });
add({ id: 'viz-photos', cls: 'step viz', x: NX + 3600, y: NY + 400, scale: 1.6, ch: 99, day: 99, place: 'By the numbers', html: '__PHOTOS__' });
add({ id: 'viz-km', cls: 'step viz', x: NX + 7200, y: NY - 200, scale: 1.6, ch: 99, day: 99, place: 'By the numbers', html: '__KM__' });
add({ id: 'thanks', cls: 'step title-step', x: OVX, y: OVY, scale: OVSCALE, ch: 99, day: 99, place: 'ありがとう', html: '__THANKS__', dur: 2600 });

// overlap report for cards
const cards = steps.filter((s) => s.w);
for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
  const a = cards[i], b = cards[j];
  const ox = (a.w + b.w) / 2 - Math.abs(a.x - b.x), oy = (a.h + b.h) / 2 - Math.abs(a.y - b.y);
  if (ox > 60 && oy > 60 && !(a.z || b.z)) layoutReport.push(`OVERLAP ${a.id} × ${b.id} (${Math.round(ox)}×${Math.round(oy)})`);
}

// ---------------------------------------------------------------- charts
const C = { text: '#eef0f5', text2: '#b4bccd', muted: '#7f89a0', grid: '#243049', surface: '#121a2c', night: '#0c1322' };
const ticksX = (t0, t1, x, labels) => labels.map(([t, l]) => `<line class="gx" x1="${x(t)}" x2="${x(t)}" y1="0" y2="6"/><text class="axl" x="${x(t)}" y="28" text-anchor="middle">${l}</text>`).join('');

function chartAltitude() {
  const W = 1700, H = 700, ml = 96, mr = 250, mt = 30, mb = 64, pw = W - ml - mr, ph = H - mt - mb;
  const t0 = T0, t1 = Date.UTC(2026, 10, 2);
  const x = (t) => ml + (t - t0) / (t1 - t0) * pw, y = (a) => mt + ph - a / 4000 * ph;
  let g = '';
  // context bands
  const band = (d0, d1, m, label) => { const a = x(T0 + d0 * 864e5), b = x(T0 + d1 * 864e5); return `<rect x="${a}" y="${mt}" width="${b - a}" height="${ph}" fill="${MODE[m].color}" opacity=".09"/><text class="band" x="${(a + b) / 2}" y="${mt + 26}" text-anchor="middle">${label}</text>`; };
  g += band(8, 14, 'foot', 'Southern Alps') + band(15, 20, 'bike', 'On bikes') + band(3, 4, 'foot', 'Takao');
  for (const a of [0, 1000, 2000, 3000, 4000]) g += `<line class="grid" x1="${ml}" x2="${ml + pw}" y1="${y(a)}" y2="${y(a)}"/><text class="axl" x="${ml - 14}" y="${y(a) + 6}" text-anchor="end">${a ? fmt(a) : '0'}${a === 4000 ? ' m' : ''}</text>`;
  for (const [a, l1, l2] of [[3776, 'Mt Fuji 3,776 m', 'seen, not climbed'], [2499, 'Rysy 2,499 m', 'highest in Poland']]) g += `<line class="ref" x1="${ml}" x2="${ml + pw}" y1="${y(a)}" y2="${y(a)}"/><text class="refl" x="${ml + pw + 14}" y="${y(a) - 4}">${l1}<tspan class="refs" x="${ml + pw + 14}" dy="24">${l2}</tspan></text>`;
  const xl = [[0, '5 Oct'], [5, '10 Oct'], [10, '15 Oct'], [15, '20 Oct'], [20, '25 Oct'], [25, '30 Oct'], [27, '1 Nov']].map(([d, l]) => [T0 + d * 864e5, l]);
  g += `<g transform="translate(0 ${mt + ph})">${ticksX(t0, t1, x, xl)}</g>`;
  for (const f of media.fixes) {
    const m = DAYMODE[dayIdx(f.dt)] || 'train';
    g += `<circle class="dot" cx="${x(tOf(f.dt)).toFixed(1)}" cy="${y(f.alt).toFixed(1)}" r="6" fill="${MODE[m].color}"><title>${dateLabel(f.dt)} ${f.dt.slice(11, 16)} · ${fmt(f.alt)} m (GPS)</title></circle>`;
  }
  const SUMMITS = [['2026-10-14T12:55', 2841, 'Kannon-dake'], ['2026-10-15T09:05', 2779, 'Takamine'], ['2026-10-16T10:14', 3011, 'Kata-no-koya'], ['2026-10-16T11:37', 3193, 'Kitadake'], ['2026-10-17T07:52', 3190, 'Ainodake']];
  for (const [t, a, n] of SUMMITS) { const cx = x(tOf(t)), cy = y(a); g += `<path class="tri-m" d="M${cx} ${cy - 11}L${cx + 10} ${cy + 7}L${cx - 10} ${cy + 7}Z" fill="${MODE.foot.color}"><title>${n} · ${fmt(a)} m</title></path>`; }
  const kx = x(tOf('2026-10-16T11:37')), ky = y(3193);
  g += `<text class="anno strong" x="${kx + 16}" y="${ky - 14}">Kitadake 3,193 m</text>`;
  g += `<text class="anno" x="${x(tOf('2026-10-10T12:00'))}" y="${y(1340) - 20}" text-anchor="middle">Nikkō lakes</text>`;
  g += `<text class="anno" x="${x(tOf('2026-10-08T12:00'))}" y="${y(714) - 20}" text-anchor="middle">Mt Takao</text>`;
  g += `<text class="anno" x="${x(tOf('2026-10-21T12:00'))}" y="${y(420) - 18}" text-anchor="middle">sea level-ish</text>`;
  const legend = `<div class="legend">${['train', 'foot', 'bike'].map((m) => `<span><i style="background:${MODE[m].color}"></i>${MODE[m].name}</span>`).join('')}<span><b class="tri-k" style="border-bottom-color:${MODE.foot.color}"></b>Summit sign</span></div>`;
  return `<div class="panel"><header><h2>How high we went</h2><p>Every photo with GPS, by altitude — <strong>four days higher than anywhere in Poland</strong></p>${legend}</header><svg class="chart" viewBox="0 0 ${W} ${H}">${g}</svg><footer>Altitude straight from the phone's GPS (±50 m). Triangles: heights from summit signs and the map.</footer></div>`;
}

function chartAlps() {
  const W = 1700, H = 700, ml = 96, mr = 40, mt = 50, mb = 64, pw = W - ml - mr, ph = H - mt - mb;
  const t0 = Date.UTC(2026, 9, 13, 8), t1 = Date.UTC(2026, 9, 18, 8);
  const x = (t) => ml + (t - t0) / (t1 - t0) * pw, y = (a) => mt + ph - (a - 1200) / (3400 - 1200) * ph;
  const PTS = [
    ['2026-10-13T10:29', 1434, 'gps', 'Yashajin trailhead', 'below'], ['2026-10-13T11:49', 1840, 'gps', 'Yashajin Pass', 'right'], ['2026-10-13T16:44', 2482, 'gps', 'Minami-Omuro hut', 'hut'],
    ['2026-10-14T07:00', 2482, 'hut'], ['2026-10-14T12:55', 2841, 'map', 'Kannon-dake 2,841', 'above'], ['2026-10-14T14:59', 2400, 'map', 'Hōō hut', 'hut'],
    ['2026-10-15T05:30', 2400, 'hut'], ['2026-10-15T06:48', 2754, 'gps', 'Jizō-dake', 'left'], ['2026-10-15T07:57', 2810, 'gps'], ['2026-10-15T09:05', 2824, 'gps', 'Takamine', 'above'],
    ['2026-10-15T15:33', 1931, 'gps', 'down to Hirogawara', 'below'], ['2026-10-15T17:44', 2282, 'gps', 'Shirane-Oike hut', 'hut'],
    ['2026-10-16T07:30', 2282, 'hut'], ['2026-10-16T09:03', 2815, 'gps'], ['2026-10-16T09:24', 2898, 'gps'], ['2026-10-16T09:50', 2965, 'gps'], ['2026-10-16T10:14', 3011, 'sign'],
    ['2026-10-16T11:37', 3193, 'sign', 'Kitadake 3,193 m', 'top'], ['2026-10-16T13:14', 2900, 'map', 'Kitadake-sansō', 'hut'],
    ['2026-10-17T04:45', 2900, 'hut'], ['2026-10-17T05:30', 3000, 'gps'], ['2026-10-17T07:52', 3190, 'sign', 'Ainodake 3,190 m', 'top'], ['2026-10-17T10:57', 2614, 'gps'], ['2026-10-17T12:36', 2305, 'gps'],
    ['2026-10-17T14:43', 2062, 'gps', 'Ryōmata hut', 'hut'], ['2026-10-18T05:25', 2062, 'hut'],
  ].map(([t, a, k, l, pos]) => ({ t: tOf(t), a, k, l, pos }));
  let g = '';
  for (let d = 13; d <= 17; d++) { const a = x(Date.UTC(2026, 9, d, 18)), b = x(Math.min(t1, Date.UTC(2026, 9, d + 1, 5))); g += `<rect x="${a}" y="${mt}" width="${b - a}" height="${ph}" fill="${C.night}"/><text class="moon" x="${(a + b) / 2}" y="${mt + ph - 16}" text-anchor="middle">☾</text>`; }
  for (let d = 13; d <= 17; d++) { const a = x(Math.max(t0, Date.UTC(2026, 9, d, 5))), b = x(Date.UTC(2026, 9, d, 18)); g += `<text class="dayl" x="${(a + b) / 2}" y="${mt - 18}" text-anchor="middle">Day ${d - 12} · ${d} Oct</text>`; }
  for (const a of [1500, 2000, 2500, 3000]) g += `<line class="grid" x1="${ml}" x2="${ml + pw}" y1="${y(a)}" y2="${y(a)}"/><text class="axl" x="${ml - 14}" y="${y(a) + 6}" text-anchor="end">${fmt(a)}</text>`;
  g += `<line class="ref" x1="${ml}" x2="${ml + pw}" y1="${y(2499)}" y2="${y(2499)}"/><text class="refl" x="${ml + pw - 6}" y="${y(2499) - 12}" text-anchor="end">Rysy 2,499 m — above this line = higher than anywhere in Poland</text>`;
  // area + line (day segments solid, night segments faint)
  const area = `M${x(PTS[0].t)} ${y(1200)}` + PTS.map((p) => `L${x(p.t).toFixed(1)} ${y(p.a).toFixed(1)}`).join('') + `L${x(PTS[PTS.length - 1].t)} ${y(1200)}Z`;
  g += `<defs><linearGradient id="altg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${MODE.foot.color}" stop-opacity=".55"/><stop offset="1" stop-color="${MODE.foot.color}" stop-opacity=".02"/></linearGradient></defs><path d="${area}" fill="url(#altg)"/>`;
  for (let i = 1; i < PTS.length; i++) { const a = PTS[i - 1], b = PTS[i]; const night = b.k === 'hut'; g += `<line x1="${x(a.t).toFixed(1)}" y1="${y(a.a).toFixed(1)}" x2="${x(b.t).toFixed(1)}" y2="${y(b.a).toFixed(1)}" stroke="${MODE.foot.color}" stroke-width="${night ? 2 : 4}" stroke-linecap="round" ${night ? 'stroke-dasharray="2 8" opacity=".7"' : ''}/>`; }
  for (const p of PTS) {
    const cx = x(p.t), cy = y(p.a);
    if (p.k === 'gps') g += `<circle class="dot" cx="${cx}" cy="${cy}" r="7" fill="${MODE.foot.color}"><title>${fmt(p.a)} m (GPS)</title></circle>`;
    if (p.k === 'sign' || p.k === 'map') g += `<path class="tri-m" d="M${cx} ${cy - 13}L${cx + 12} ${cy + 8}L${cx - 12} ${cy + 8}Z" fill="#fff"><title>${p.l || ''} ${fmt(p.a)} m</title></path>`;
    if (p.l) {
      const dy = p.pos === 'below' ? 34 : p.pos === 'hut' ? 34 : p.pos === 'right' || p.pos === 'left' ? 7 : -24;
      const dx = p.pos === 'right' ? 16 : p.pos === 'left' ? -16 : 0, anc = p.pos === 'right' ? 'start' : p.pos === 'left' ? 'end' : 'middle';
      g += `<text class="${p.pos === 'top' ? 'anno strong' : p.pos === 'hut' ? 'hutl' : 'anno'}" x="${cx + dx}" y="${cy + dy}" text-anchor="${anc}">${p.pos === 'hut' ? '⌂ ' : ''}${esc(p.l)}</text>`;
    }
  }
  g += `<text class="anno" x="${x(Date.UTC(2026, 9, 18, 6, 40))}" y="${y(2062) - 26}" text-anchor="end">Day 6: forest road, then the bus down →</text>`;
  return `<div class="panel"><header><h2>Southern Alps, hut to hut</h2><p>13–18 Oct · Hōō Sanzan → Kitadake → Ainodake · ${MODE.foot.name.toLowerCase()} the whole way</p></header><svg class="chart" viewBox="0 0 ${W} ${H}">${g}</svg><footer>Dots: GPS altitude saved in our photos · white triangles: summit signs &amp; hut heights · the real trail had a lot more up and down in between.</footer></div>`;
}

function chartPhotos() {
  const W = 1700, H = 640, ml = 80, mr = 30, mt = 40, mb = 70, pw = W - ml - mr, ph = H - mt - mb;
  const n = 28, slot = pw / n, bw = 30, y = (v) => mt + ph - v / 80 * ph;
  const placeOf = { 0: 'Kraków', 1: 'Narita', 2: 'Tokyo', 3: 'Mt Takao', 4: 'Akihabara', 5: 'Nikkō', 6: '—', 7: 'Shōsenkyō', 8: 'Alps day 1', 9: 'Alps day 2', 10: 'Alps day 3', 11: 'Kitadake', 12: 'Ainodake', 13: 'Alps day 6', 14: 'Kyoto', 15: 'Bike: Kutsuki', 16: 'Bike: Obama', 17: 'Bike: Wakasa', 18: 'Bike: Miyama', 19: 'Bike: Kameoka', 20: 'Kyoto', 21: 'Kyoto', 22: 'Asakusa', 23: 'Futtsu', 24: 'Futtsu', 25: 'Futtsu', 26: 'Tokyo', 27: 'Warsaw' };
  let g = '';
  for (const v of [0, 20, 40, 60, 80]) g += `<line class="grid" x1="${ml}" x2="${ml + pw}" y1="${y(v)}" y2="${y(v)}"/><text class="axl" x="${ml - 12}" y="${y(v) + 6}" text-anchor="end">${v}</text>`;
  const counts = [];
  for (let d = 0; d < n; d++) {
    const dt = new Date(T0 + d * 864e5); const key = `${dt.getUTCFullYear()}:${String(dt.getUTCMonth() + 1).padStart(2, '0')}:${String(dt.getUTCDate()).padStart(2, '0')}`;
    const v = media.perDay[key] || 0; counts.push(v);
    const cx = ml + slot * d + slot / 2, m = DAYMODE[d];
    if (v) g += `<path d="M${cx - bw / 2} ${y(0)}V${y(v) + 6}Q${cx - bw / 2} ${y(v)} ${cx - bw / 2 + 6} ${y(v)}H${cx + bw / 2 - 6}Q${cx + bw / 2} ${y(v)} ${cx + bw / 2} ${y(v) + 6}V${y(0)}Z" fill="${MODE[m].color}"><title>${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]} · ${v} photos · ${placeOf[d]}</title></path>`;
    g += `<text class="axl ${d === 0 || dt.getUTCDate() === 1 ? 'strong' : ''}" x="${cx}" y="${mt + ph + 28}" text-anchor="middle">${dt.getUTCDate()}</text>`;
    if (d === 0 || dt.getUTCDate() === 1) g += `<text class="axl" x="${cx}" y="${mt + ph + 54}" text-anchor="middle">${MONTHS[dt.getUTCMonth()]}</text>`;
  }
  const top = [...counts.keys()].sort((a, b) => counts[b] - counts[a]).slice(0, 3);
  for (const d of top) { const cx = ml + slot * d + slot / 2; g += `<text class="anno strong" x="${cx}" y="${y(counts[d]) - 30}" text-anchor="middle">${counts[d]}</text><text class="anno" x="${cx}" y="${y(counts[d]) - 10}" text-anchor="middle">${placeOf[d]}</text>`; }
  g += `<text class="anno" x="${ml + slot * 6 + slot / 2}" y="${y(0) - 14}" text-anchor="middle">0 ?!</text>`;
  const total = counts.reduce((a, b) => a + b, 0) + 1;
  const legend = `<div class="legend">${['flight', 'train', 'foot', 'bike'].map((m) => `<span><i style="background:${MODE[m].color}"></i>${MODE[m].name}</span>`).join('')}</div>`;
  return `<div class="panel"><header><h2>${fmt(total)} photos, day by day</h2><p>Coloured by how we got around that day — plus 23 videos</p>${legend}</header><svg class="chart" viewBox="0 0 ${W} ${H}">${g}</svg><footer>Photos from both phones. 11 Oct: zero photos — a day of shopping for trail food.</footer></div>`;
}

function chartKm() {
  const rows = [['train', KM.train], ['bike', KM.bike], ['foot', KM.foot]];
  const max = Math.max(...rows.map((r) => r[1]));
  const W = 1700, H = 330, ml = 230, mr = 200, pw = W - ml - mr;
  let g = '';
  rows.forEach(([m, v], i) => {
    const yy = 40 + i * 100, w = Math.max(8, v / max * pw);
    g += `<text class="rowl" x="${ml - 24}" y="${yy + 22}" text-anchor="end">${MODE[m].name}</text>`;
    g += `<path d="M${ml} ${yy}H${ml + w - 8}Q${ml + w} ${yy} ${ml + w} ${yy + 8}V${yy + 28}Q${ml + w} ${yy + 36} ${ml + w - 8} ${yy + 36}H${ml}Z" fill="${MODE[m].color}"/>`;
    g += `<text class="val" x="${ml + w + 18}" y="${yy + 28}">${fmt(Math.round(v / 5) * 5)}+ km</text>`;
  });
  const tiles = [['Days away', '28'], ['Flown', `≈ ${fmt(Math.round(FLOWN / 1000) * 1000)} km`], ['Highest point', '3,193 m'], ['Mountain huts & tents', '5 nights'], ['Days on bikes', '5'], ['Typhoons dodged', '1']];
  return `<div class="panel"><header><h2>Ground covered</h2><p>Kilometres in Japan by how we moved</p></header><svg class="chart" viewBox="0 0 ${W} ${H}">${g}</svg><div class="tiles">${tiles.map(([l, v]) => `<div class="tile"><div class="tl">${l}</div><div class="tv">${v}</div></div>`).join('')}</div><footer>Measured in straight lines between the places we stopped, so the real distances were longer. Flights: Kraków → Tokyo and back to Warsaw, as the crow flies.</footer></div>`;
}


const legendRow = `<div class="route-legend">${['flight', 'train', 'foot', 'bike'].map((m) => `<span><i class="lg-${m}"></i>${MODE[m].name}</span>`).join('')}<span><i class="lg-dot"></i>Photo with GPS</span></div>`;
const INTRO = `<div class="ov-inner"><div class="ov-jp">日本</div><div class="ov-en">Japan <span>2026</span></div><div class="ov-sub">${esc(data.travellers)} · 5 October – 1 November</div><div class="ov-meta">28 days · 624 photos · 23 videos · 14 chapters</div>${legendRow}<div class="ov-hint">press → or space</div></div>`;
const ROUTE = `<div class="ov-inner"><div class="ov-en small">The whole route</div><div class="ov-sub">From Narita to Nikkō, over the Southern Alps, around Wakasa Bay by bike and back to Tokyo Bay</div><div class="ov-stats"><div><b>≈ ${fmt(Math.round(KM.train / 10) * 10)} km</b><span>by train &amp; bus</span></div><div><b>${fmt(Math.round(KM.bike / 5) * 5)}+ km</b><span>by bike</span></div><div><b>${fmt(Math.round(KM.foot / 5) * 5)}+ km</b><span>on foot in the mountains</span></div><div><b>3,193 m</b><span>highest point</span></div></div>${legendRow}</div>`;
const THANKS = `<div class="ov-inner"><div class="ov-jp">ありがとう</div><div class="ov-en small">Thank you</div><div class="ov-sub">${esc(data.travellers)} · Japan, October 2026</div><div class="ov-meta">questions, stories and more photos — ask away</div></div>`;

// ---------------------------------------------------------------- html
const stepHtml = (s) => {
  let html = s.html;
  html = html.replace('__INTRO__', INTRO).replace('__ROUTE__', ROUTE).replace('__THANKS__', THANKS).replace('__ALT__', chartAltitude())
    .replace('__ALPS__', chartAlps()).replace('__PHOTOS__', chartPhotos()).replace('__KM__', chartKm());
  const day = s.day !== undefined ? s.day : s.dt ? dayIdx(s.dt) : -1;
  const attrs = [`id="${s.id}"`, `class="${s.cls}"`, `data-x="${r0(s.x)}"`, `data-y="${r0(s.y)}"`, `data-scale="${s.scale}"`];
  if (s.z) attrs.push(`data-z="${r0(s.z)}"`);
  if (s.rot) attrs.push(`data-rotate="${s.rot}"`);
  if (s.rotx) attrs.push(`data-rotate-x="${s.rotx}"`);
  if (s.dur) attrs.push(`data-transition-duration="${s.dur}"`);
  attrs.push(`data-ch="${s.ch}"`, `data-day="${day}"`);
  if (s.dt) attrs.push(`data-date="${isoDate(s.dt)}"`);
  if (s.place) attrs.push(`data-place="${esc(s.place)}"`);
  return `<div ${attrs.join(' ')}>${html}</div>`;
};
const [mcx, mcy] = [(VX0 + VX1) / 2, (VY0 + VY1) / 2];
const [wcx, wcy] = [(WX0 + WX1) / 2, (WY0 + WY1) / 2];
const tpl = fs.readFileSync(path.join(HERE, 'template.html'), 'utf8');
const html = tpl
  .replace('{{MAP}}', `<div id="map" class="step skip map" data-x="${r0(mcx)}" data-y="${r0(mcy)}" data-scale="${MAPSCALE}">${mapSvg}</div><div id="world" class="step skip map" data-x="${r0(wcx)}" data-y="${r0(wcy)}" data-scale="${WSCALE}">${worldSvg}</div>`)
  .replace('{{STEPS}}', steps.map(stepHtml).join('\n'))
  .replace('{{CHAPTERS}}', JSON.stringify(data.chapters.map((c) => c.en)));
fs.writeFileSync(path.join(OUT, 'index.html'), html);
fs.writeFileSync(path.join(HERE, 'chars.txt'), [...new Set(html.replace(/<[^>]+>/g, ''))].join(''));
console.log(layoutReport.join('\n'));
console.log('coast points', ptsIn, '->', ptsOut); console.log('steps', steps.length, 'km', KM, 'flown', Math.round(FLOWN));
