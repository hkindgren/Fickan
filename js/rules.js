// Fickan – regelmotor
// Tolkar Stockholms stads lokala trafikföreskrifter (LTF-Tolken, GeoJSON) och räknar ut
// vad som gäller för en given ankomsttid och parkeringslängd.
// Ren logik utan DOM, så den kan testas i Node.

// ---------- kalender ----------
export const WD_LONG = ['söndag', 'måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag'];
export const WD_SHORT = ['sön', 'mån', 'tis', 'ons', 'tors', 'fre', 'lör'];
export const WD_SIGN = ['Sönd', 'Månd', 'Tisd', 'Onsd', 'Torsd', 'Fred', 'Lörd'];

function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}
const dkey = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const hcache = {};
export function holidays(y) {
  if (hcache[y]) return hcache[y];
  const set = new Set(), add = d => set.add(dkey(d)), E = easter(y);
  const fromEaster = n => { const d = new Date(E); d.setDate(d.getDate() + n); return d; };
  add(new Date(y, 0, 1)); add(new Date(y, 0, 6));                      // nyårsdagen, trettondedag jul
  add(fromEaster(-2)); add(fromEaster(0)); add(fromEaster(1));          // långfredag, påskdagen, annandag påsk
  add(new Date(y, 4, 1)); add(fromEaster(39)); add(fromEaster(49));      // 1 maj, Kristi himmelsfärd, pingstdagen
  add(new Date(y, 5, 6));                                                // nationaldagen
  for (let d = 20; d <= 26; d++) { const x = new Date(y, 5, d); if (x.getDay() === 6) add(x); }      // midsommardagen
  for (let i = 0; i < 7; i++) { const x = new Date(y, 9, 31 + i); if (x.getDay() === 6) add(x); }    // alla helgons dag
  add(new Date(y, 11, 25)); add(new Date(y, 11, 26));
  return (hcache[y] = set);
}
export const isHoliday = d => d.getDay() === 0 || holidays(d.getFullYear()).has(dkey(d));
// Skyltspråk: 'v' = vardag (svart), 'l' = dag före sön- och helgdag (inom parentes), 's' = sön- och helgdag (röd)
export function dayType(d) {
  if (isHoliday(d)) return 's';
  const n = new Date(d); n.setDate(n.getDate() + 1);
  return isHoliday(n) ? 'l' : 'v';
}
const hod = t => t.getHours() + t.getMinutes() / 60;
const inWin = (h, f, t) => (f <= t ? h >= f && h < t : h >= f || h < t); // stöd för t.ex. 22–06

// ---------- fältparsning ----------
export function parseHM(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string') {
    const m = v.trim().match(/^(\d{1,2})(?:[.:](\d{2}))?$/);
    if (m) return +m[1] + (+m[2] || 0) / 60;
    const n = Number(v); if (Number.isNaN(n)) return null; v = n;
  }
  if (v <= 24) return v;                               // timmar
  return Math.floor(v / 100) + (v % 100) / 60;          // HHMM, t.ex. 600, 1830
}
export function weekdayIndex(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v % 7;              // 1 = måndag … 7 = söndag
  const s = String(v).toLowerCase().trim();
  const i = WD_LONG.findIndex(n => s.startsWith(n.slice(0, 3)));
  return i < 0 ? null : i;
}

// Taxetexter från staden finns i flera varianter, t.ex.
//  "taxa 3: 20 kr/tim vardagar 7-19, 15 kr/tim dag före helgdag 11-17, Boende: 1100 kr/månad"
//  "taxa 13: Vardagar utom vardag före sön- och helgdag klockan 7.00 - 19.00, 5 kr/tim. Vardag före sön- och helgdag klockan 11.00 - 17.00, 3,75 kr/tim."
//  "taxa 2: 31 kr/tim vardagar 7-21 och dag före helgdag och helgdag 9-19, 20 kr/tim övrig tid"
// Texten görs om till tecken för dagtyp, tidsfönster och pris som sedan paras ihop.
const DAYWORDS = [
  [/vardag(?:ar)?\s+utom\s+(?:vardag|dag)\s+före\s+(?:sön-\s*och\s*)?helgdag(?:ar)?/g, '\u0001V'],
  [/(?:vardag|dag)\s+före\s+(?:sön-\s*och\s*)?helgdag(?:ar)?/g, '\u0001L'],
  [/sön-\s*och\s*helgdag(?:ar)?/g, '\u0001S'],
  [/alla\s+dagar|dygnet\s+runt/g, '\u0001A'],
  [/vardag(?:ar)?/g, '\u0001V'],
  [/lördag(?:ar)?/g, '\u0001L'],
  [/helgdag(?:ar)?|söndag(?:ar)?/g, '\u0001S'],
  [/övrig(?:a)?\s+tid(?:er)?/g, '\u0001O'],
];
const DAYCODE = { V: ['v'], L: ['l'], S: ['s'], A: ['v', 'l', 's'] };
export function parseRate(text) {
  if (!text) return null;
  const raw = String(text).replace(/\s+/g, ' ').trim();
  const out = { raw, taxa: null, periods: [], other: 0, boende: /boende/i.test(raw), free: /avgiftsfri/i.test(raw) };
  const tm = raw.match(/taxa\s*([0-9A-Za-zÅÄÖåäö]+)/i);
  if (tm) out.taxa = tm[1];
  let t = raw.split(/boende\s*:/i)[0].replace(/^.*?taxa\s*[0-9A-Za-zÅÄÖåäö]+\s*:?\s*/i, '').toLowerCase();
  t = t.replace(/\bkl(?:ockan|\.)?\s*/g, '');
  for (const [re, code] of DAYWORDS) t = t.replace(re, code);
  const TOK = /\u0001([VLSAO])|(\d+(?:,\d+)?|\d+\.\d+)\s*kr\s*\/\s*(?:tim(?:me)?|h)\b|(\d{1,2})(?:[.:](\d\d))?\s*[-–]\s*(\d{1,2})(?:[.:](\d\d))?/g;
  let days = [], current = null, unrated = [], otherPending = false, m;
  while ((m = TOK.exec(t))) {
    if (m[1] === 'O') { if (current !== null && !unrated.length) { out.other = current; current = null; } else otherPending = true; continue; }
    if (m[1]) { for (const d of DAYCODE[m[1]]) if (!days.includes(d)) days.push(d); continue; }
    if (m[2]) {
      const rate = parseFloat(m[2].replace(',', '.'));
      if (otherPending) { out.other = rate; otherPending = false; continue; }
      if (unrated.length) { unrated.forEach(p => { p.rate = rate; out.periods.push(p); }); unrated = []; current = null; }
      else current = rate;
      continue;
    }
    const from = +m[3] + (+m[4] || 0) / 60, to = +m[5] + (+m[6] || 0) / 60;
    const p = { days: days.length ? days : ['v', 'l', 's'], from, to };
    days = [];
    if (current !== null) out.periods.push({ ...p, rate: current }); else unrated.push(p);
  }
  if (!out.periods.length && current !== null && !out.free) out.periods.push({ days: ['v', 'l', 's'], from: 0, to: 24, rate: current });
  return out;
}
export function parseDayType(v) {
  if (!v) return null;
  const s = String(v).toLowerCase();
  if (/utom/.test(s)) return ['v'];
  if (/före/.test(s)) return ['l'];
  if (/sön|helg/.test(s)) return ['s'];
  if (/vardag/.test(s)) return ['v'];
  return null;
}
const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
// "Servicetid tisdag 09:00 - 14:00 utom under tiden 15 juni - 15 augusti"
export function parseService(info, p = {}) {
  const m = String(info || '').toLowerCase().match(/servicetid\s+([a-zåäö]+)\s+(\d{1,2})[.:](\d\d)\s*[-–]\s*(\d{1,2})[.:](\d\d)(.*)$/);
  let r = null;
  if (m) r = { k: 'servicedag', wd: weekdayIndex(m[1]), from: +m[2] + +m[3] / 60, to: +m[4] + +m[5] / 60 };
  else if (p.START_WEEKDAY != null && p.START_TIME != null && p.END_TIME != null) {
    // Fälten beskriver när parkering är tillåten: från START_TIME till END_TIME samma veckodag veckan efter.
    r = { k: 'servicedag', wd: weekdayIndex(p.START_WEEKDAY), from: parseHM(p.END_TIME), to: parseHM(p.START_TIME) };
  }
  if (!r || r.wd === null) return null;
  const rest = m ? m[6] : '';
  const per = rest.match(/(\d{1,2})\s+([a-zåäö]+)\s*[-–]\s*(\d{1,2})\s+([a-zåäö]+)/);
  const fromText = per && MONTHS.includes(per[2]) && MONTHS.includes(per[4])
    ? { m1: MONTHS.indexOf(per[2]) + 1, d1: +per[1], m2: MONTHS.indexOf(per[4]) + 1, d2: +per[3] } : null;
  const fromFields = p.START_MONTH && p.END_MONTH ? { m1: +p.START_MONTH, d1: +p.START_DAY || 1, m2: +p.END_MONTH, d2: +p.END_DAY || 31 } : null;
  const season = fromText || fromFields;
  // "utom under tiden 15 juni - 15 augusti" = undantag, "1 november–15 maj" = gäller bara då
  if (season) { if (/utom/i.test(info || '')) r.except = season; else r.only = season; }
  return r;
}
// Servicedagar-tjänsten: START_TIME–END_TIME är själva förbudstiden, START/END_MONTH perioden då den gäller.
export function serviceFromServicedagar(p) {
  const wd = weekdayIndex(p.START_WEEKDAY);
  if (wd === null || p.START_TIME == null || p.END_TIME == null) return null;
  const r = { k: 'servicedag', wd, from: parseHM(p.START_TIME), to: parseHM(p.END_TIME) };
  if (p.START_MONTH && p.END_MONTH) r.only = { m1: +p.START_MONTH, d1: +p.START_DAY || 1, m2: +p.END_MONTH, d2: +p.END_DAY || 31 };
  return r;
}

// ---------- geometri ----------
export function geomLines(g) {
  if (!g) return [];
  if (g.type === 'LineString') return [g.coordinates];
  if (g.type === 'MultiLineString') return g.coordinates;
  if (g.type === 'Point') return [[g.coordinates, g.coordinates]];
  return [];
}
const M_LAT = 111320;
function toXY([lng, lat], lat0) { return [lng * M_LAT * Math.cos(lat0 * Math.PI / 180), lat * M_LAT]; }
function ptSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  let t = L2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
export function distToLines(lngLat, lines) {
  const lat0 = lngLat[1], p = toXY(lngLat, lat0); let best = Infinity;
  for (const line of lines) {
    if (line.length === 1) { best = Math.min(best, ptSeg(p, toXY(line[0], lat0), toXY(line[0], lat0))); continue; }
    for (let i = 0; i < line.length - 1; i++) best = Math.min(best, ptSeg(p, toXY(line[i], lat0), toXY(line[i + 1], lat0)));
  }
  return best;
}
export function lengthM(lines) {
  let s = 0;
  for (const line of lines) for (let i = 1; i < line.length; i++) {
    const lat0 = line[i][1], a = toXY(line[i - 1], lat0), b = toXY(line[i], lat0);
    s += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return s;
}
export function midpoint(lines) {
  const line = lines[0]; if (!line || !line.length) return null;
  const total = lengthM([line]); let acc = 0;
  for (let i = 1; i < line.length; i++) {
    const seg = lengthM([[line[i - 1], line[i]]]);
    if (acc + seg >= total / 2) { const t = seg ? (total / 2 - acc) / seg : 0; return [line[i - 1][0] + t * (line[i][0] - line[i - 1][0]), line[i - 1][1] + t * (line[i][1] - line[i - 1][1])]; }
    acc += seg;
  }
  return line[0];
}

// ---------- normalisering ----------
// Platstyper i stadens data (VF_PLATS_TYP / VEHICLE):
//   "P Avgift, boende", "P-avgift endast besök"           vanlig parkering för bil
//   "7", "17"  (VEHICLE fordon, DAY_TYPE + tider)          ändamålsplats, i praktiken lastplats under angiven tid
//   "Reserverad p-plats rörelsehindrad"                     bara med tillstånd
//   MC, cykel, moped, buss, beskickningsbil                 inte för vanlig bil
export function classify(p) {
  const type = String(p.VF_PLATS_TYP ?? ''), veh = String(p.VEHICLE ?? '').toLowerCase();
  if (/rörelsehindrad/i.test(type) || veh === 'rörelsehindrade') return 'hcp';
  if (veh && veh !== 'fordon' && veh !== 'personbil' && veh !== 'bil') return 'other';
  if (/^\d+$/.test(type)) return 'load';
  return 'car';
}
function cleanAddress(p) {
  const a = p.ADDRESS && !/saknas/i.test(p.ADDRESS) ? p.ADDRESS : '';
  return a || p.STREET_NAME || 'Okänd gata';
}
const geomKey = g => JSON.stringify(g?.coordinates ?? null);
function rulesFrom(p, cls) {
  const rules = [], rate = parseRate(p.PARKING_RATE);
  if (rate && /endast besök/i.test(p.VF_PLATS_TYP || '')) rate.boende = false;
  if (rate && rate.periods.length) rules.push({ k: 'avgift', ...rate });
  const sd = parseService(p.OTHER_INFO, p);
  if (sd) rules.push(sd);
  const days = parseDayType(p.DAY_TYPE);
  const hasWin = p.START_TIME != null && p.END_TIME != null && p.START_WEEKDAY == null;
  const win = hasWin ? { days, from: parseHM(p.START_TIME), to: parseHM(p.END_TIME) } : null;
  if (cls === 'load' && win) rules.push({ k: 'lastzon', win, code: p.VF_PLATS_TYP });
  if (Number(p.MAX_HOURS) > 0) rules.push({ k: 'maxtid', h: Number(p.MAX_HOURS), win });
  return { rules, rate };
}
const sameRule = (a, b) => JSON.stringify({ ...a, raw: 0 }) === JSON.stringify({ ...b, raw: 0 });
export function normalize(f, kind = 'ptillaten') {
  const p = f.properties || {}, lines = geomLines(f.geometry);
  if (!lines.length) return null;
  const cls = classify(p);
  const { rules, rate } = rulesFrom(p, cls);
  const seg = {
    id: String(f.id || `${kind}.${p.FID ?? Math.random()}`), kind, cls, p, raws: [p], lines,
    street: p.STREET_NAME || '', address: cleanAddress(p),
    district: p.CITY_DISTRICT || '', pdistrict: p.PARKING_DISTRICT || '',
    type: /^\d+$/.test(String(p.VF_PLATS_TYP ?? '')) ? 'Lastplats' : (p.VF_PLATS_TYP || ''),
    vehicle: p.VEHICLE || '', citation: p.CITATION || '', rdt: p.RDT_URL || '',
    otherInfo: p.OTHER_INFO || '', rate, rules,
    citations: p.CITATION ? [{ c: p.CITATION, u: p.RDT_URL || '' }] : [],
  };
  seg.lengthM = lengthM(lines);
  seg.spots = cls === 'hcp' ? Math.max(1, Math.round(seg.lengthM / 7)) : Math.max(1, Math.round(seg.lengthM / 5.5));
  seg.mid = midpoint(lines);
  return seg;
}
// Samma gatusträcka kan ha flera föreskrifter (avgift, servicetid, lastplats). De slås ihop per geometri.
function merge(list) {
  const by = new Map();
  for (const s of list) {
    const k = s.cls + '|' + geomKey({ coordinates: s.lines });
    const prev = by.get(k);
    if (!prev) { by.set(k, s); continue; }
    for (const r of s.rules) if (!prev.rules.some(x => sameRule(x, r))) prev.rules.push(r);
    prev.raws.push(s.p);
    for (const c of s.citations) if (!prev.citations.some(x => x.c === c.c)) prev.citations.push(c);
    if (!prev.rate && s.rate) prev.rate = s.rate;
    if (prev.address === prev.street && s.address !== s.street) prev.address = s.address;
  }
  return [...by.values()];
}
export function buildSegments(ptillaten) {
  const all = (ptillaten?.features || []).map(f => normalize(f)).filter(Boolean);
  const merged = merge(all);
  // En lastplats ligger ofta på samma sträcka som vanlig parkering. Utanför lasttiden gäller då stadens taxa.
  return {
    car: merged.filter(s => s.cls === 'car' || s.cls === 'load'),
    hcp: merged.filter(s => s.cls === 'hcp'),
  };
}

// ---------- utvärdering ----------
const STEP = 15, HORIZON = 72 * 60;
function inPeriod(e, t) {
  const md = (t.getMonth() + 1) * 100 + t.getDate();
  const a = e.m1 * 100 + e.d1, b = e.m2 * 100 + e.d2;
  return a <= b ? md >= a && md <= b : md >= a || md <= b;
}
function winActive(win, t) {
  if (!win) return true;
  if (win.days && !win.days.includes(dayType(t))) return false;
  return inWin(hod(t), win.from, win.to);
}
function badAt(seg, t, used) {
  const h = hod(t);
  for (let i = 0; i < seg.rules.length; i++) {
    const r = seg.rules[i];
    if (r.k === 'servicedag' && t.getDay() === r.wd && inWin(h, r.from, r.to) && !(r.except && inPeriod(r.except, t)) && !(r.only && !inPeriod(r.only, t))) return { why: 'servicedag', r };
    if (r.k === 'lastzon' && winActive(r.win, t)) return { why: 'lastzon', r };
    if (r.k === 'maxtid' && used && winActive(r.win, t)) { used[i] = (used[i] || 0) + STEP; if (used[i] > r.h * 60) return { why: 'maxtid', r }; }
  }
  return null;
}
export function rateAt(seg, t, opts = {}) {
  const fee = seg.rules.find(r => r.k === 'avgift');
  if (!fee) return 0;
  if (fee.boende && opts.boende && seg.pdistrict && opts.boende.has(seg.pdistrict)) return 0;
  const dt = dayType(t), h = hod(t);
  for (const p of fee.periods) if (p.days.includes(dt) && inWin(h, p.from, p.to)) return p.rate;
  return fee.other || 0;
}
export function evaluate(seg, start, durMin, opts = {}) {
  const end = start + durMin * 60000, used = {};
  let cost = 0, first = null;
  for (let m = 0; m < HORIZON; m += STEP) {
    const ms = start + m * 60000, t = new Date(ms);
    const b = badAt(seg, t, used);
    if (b) { first = { t: ms, ...b }; break; }
    if (ms < end) cost += rateAt(seg, t, opts) * STEP / 60;
  }
  let status;
  if (first && first.t === start) status = 'stop';
  else if (first && first.t < end) status = 'cond';
  else status = Math.round(cost) === 0 ? 'free' : 'paid';
  let okFrom = null;
  if (status === 'stop') for (let m = STEP; m < HORIZON; m += STEP) { const t = new Date(start + m * 60000); if (!badAt(seg, t, null)) { okFrom = t.getTime(); break; } }
  return { status, cost: Math.round(cost), first, okFrom, start, end };
}

// Grov uppskattning av chansen att hitta en ledig plats. Ingen livedata finns för gatuparkering i Stockholm.
export function chance(seg, ev) {
  if (ev.status === 'stop') return { score: 0, label: '–' };
  const t = new Date(ev.start), h = hod(t), dt = dayType(t);
  const residential = !!(seg.rate && seg.rate.boende);
  const rateNow = rateAt(seg, t);
  let q;
  if (residential && (h >= 18 || h < 8)) q = 0.25;          // boende kommer hem
  else if (residential && dt !== 'v') q = 0.35;
  else if (rateNow >= 25) q = 0.65;                          // högt pris håller platser lediga
  else if (rateNow > 0) q = 0.5;
  else q = 0.35;                                             // gratis lockar
  if (!residential && (h >= 22 || h < 6)) q += 0.15;
  const sd = seg.rules.filter(r => r.k === 'servicedag');
  if (sd.some(r => { const n = new Date(ev.start); for (let i = 0; i < 16; i++) { n.setHours(n.getHours() + 1); if (n.getDay() === r.wd && inWin(hod(n), r.from, r.to)) return true; } return false; })) q += 0.2; // många flyttar inför servicedag
  if (ev.status === 'cond') q -= 0.1;
  q = Math.max(0.05, Math.min(0.9, q));
  const score = q * (1 - Math.exp(-seg.spots / 6));
  return { score, label: score > 0.4 ? 'Hög' : score > 0.2 ? 'Medel' : 'Låg' };
}

// ---------- text ----------
const pad = n => String(n).padStart(2, '0');
export const hh = h => { const H = Math.floor(h), M = Math.round((h - H) * 60); return M ? `${H}.${pad(M)}` : `${H}`; };
export function clock(ms, ref) {
  const t = new Date(ms), r = new Date(ref);
  const same = t.toDateString() === r.toDateString();
  return (same ? '' : WD_SHORT[t.getDay()] + ' ') + `${pad(t.getHours())}:${pad(t.getMinutes())}`;
}
export const durText = m => m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} tim`;
const DAYWORD = { v: 'vardagar', l: 'dag före helgdag', s: 'sön- och helgdagar' };
function periodText(p) {
  const days = p.days.length === 3 ? 'alla dagar' : p.days.map(d => DAYWORD[d]).join(' och ');
  return `${days} ${hh(p.from)}–${hh(p.to)}`;
}
const hhmm = h => `${pad(Math.floor(h))}.${pad(Math.round((h % 1) * 60))}`;
const daysText = d => !d || d.length === 3 ? 'alla dagar' : d.map(x => DAYWORD[x]).join(' och ');
const winText = w => w ? `${daysText(w.days)} ${hh(w.from)}–${hh(w.to)}` : 'hela dygnet';
const MON = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const exceptText = e => e ? ` Gäller inte ${e.d1} ${MON[e.m1 - 1]}–${e.d2} ${MON[e.m2 - 1]}.` : '';
const onlyText = e => e ? ` Gäller bara ${e.d1} ${MON[e.m1 - 1]}–${e.d2} ${MON[e.m2 - 1]}.` : '';
const sdText = r => `${WD_LONG[r.wd]}ar ${hhmm(r.from)}–${hhmm(r.to)}`;
export function ruleFacts(seg) {
  const out = [];
  if (seg.cls === 'hcp') out.push('Reserverad för rörelsehindrade med parkeringstillstånd.');
  if (seg.cls === 'general') out.push('Staden har inga parkeringsföreskrifter för den här gatan, så de allmänna reglerna gäller: gratis, högst 24 timmar i följd på vardagar. Inte närmare än 10 m från korsning eller övergångsställe och inte framför in- och utfarter.');
  for (const r of seg.rules) {
    if (r.k === 'avgift') {
      const groups = {};
      r.periods.forEach(p => (groups[p.rate] = groups[p.rate] || []).push(periodText(p)));
      Object.entries(groups).forEach(([rate, ps]) => out.push(`Avgift ${String(rate).replace('.', ',')} kr/tim${r.taxa ? ` (taxa ${r.taxa})` : ''}: ${ps.join(', ')}.`));
      out.push(r.other ? `Övrig tid ${String(r.other).replace('.', ',')} kr/tim.` : 'Övrig tid gratis.');
      if (r.boende) out.push(`Boendeparkering gäller${seg.pdistrict ? ` (${seg.pdistrict})` : ''}.`);
    }
    if (r.k === 'lastzon') out.push(`Lastplats ${winText(r.win)}. Då får du bara lasta och lossa. Övrig tid får du parkera.`);
    if (r.k === 'maxtid' && seg.cls === 'general') continue;
    if (r.k === 'maxtid') out.push(`Längst ${r.h} ${r.h === 1 ? 'timme' : 'timmar'} i följd${r.win ? ' ' + winText(r.win) : ''}.`);
    if (r.k === 'servicedag') out.push(`Förbud att parkera ${sdText(r)} (servicetid).${exceptText(r.except)}${onlyText(r.only)}`);
  }
  if (!seg.rules.some(r => r.k === 'avgift') && seg.cls !== 'general') out.unshift(seg.rate && seg.rate.free ? 'Avgiftsfri.' : 'Ingen avgift.');
  return out;
}
const WHY = {
  servicedag: r => `servicetid ${sdText(r)}`,
  maxtid: r => `max ${r.h} tim`,
  lastzon: r => `lastplats ${winText(r.win)}`,
};
export function verdict(ev, durMin) {
  const { status, cost, first, okFrom, start } = ev;
  const stay = first ? ` Du kan stå kvar till ${clock(first.t, start)}.` : '';
  if (status === 'free') return `Gratis i ${durText(durMin)}.${stay}`;
  if (status === 'paid') return `Ca ${cost} kr för ${durText(durMin)}.${stay}`;
  if (status === 'cond') return `Du får stå här, men måste flytta bilen senast ${clock(first.t, start)} (${WHY[first.why](first.r)}).${cost ? ` Kostar ca ${cost} kr fram till dess.` : ''}`;
  return `Inte tillåtet nu: ${WHY[first.why](first.r)}.${okFrom ? ` Du får parkera från ${clock(okFrom, start)}.` : ''}`;
}
export function shortStatus(ev) {
  const { status, first, okFrom, start } = ev;
  if (status === 'free') return first ? `Gratis · till ${clock(first.t, start)}` : 'Gratis';
  if (status === 'paid') return first ? `Avgift · till ${clock(first.t, start)}` : 'Avgift';
  if (status === 'cond') return `Flytta senast ${clock(first.t, start)}`;
  const what = first && first.why === 'lastzon' ? 'Lastplats' : 'Förbjudet';
  return okFrom ? `${what} till ${clock(okFrom, start)}` : what;
}
// Tilläggstavlor i skyltspråk: vardag "8-19", dag före helgdag "(9-15)", söndag i rött.
function timesFor(daysList, from, to) {
  const by = { v: null, l: null, s: null };
  (daysList || ['v', 'l', 's']).forEach(d => { by[d] = `${hh(from)}-${hh(to)}`; });
  return { times: by };
}
export function signPlates(seg) {
  const groups = [];
  const fee = seg.rules.find(r => r.k === 'avgift'), max = seg.rules.find(r => r.k === 'maxtid');
  for (const r of seg.rules.filter(x => x.k === 'lastzon')) groups.push({ sign: 'P', plates: [{ text: 'Lastplats' }, timesFor(r.win.days, r.win.from, r.win.to)] });
  const plates = [];
  if (seg.cls === 'hcp') plates.push({ text: 'Rörelsehindrad' });
  if (fee) {
    plates.push({ text: 'Avgift' });
    const by = { v: null, l: null, s: null };
    fee.periods.forEach(p => p.days.forEach(d => { if (!by[d]) by[d] = `${hh(p.from)}-${hh(p.to)}`; }));
    plates.push({ times: by });
  }
  if (max) { plates.push({ text: `${max.h} tim` }); if (max.win) plates.push(timesFor(max.win.days, max.win.from, max.win.to)); }
  if (fee && fee.boende) plates.push({ text: 'Boende' });
  groups.push({ sign: 'P', plates });
  seg.rules.filter(r => r.k === 'servicedag').forEach(r => groups.push({ sign: 'noP', plates: [{ text: `${WD_SIGN[r.wd]} ${hh(r.from)}-${hh(r.to)}` }, ...(r.except ? [{ text: `utom ${r.except.d1}/${r.except.m1}–${r.except.d2}/${r.except.m2}` }] : []), ...(r.only ? [{ text: `${r.only.d1}/${r.only.m1}–${r.only.d2}/${r.only.m2}` }] : [])] }));
  return groups;
}

// ---------- gator utan föreskrifter (OpenStreetMap) ----------
// Gator där staden saknar parkeringsföreskrifter följer de allmänna reglerna i trafikförordningen:
// högst 24 timmar i följd på vardagar, inte inom 10 m från korsning. Gatunätet hämtas från OpenStreetMap.
export const GENERAL_HIGHWAYS = ['residential', 'unclassified', 'living_street', 'tertiary'];
const NO_PARK = v => /^(no|no_parking|no_stopping|separate)$/i.test(String(v || ''));
function osmNoParking(tags) {
  for (const side of ['both', 'left', 'right']) {
    if (NO_PARK(tags[`parking:${side}`]) || NO_PARK(tags[`parking:${side}:restriction`]) || NO_PARK(tags[`parking:lane:${side}`])) return true;
  }
  return /^(private|no)$/.test(tags.access || '') || tags.area === 'yes';
}
function cutLine(coords, pieceM) {
  const out = [];
  let cur = [coords[0]], acc = 0;
  for (let i = 1; i < coords.length; i++) {
    let a = coords[i - 1]; const b = coords[i];
    let segLen = lengthM([[a, b]]);
    while (acc + segLen >= pieceM) {
      const t = (pieceM - acc) / segLen;
      const p = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      cur.push(p); out.push(cur); cur = [p]; a = p; segLen = lengthM([[a, b]]); acc = 0;
    }
    cur.push(b); acc += segLen;
  }
  if (cur.length > 1 && acc > 3) out.push(cur);
  return out;
}
export function generalSegments(osm, ltf, opts = {}) {
  const ways = (osm?.elements || []).filter(e => e.type === 'way' && e.geometry && e.tags && e.tags.name && GENERAL_HIGHWAYS.includes(e.tags.highway));
  const ltfStreets = new Set(ltf.filter(s => s.cls !== 'hcp').map(s => (s.street || '').toLowerCase()));
  // Korsning = nod som delas av vägar med olika namn (en gata som bara är uppdelad i flera delar räknas inte).
  // Övergångsställen (highway=crossing) behandlas likadant.
  const nodeNames = new Map(), nodePos = new Map();
  for (const w of (osm?.elements || [])) if (w.type === 'way' && w.nodes && w.geometry) w.nodes.forEach((n, i) => {
    if (!nodeNames.has(n)) nodeNames.set(n, new Set());
    nodeNames.get(n).add(w.tags?.name || 'way' + w.id);
    if (w.geometry[i]) nodePos.set(n, [w.geometry[i].lon, w.geometry[i].lat]);
  });
  const junctions = [];
  for (const [n, names] of nodeNames) if (names.size > 1 && nodePos.has(n)) junctions.push(nodePos.get(n));
  for (const e of (osm?.elements || [])) if (e.type === 'node' && e.tags && e.tags.highway === 'crossing') junctions.push([e.lon, e.lat]);
  const ltfLines = ltf.flatMap(s => s.lines);
  const out = [];
  for (const w of ways) {
    const name = w.tags.name;
    if (ltfStreets.has(name.toLowerCase())) continue;   // gatan har föreskrifter: lita bara på dem
    if (osmNoParking(w.tags)) continue;
    const coords = w.geometry.map(g => [g.lon, g.lat]);
    // 5 m-bitar; släng bitar inom 10 m från korsning eller nära en sträcka med föreskrift, foga ihop resten
    const runs = []; let run = null;
    for (const bit of cutLine(coords, 5)) {
      const m = midpoint([bit]);
      const bad = junctions.some(j => distToLines(m, [[j, j]]) < 10) || (ltfLines.length && distToLines(m, ltfLines) < 8);
      if (bad) { if (run) { runs.push(run); run = null; } continue; }
      if (!run) run = [...bit]; else run.push(...bit.slice(1));
    }
    if (run) runs.push(run);
    let i = 0;
    for (const r of runs) for (const piece of cutLine(r, 40)) {
      const lines = [piece], len = lengthM(lines);
      if (len < 6) continue;
      out.push({
        id: `osm.${w.id}.${i++}`, kind: 'osm', cls: 'general', p: { OSM_ID: w.id, highway: w.tags.highway, name }, raws: [{ OSM_ID: w.id, highway: w.tags.highway, name }],
        lines, street: name, address: name, district: '', pdistrict: '', type: 'Allmänna regler',
        vehicle: 'fordon', citation: '', rdt: '', otherInfo: '', rate: null, citations: [],
        rules: [{ k: 'maxtid', h: 24, win: { days: ['v'], from: 0, to: 24 } }],
        lengthM: len, spots: Math.max(1, Math.round(len / 5.5) * 2), mid: midpoint(lines),
      });
    }
  }
  return out;
}
// Kopplar servicedagar (från stadens servicedagar-tjänst) till gator utan föreskrifter.
export function attachService(segs, servicedagar) {
  const sds = (servicedagar?.features || []).map(f => ({ lines: geomLines(f.geometry), street: (f.properties.STREET_NAME || '').toLowerCase(), r: serviceFromServicedagar(f.properties), p: f.properties })).filter(x => x.r && x.lines.length);
  for (const s of segs) for (const sd of sds) {
    if (sd.street && sd.street !== s.street.toLowerCase()) continue;
    if (distToLines(s.mid, sd.lines) > 15) continue;
    if (!s.rules.some(x => x.k === 'servicedag' && x.wd === sd.r.wd && x.from === sd.r.from)) {
      s.rules.push(sd.r);
      if (sd.p.CITATION && !s.citations.some(c => c.c === sd.p.CITATION)) s.citations.push({ c: sd.p.CITATION, u: sd.p.RDT_URL || '' });
      s.raws.push(sd.p);
    }
  }
  return segs;
}
