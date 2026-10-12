// Fickan – trängselskatt i Stockholm
// Betalstationer: OpenStreetMap (highway=toll_gantry, operator Transportstyrelsen), hämtat 2026-10-12.
// Tider och belopp: Transportstyrelsen, gäller sedan 1 januari 2020.
import { holidays } from './rules.js?v=202610122330';

// [lng, lat, namn, stationsnummer]
export const GANTRIES = [
  [18.054637, 59.362974, "Trafikplats Universitetet", "23"],
  [18.105014, 59.356631, "Trafikplats Ropsten", "26"],
  [18.102347, 59.356988, "Trafikplats Ropsten", "26"],
  [18.050647, 59.369574, "Trafikplats Ekhagen", "21"],
  [18.010724, 59.331728, "Trafikplats Fredhäll/Drottningholmsvägen", "8"],
  [18.010654, 59.33137, "Trafikplats Fredhäll/Drottningholmsvägen", "8"],
  [18.010624, 59.330697, "Trafikplats Fredhäll/Drottningholmsvägen", "8"],
  [18.010088, 59.333705, "Trafikplats Kristineberg", "9"],
  [18.102471, 59.357062, "Trafikplats Ropsten", "26"],
  [18.029213, 59.311921, "Liljeholmsbron", "5"],
  [18.010996, 59.331233, "Trafikplats Fredhäll/Drottningholmsvägen", "8"],
  [18.025898, 59.343748, "Trafikplats Karlberg/Tomtebodavägen", "12"],
  [18.105072, 59.356577, "Trafikplats Ropsten", "26"],
  [18.026004, 59.343808, "Trafikplats Karlberg/Tomtebodavägen", "12"],
  [17.996703, 59.322915, "Stora Essingen", "6"],
  [18.058825, 59.352512, "Trafikplats Roslagstull", "24"],
  [17.996574, 59.322072, "Stora Essingen", "6"],
  [18.077461, 59.3063, "Skanstullsbron", "3"],
  [18.077292, 59.306279, "Skanstullsbron", "3"],
  [18.103382, 59.313919, "Danvikstull", "1"],
  [18.103403, 59.314013, "Danvikstull", "1"],
  [18.077251, 59.303748, "Johanneshovsbron", "4"],
  [18.077129, 59.303706, "Johanneshovsbron", "4"],
  [18.079454, 59.304022, "Skansbron", "2"],
  [18.028835, 59.311451, "Liljeholmsbron", "5"],
  [17.996583, 59.322885, "Stora Essingen", "6"],
  [18.003971, 59.32512, "Lilla Essingen", "7"],
  [18.0108, 59.331525, "Trafikplats Fredhäll/Drottningholmsvägen", "8"],
  [18.010819, 59.336182, "Trafikplats Kristineberg", "9"],
  [18.010277, 59.336445, "Trafikplats Kristineberg", "9"],
  [18.012963, 59.340727, "Ekelundsbron", "10"],
  [18.029948, 59.338726, "Klarastrandsleden", "11"],
  [18.029984, 59.338765, "Klarastrandsleden", "11"],
  [18.055216, 59.363103, "Trafikplats Universitetet", "23"],
  [18.095228, 59.351202, "Trafikplats Värtan", "25"],
  [18.095664, 59.35141, "Trafikplats Värtan", "25"],
  [18.106447, 59.352445, "Trafikplats Värtan", "25"],
  [18.106553, 59.351779, "Trafikplats Värtan", "25"],
  [18.009873, 59.333795, "Betalstation Essingeleden", "9"],
  [18.102292, 59.356941, "Trafikplats Ropsten", "26"],
  [18.009686, 59.3338, "Betalstation Essingeleden", "9"],
  [18.051576, 59.369332, "Trafikplats Ekhagen", "21"],
  [18.052466, 59.36562, "Trafikplats Frescati", "22"],
  [18.050824, 59.371468, "Trafikplats Ekhagen", "21"],
  [18.050259, 59.371218, "Trafikplats Ekhagen", "21"],
  [18.106322, 59.352131, "Trafikplats Värtan", "25"],
  [18.099241, 59.35081, "Trafikplats Värtan", "25"],
  [18.058004, 59.352767, "Trafikplats Roslagstull", "24"],
  [18.009492, 59.333705, "Trafikplats Kristineberg", "9"],
  [18.031995, 59.346893, "Solnabron", "27"],
  [18.03183, 59.34683, "Solnabron", "27"],
  [18.043667, 59.35049, "Norrtull", "14"],
  [18.029121, 59.311971, "Liljeholmsbron", "5"],
  [18.03317, 59.347578, "Gävlegatan", "27"],
  [18.036167, 59.349164, "Hälsingegatan", "27"]
];
// Essingeleden (station 6–9) har egna belopp.
export const ESSINGE = new Set(['6', '7', '8', '9']);

// [från minut på dygnet, högsäsong, lågsäsong] för innerstaden respektive Essingeleden
const INNER = [[360, 15, 15], [390, 30, 25], [420, 45, 35], [510, 30, 25], [540, 20, 15], [570, 11, 11], [900, 20, 15], [930, 30, 25], [960, 45, 35], [1050, 30, 25], [1080, 20, 15], [1110, 0, 0]];
const ESS = [[360, 15, 15], [390, 27, 22], [420, 40, 30], [510, 27, 22], [540, 20, 15], [570, 11, 11], [900, 20, 15], [930, 27, 22], [960, 40, 30], [1050, 27, 22], [1080, 20, 15], [1110, 0, 0]];

const key = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
function midsummerEve(y) { for (let d = 19; d <= 25; d++) { const x = new Date(y, 5, d); if (x.getDay() === 5) return x; } }
// Skattefria dagar: helg, röda dagar, dagen före röd dag (med undantag), trettondagsafton, midsommarafton, julafton, nyårsafton, och juli utom de fem första vardagarna.
export function taxFree(d) {
  const wd = d.getDay();
  if (wd === 0 || wd === 6) return true;
  const y = d.getFullYear(), h = holidays(y);
  if (h.has(key(d))) return true;
  const extra = [new Date(y, 0, 5), midsummerEve(y), new Date(y, 11, 24), new Date(y, 11, 31)];
  if (extra.some(x => key(x) === key(d))) return true;
  if (d.getMonth() === 6) {
    let n = 0;
    for (let i = 1; i <= d.getDate(); i++) { const x = new Date(y, 6, i); if (x.getDay() !== 0 && x.getDay() !== 6 && !h.has(key(x))) n++; }
    return n > 5;
  }
  return false;
}
// Högsäsong: 1 mars – dagen före midsommarafton, samt 15 augusti – 30 november
export function highSeason(d) {
  const y = d.getFullYear(), t = d.getTime();
  const a1 = new Date(y, 2, 1).getTime(), a2 = midsummerEve(y).getTime();
  const b1 = new Date(y, 7, 15).getTime(), b2 = new Date(y, 11, 1).getTime();
  return (t >= a1 && t < a2) || (t >= b1 && t < b2);
}
export function amountAt(ms, essinge = false) {
  const d = new Date(ms);
  if (taxFree(d)) return 0;
  const min = d.getHours() * 60 + d.getMinutes(), tab = essinge ? ESS : INNER, hi = highSeason(d);
  let amt = 0;
  for (const [from, h, l] of tab) if (min >= from) amt = hi ? h : l;
  return min < 360 ? 0 : amt;
}
export const dayCap = ms => highSeason(new Date(ms)) ? 135 : 105;

// Passager längs en rutt. coords = [[lng,lat],…], times = sekunder från start för varje punkt.
const M = 111320;
function distM(a, b, lat0) { const kx = M * Math.cos(lat0 * Math.PI / 180); return Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * M); }
function nearestOnRoute(p, coords) {
  let best = Infinity, idx = -1;
  const lat0 = p[1], kx = M * Math.cos(lat0 * Math.PI / 180);
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i], b = coords[i + 1];
    const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * M, bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * M;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    let t = L2 ? -(ax * dx + ay * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best) { best = d; idx = t < 0.5 ? i : i + 1; }
  }
  return { d: best, idx };
}
export function passages(coords, times) {
  const hits = [];
  for (const [lng, lat, name, ref] of GANTRIES) {
    const n = nearestOnRoute([lng, lat], coords);
    if (n.d <= 18) hits.push({ name, ref, idx: n.idx, sec: times[n.idx] || 0, pos: [lng, lat] });
  }
  hits.sort((a, b) => a.sec - b.sec);
  // En station med flera portaler (två körriktningar) räknas en gång per passage.
  // Hela Essingeleden (station 6–9) räknas som en passage så länge man kör kvar på den.
  const out = [];
  for (const h of hits) {
    const ess = ESSINGE.has(h.ref);
    const prev = out[out.length - 1];
    if (prev && ((prev.ref === h.ref) || (ess && prev.essinge)) && h.sec - prev.sec < 600) continue;
    out.push({ ...h, essinge: ess });
  }
  return out;
}
export function tollFor(pass, departMs) {
  let total = 0;
  const items = pass.map(p => { const t = departMs + p.sec * 1000, a = amountAt(t, p.essinge); total += a; return { ...p, t, amount: a }; });
  const cap = dayCap(departMs);
  return { items, total: Math.min(total, cap), capped: total > cap };
}
