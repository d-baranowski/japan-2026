// Bike days (20–24 Oct): route each day along real roads between the places our photos were taken,
// then sample terrain elevation along it to get km, metres up and metres down.
// Writes bike.json (committed, so build.mjs never needs the network).
//   node bike.mjs
// Uses the public FOSSGIS OSRM routers (bike, and car where the bike profile detours around roads we
// did ride, e.g. Route 367 over Tochū pass) and the OpenTopoData API (SRTM 30 m DEM).
// Responses are cached in private/bike-cache/ so re-runs don't hit the APIs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// [lat, lon, label] — from photo GPS, in time order. Labels are shown on the profile chart.
const DAYS = [
  { date: '2026-10-20', from: 'Kyoto', to: 'Kutsuki', pts: [[35.0034, 135.7785, 'Kyoto'], [35.1197, 135.8343, 'Ōhara'], [35.1352, 135.8335], [35.3242, 135.8985, 'Kutsuki camp']] },
  { date: '2026-10-21', from: 'Kutsuki', to: 'Obama', pts: [[35.3242, 135.8985, 'Kutsuki'], [35.4326, 135.9251, 'Kumagawa-juku'], [35.5247, 135.7983, 'the sea!'], [35.4940, 135.7430, 'Obama']] },
  { date: '2026-10-22', from: 'Obama', to: 'Wakasa Wada', pts: [[35.4953, 135.7385, 'Obama'], [35.5328, 135.6573, 'cliff road'], [35.5247, 135.6692, 'island bridge'], [35.5273, 135.6618], [35.4895, 135.5773, 'Takahama'], [35.4917, 135.5726, 'Wakasa Wada']] },
  { date: '2026-10-23', from: 'Wakasa Wada', to: 'Miyama', pts: [[35.4917, 135.5726, 'Wakasa Wada'], [35.4449, 135.5610, 'Ōi'], [35.3832, 135.5938], [35.3221, 135.5576, 'Nantan'], [35.3125, 135.6226, 'Kayabuki-no-Sato'], [35.3101, 135.6398, 'Miyama']] },
  { date: '2026-10-24', from: 'Miyama', to: 'Kameoka', pts: [[35.3101, 135.6398, 'Miyama'], [35.2166, 135.5696, 'Keihoku'], [35.0198, 135.5896, 'Kameoka'], [35.0097, 135.5790, 'matsuri']] },
];
const STEP = 100;          // m between elevation samples
const MAX_GRADE = 0.12;    // steeper than this along a road = DEM sampling a ridge over a tunnel / a valley under a bridge
const HYST = 8;            // m: ignore wiggles smaller than this when counting up/down

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hav = (a, b) => {
  const R = 6371000, t = Math.PI / 180, s = Math.sin((b[0] - a[0]) * t / 2) ** 2 + Math.cos(a[0] * t) * Math.cos(b[0] * t) * Math.sin((b[1] - a[1]) * t / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
const CACHE = path.join(HERE, 'private', 'bike-cache');
fs.mkdirSync(CACHE, { recursive: true });
let lastCall = 0;
async function getJson(url, gapMs = 1100) {
  const f = path.join(CACHE, Buffer.from(url).toString('base64url').slice(-120) + '.json');
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  for (let i = 0; i < 5; i++) {
    await sleep(Math.max(0, lastCall + gapMs - Date.now()));
    lastCall = Date.now();
    const r = await fetch(url, { headers: { 'User-Agent': 'trip-slides/1.0' } });
    if (r.ok) { const j = await r.json(); fs.writeFileSync(f, JSON.stringify(j)); return j; }
    await sleep(3000 * (i + 1));
  }
  throw new Error('failed ' + url.slice(0, 120));
}
// one leg: bike router, unless the car router is clearly shorter without using a motorway
async function leg(a, b) {
  const q = `${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson&steps=true`;
  const bike = (await getJson('https://routing.openstreetmap.de/routed-bike/route/v1/driving/' + q)).routes[0];
  const car = (await getJson('https://routing.openstreetmap.de/routed-car/route/v1/driving/' + q)).routes[0];
  const motorway = car.legs[0].steps.some((s) => (s.intersections || []).some((x) => (x.classes || []).includes('motorway')));
  // 林道 = forest road: gravel tracks over the ridges that the bike profile loves and loaded touring bikes don't
  const forest = bike.legs[0].steps.some((s) => /林道/.test(s.name || ''));
  const useCar = !motorway && (car.distance < bike.distance * 0.85 || forest);
  const r = useCar ? car : bike;
  return { distance: r.distance, line: r.geometry.coordinates.map(([lo, la]) => [la, lo]), via: useCar ? 'car' : 'bike', forest, bikeKm: bike.distance / 1000, carKm: car.distance / 1000, motorway };
}

const out = [];
for (const [di, d] of DAYS.entries()) {
  const legs = [];
  for (let i = 1; i < d.pts.length; i++) legs.push(await leg(d.pts[i - 1], d.pts[i]));
  const route = { distance: legs.reduce((a, l) => a + l.distance, 0), legs };
  const line = legs.flatMap((l, i) => (i ? l.line.slice(1) : l.line));
  console.log('  legs', legs.map((l) => `${l.via} ${(l.distance / 1000).toFixed(1)} (bike ${l.bikeKm.toFixed(1)}${l.forest ? ' 林道' : ''} / car ${l.carKm.toFixed(1)}${l.motorway ? ' mw' : ''})`).join(' | '));
  // cumulative distance, then resample every STEP m
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + hav(line[i - 1], line[i]));
  const L = cum[cum.length - 1], samples = [];
  for (let s = 0, j = 0; s <= L; s += STEP) {
    while (j < line.length - 2 && cum[j + 1] < s) j++;
    const f = (s - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
    samples.push([line[j][0] + (line[j + 1][0] - line[j][0]) * f, line[j][1] + (line[j + 1][1] - line[j][1]) * f, s]);
  }
  const ele = [];
  for (let i = 0; i < samples.length; i += 100) {
    const b = samples.slice(i, i + 100);
    const j = await getJson(`https://api.opentopodata.org/v1/srtm30m?locations=${b.map((p) => p[0].toFixed(5) + ',' + p[1].toFixed(5)).join('|')}`);
    ele.push(...j.results.map((x) => x.elevation ?? 0));
  }
  // A road can't be steeper than MAX_GRADE for long, so where the terrain under the route rises or
  // drops far beyond that, we're in a tunnel (DEM sees the hill above) or on a bridge (DEM sees the
  // valley below). Find those stretches by comparing with grade-capped envelopes, and replace them with
  // a straight line between the two ends (the portals). Then smooth over ~500 m to kill DEM noise.
  const g = STEP * MAX_GRADE, n = ele.length;
  const envelope = (v, sign) => {   // sign -1: min_j(v[j] + g|i-j|), +1: max_j(v[j] - g|i-j|)
    const f = v.slice(), b = v.slice(), pick = sign < 0 ? Math.min : Math.max;
    for (let i = 1; i < n; i++) f[i] = pick(v[i], f[i - 1] - sign * g);
    for (let i = n - 2; i >= 0; i--) b[i] = pick(v[i], b[i + 1] - sign * g);
    return v.map((_, i) => pick(f[i], b[i]));
  };
  const fixed = ele.slice();
  let tunnels = 0, bridges = 0;
  for (const sign of [-1, +1]) {
    const env = envelope(fixed, sign), off = fixed.map((v, i) => Math.abs(v - env[i]));
    for (let i = 0; i < n; i++) {
      if (off[i] < 25) continue;
      let a = i, b = i;
      while (a > 0 && off[a] > 3) a--;
      while (b < n - 1 && off[b] > 3) b++;
      for (let k = a + 1; k < b; k++) fixed[k] = fixed[a] + (fixed[b] - fixed[a]) * (k - a) / (b - a);
      if (sign < 0) tunnels++; else bridges++;
      i = b;
    }
  }
  const W = 2;   // ±2 samples
  const sm = fixed.map((_, i) => { let s = 0, c = 0; for (let k = Math.max(0, i - W); k <= Math.min(n - 1, i + W); k++) { s += fixed[k]; c++; } return s / c; });
  let up = 0, down = 0, ref = sm[0];
  for (const v of sm) { if (v - ref >= HYST) { up += v - ref; ref = v; } else if (ref - v >= HYST) { down += ref - v; ref = v; } }
  // where each named waypoint sits along the route (OSRM legs are waypoint to waypoint)
  let acc = 0;
  const marks = [{ km: 0, label: d.pts[0][2] }];
  route.legs.forEach((leg, i) => { acc += leg.distance; if (d.pts[i + 1][2]) marks.push({ km: +(acc / 1000).toFixed(2), label: d.pts[i + 1][2] }); });
  const top = sm.indexOf(Math.max(...sm));
  out.push({
    day: di + 1, date: d.date, from: d.from, to: d.to,
    km: +(route.distance / 1000).toFixed(1), up: Math.round(up), down: Math.round(down),
    max: Math.round(sm[top]), maxKm: +(samples[top][2] / 1000).toFixed(2), min: Math.round(Math.min(...sm)),
    profile: sm.filter((_, i) => i % 2 === 0 || i === n - 1).map((v, i, a) => [+(Math.min(i * 2 * STEP, L) / 1000).toFixed(2), Math.round(v)]),
    marks,
    line: line.filter((_, i) => i % 3 === 0 || i === line.length - 1).map(([la, lo]) => [+la.toFixed(5), +lo.toFixed(5)]),
  });
  console.log(`day ${di + 1} ${d.from} → ${d.to}: ${(route.distance / 1000).toFixed(1)} km, ↑${Math.round(up)} m ↓${Math.round(down)} m, max ${Math.round(sm[top])} m (raw DEM max ${Math.max(...ele)}), ${tunnels} tunnels ${bridges} bridges cut`);
}
fs.writeFileSync(path.join(HERE, 'bike.json'), JSON.stringify(out));
