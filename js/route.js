// Fickan – ruttplanering med Valhalla (FOSSGIS, öppen ruttmotor baserad på OpenStreetMap)
import { GANTRIES, passages, tollFor } from './toll.js?v=202610122331';

const VALHALLA = 'https://valhalla1.openstreetmap.de/route';

export function decodePolyline6(str) {
  const out = []; let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (const which of [0, 1]) {
      let shift = 0, result = 0, b;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d; else lng += d;
    }
    out.push([lng / 1e6, lat / 1e6]);
  }
  return out;
}
// Tid (sekunder från start) för varje punkt, fördelad inom varje manöver.
export function shapeTimes(coords, maneuvers) {
  const times = new Array(coords.length).fill(0);
  let t = 0;
  for (const m of maneuvers) {
    const a = m.begin_shape_index, b = m.end_shape_index ?? a, n = Math.max(1, b - a);
    for (let k = a; k <= b && k < coords.length; k++) times[k] = t + (m.time || 0) * (k - a) / n;
    t += m.time || 0;
  }
  return times;
}
function toRoute(trip, kind) {
  const leg = trip.legs[0];
  const coords = decodePolyline6(leg.shape);
  const times = shapeTimes(coords, leg.maneuvers);
  return {
    kind, coords, times, sec: trip.summary.time, km: trip.summary.length,
    steps: leg.maneuvers.map(m => ({ text: m.instruction, km: m.length, sec: m.time })),
    pass: passages(coords, times),
  };
}
async function call(body, signal) {
  const r = await fetch(VALHALLA, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ costing: 'auto', units: 'kilometers', language: 'sv-SE', ...body }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'route ' + r.status); e.code = j.error_code; throw e; }
  return j;
}
const loc = ([lng, lat]) => ({ lat, lon: lng });

// Rutter: snabbaste, upp till två alternativ och en som undviker betalstationerna (om det går).
export async function planRoutes(from, to, { signal } = {}) {
  const j = await call({ locations: [loc(from), loc(to)], alternates: 2 }, signal);
  const routes = [toRoute(j.trip, 'snabbast'), ...(j.alternates || []).map(a => toRoute(a.trip, 'alternativ'))];
  if (routes.some(r => r.pass.length)) {
    // Undvik tull: stäng av de stationer rutten passerar och räkna om, högst fyra varv (tjänsten tillåter max 50 punkter).
    const avoid = new Map();
    let last = null;
    for (let round = 0; round < 4; round++) {
      const src = last || routes[0];
      for (const p of src.pass) for (const g of GANTRIES) if (g[3] === p.ref) avoid.set(g[0] + ',' + g[1], g);
      if (avoid.size > 50) break;
      try {
        const k = await call({ locations: [loc(from), loc(to)], exclude_locations: [...avoid.values()].map(g => ({ lat: g[1], lon: g[0] })) }, signal);
        last = toRoute(k.trip, 'utan tull');
        if (!last.pass.length) break;
      } catch (e) { last = null; break; }
    }
    if (last && !last.pass.length) routes.push(last);
  }
  // Ta bort dubbletter (samma längd och tid)
  const seen = new Set();
  return routes.filter(r => { const k = Math.round(r.km * 10) + ':' + Math.round(r.sec / 30); if (seen.has(k)) return false; seen.add(k); return true; });
}

// Kostnad för en rutt vid olika avresetider.
export const OFFSETS = [0, 10, 20, 30, 45, 60, 90];
export function departures(route, baseMs) {
  return OFFSETS.map(min => { const t = baseMs + min * 60000; return { min, t, arrive: t + route.sec * 1000, ...tollFor(route.pass, t) }; });
}

// Länkar för att navigera i en annan app. Google Maps får mellanpunkter så att den följer vår rutt.
export function navLinks(from, to, route) {
  const ll = ([lng, lat]) => `${lat.toFixed(6)},${lng.toFixed(6)}`;
  let wp = '';
  if (route && route.kind === 'utan tull') {
    const n = route.coords.length, picks = [0.25, 0.5, 0.75].map(f => route.coords[Math.floor(n * f)]);
    wp = '&waypoints=' + encodeURIComponent(picks.map(ll).join('|'));
  }
  return {
    google: `https://www.google.com/maps/dir/?api=1${from ? '&origin=' + ll(from) : ''}&destination=${ll(to)}&travelmode=driving${wp}`,
    apple: `https://maps.apple.com/?${from ? 'saddr=' + ll(from) + '&' : ''}daddr=${ll(to)}&dirflg=d`,
    waze: `https://waze.com/ul?ll=${ll(to)}&navigate=yes`,
  };
}
