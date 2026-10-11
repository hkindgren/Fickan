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

const DAYGROUPS = [
  [/^alla\s+dagar/, ['v', 'l', 's']],
  [/^dygnet\s+runt/, ['v', 'l', 's']],
  [/^vardag(?:ar)?(?:\s+utom\s+dag\s+före\s+(?:sön-\s*och\s*)?helgdag(?:ar)?)?/, ['v']],
  [/^(?:dag\s+före\s+(?:sön-\s*och\s*)?helgdag(?:ar)?|lördag(?:ar)?)/, ['l']],
  [/^(?:sön-\s*och\s*helgdag(?:ar)?|helgdag(?:ar)?|söndag(?:ar)?)/, ['s']],
];
// "taxa 4: 10 kr/tim vardagar 7-19, dag före helgdag 11-17, Boende: 500 kr/månad eller 35 kr/dygn"
export function parseRate(text) {
  if (!text) return null;
  const out = { raw: String(text), taxa: null, periods: [], other: 0, boende: /boende/i.test(text) };
  let t = String(text).replace(/\s+/g, ' ').trim();
  const tm = t.match(/taxa\s*([0-9A-Za-zÅÄÖåäö]+)/i);
  if (tm) out.taxa = tm[1];
  t = t.split(/boende/i)[0].replace(/^.*?taxa\s*[0-9A-Za-zÅÄÖåäö]+\s*:?\s*/i, '');
  let rate = null;
  for (let part of t.split(/[,;]/)) {
    part = part.trim().toLowerCase();
    if (!part) continue;
    const rm = part.match(/(\d+(?:[.,]\d+)?)\s*kr\s*\/\s*(?:tim(?:me)?|h)\b/);
    if (rm) { rate = parseFloat(rm[1].replace(',', '.')); part = part.replace(rm[0], ' ').replace(/\s+/g, ' ').trim(); }
    if (/^övrig(?:a)?\s+tid/.test(part)) { if (rm) out.other = rate; continue; }
    let rest = part, matched = false;
    while (rest) {
      let days = null, len = 0;
      for (const [re, d] of DAYGROUPS) { const m = rest.match(re); if (m) { days = d; len = m[0].length; break; } }
      if (!days) break;
      rest = rest.slice(len).trim().replace(/^kl\.?\s*/, '');
      const w = rest.match(/^(\d{1,2})(?:[.:](\d\d))?\s*[-–]\s*(\d{1,2})(?:[.:](\d\d))?/);
      let from = 0, to = 24;
      if (w) { from = +w[1] + (+w[2] || 0) / 60; to = +w[3] + (+w[4] || 0) / 60; rest = rest.slice(w[0].length).trim(); }
      if (rate !== null) out.periods.push({ days, from, to, rate });
      matched = true;
    }
    if (!matched && rm && part === '') out.periods.push({ days: ['v', 'l', 's'], from: 0, to: 24, rate });
  }
  return out;
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
function serviceRule(p) {
  const wd = weekdayIndex(p.START_WEEKDAY);
  if (wd === null) return null;
  return {
    k: 'servicedag', wd,
    from: parseHM(p.START_TIME) ?? 0, to: parseHM(p.END_TIME) ?? 6,
    m1: p.START_MONTH ?? null, m2: p.END_MONTH ?? null, d1: p.START_DAY ?? null, d2: p.END_DAY ?? null,
  };
}
export function normalize(f, kind) {
  const p = f.properties || {}, lines = geomLines(f.geometry);
  if (!lines.length) return null;
  const seg = {
    id: String(f.id || `${kind}.${p.FID ?? Math.random()}`), kind, p, lines,
    street: p.STREET_NAME || '', address: p.ADDRESS || p.STREET_NAME || 'Okänd adress',
    district: p.CITY_DISTRICT || '', pdistrict: p.PARKING_DISTRICT || '',
    type: p.VF_PLATS_TYP || '', vehicle: p.VEHICLE || '', citation: p.CITATION || '', rdt: p.RDT_URL || '',
    otherInfo: p.OTHER_INFO || '', rate: parseRate(p.PARKING_RATE), rules: [],
  };
  seg.lengthM = lengthM(lines);
  seg.spots = p.VF_PLATS_TYP && /rörelsehindrad/i.test(p.VF_PLATS_TYP) ? 1 : Math.max(1, Math.round(seg.lengthM / 5.5));
  seg.mid = midpoint(lines);
  if (kind === 'servicedagar') { const r = serviceRule(p); if (r) seg.rules.push(r); return seg; }
  if (seg.rate && seg.rate.periods.length) seg.rules.push({ k: 'avgift', ...seg.rate });
  const maxH = Number(p.MAX_HOURS);
  const win = parseHM(p.START_TIME) !== null && parseHM(p.END_TIME) !== null
    ? { from: parseHM(p.START_TIME), to: parseHM(p.END_TIME), wd: weekdayIndex(p.START_WEEKDAY) } : null;
  if (maxH > 0) seg.rules.push({ k: 'maxtid', h: maxH, win });
  else if (win && kind === 'ptillaten') seg.rules.push({ k: 'fonster', win }); // parkering tillåten bara inom tidsfönstret (verifieras mot riktig data)
  return seg;
}
const carOK = v => !v || /(personbil|bil$|fordon|^bil)/i.test(v) && !/(lastbil|buss|motorcykel|moped)/i.test(v);
export function buildSegments(ptillaten, servicedagar) {
  const segs = (ptillaten?.features || []).map(f => normalize(f, 'ptillaten')).filter(s => s && carOK(s.vehicle));
  const sds = (servicedagar?.features || []).map(f => normalize(f, 'servicedagar')).filter(Boolean);
  for (const s of segs) {
    for (const sd of sds) {
      if (!sd.rules.length) continue;
      if (sd.street && s.street && sd.street.toLowerCase() !== s.street.toLowerCase()) continue;
      if (distToLines(s.mid, sd.lines) > 12) continue;
      const r = sd.rules[0];
      if (!s.rules.some(x => x.k === 'servicedag' && x.wd === r.wd && x.from === r.from)) s.rules.push({ ...r, citation: sd.citation, rdt: sd.rdt });
    }
  }
  return segs;
}

// ---------- utvärdering ----------
const STEP = 15, HORIZON = 72 * 60;
function seasonOK(r, t) {
  if (r.m1 == null || r.m2 == null) return true;
  const md = (t.getMonth() + 1) * 100 + t.getDate();
  const a = r.m1 * 100 + (r.d1 || 1), b = r.m2 * 100 + (r.d2 || 31);
  return a <= b ? md >= a && md <= b : md >= a || md <= b;
}
function winActive(win, t) {
  if (!win) return true;
  if (win.wd !== null && win.wd !== undefined && t.getDay() !== win.wd) return false;
  return inWin(hod(t), win.from, win.to);
}
function badAt(seg, t, used) {
  const h = hod(t);
  for (let i = 0; i < seg.rules.length; i++) {
    const r = seg.rules[i];
    if (r.k === 'servicedag' && t.getDay() === r.wd && inWin(h, r.from, r.to) && seasonOK(r, t)) return { why: 'servicedag', r };
    if (r.k === 'fonster' && !winActive(r.win, t)) return { why: 'fonster', r };
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
const winText = w => w ? `${w.wd != null ? WD_LONG[w.wd] + 'ar ' : ''}${hh(w.from)}–${hh(w.to)}` : 'hela dygnet';
export function ruleFacts(seg) {
  const out = [];
  for (const r of seg.rules) {
    if (r.k === 'avgift') {
      const groups = {};
      r.periods.forEach(p => (groups[p.rate] = groups[p.rate] || []).push(periodText(p)));
      Object.entries(groups).forEach(([rate, ps]) => out.push(`Avgift ${rate} kr/tim${r.taxa ? ` (taxa ${r.taxa})` : ''}: ${ps.join(', ')}.`));
      out.push(r.other ? `Övrig tid ${r.other} kr/tim.` : 'Övrig tid gratis.');
      if (r.boende) out.push(`Boendeparkering gäller${seg.pdistrict ? ` (${seg.pdistrict})` : ''}.`);
    }
    if (r.k === 'maxtid') out.push(`Längst ${r.h} ${r.h === 1 ? 'timme' : 'timmar'} i följd${r.win ? ' ' + winText(r.win) : ''}.`);
    if (r.k === 'fonster') out.push(`Parkering tillåten ${winText(r.win)}.`);
    if (r.k === 'servicedag') out.push(`Servicedag ${WD_LONG[r.wd]} ${pad(Math.floor(r.from))}–${pad(Math.floor(r.to))}${r.m1 ? ` (månad ${r.m1}–${r.m2})` : ''}. Då får ingen bil stå här.`);
  }
  if (!seg.rules.some(r => r.k === 'avgift')) out.unshift('Ingen avgift.');
  return out;
}
const WHY = {
  servicedag: r => `servicedag ${WD_LONG[r.wd]} ${pad(Math.floor(r.from))}–${pad(Math.floor(r.to))}`,
  maxtid: r => `max ${r.h} tim`,
  fonster: r => `tillåtet bara ${winText(r.win)}`,
};
export function verdict(ev, durMin) {
  const { status, cost, first, okFrom, start } = ev;
  const stay = first ? ` Du kan stå kvar till ${clock(first.t, start)}.` : '';
  if (status === 'free') return `Gratis i ${durText(durMin)}.${stay}`;
  if (status === 'paid') return `Ca ${cost} kr för ${durText(durMin)}.${stay}`;
  if (status === 'cond') return `Du får stå här, men måste flytta bilen senast ${clock(first.t, start)} (${WHY[first.why](first.r)}).${cost ? ` Kostar ca ${cost} kr fram till dess.` : ''}`;
  return `Inte tillåtet nu: ${WHY[first.why](first.r)}.${okFrom ? ` Tillåtet igen från ${clock(okFrom, start)}.` : ''}`;
}
export function shortStatus(ev) {
  const { status, first, okFrom, start } = ev;
  if (status === 'free') return first ? `Gratis · till ${clock(first.t, start)}` : 'Gratis';
  if (status === 'paid') return first ? `Avgift · till ${clock(first.t, start)}` : 'Avgift';
  if (status === 'cond') return `Flytta senast ${clock(first.t, start)}`;
  return okFrom ? `Förbjudet till ${clock(okFrom, start)}` : 'Förbjudet';
}
// Tilläggstavlor i skyltspråk: vardag "8-19", dag före helgdag "(9-15)", söndag i rött.
export function signPlates(seg) {
  const groups = [];
  const fee = seg.rules.find(r => r.k === 'avgift'), max = seg.rules.find(r => r.k === 'maxtid'), win = seg.rules.find(r => r.k === 'fonster');
  if (fee || max || win) {
    const plates = [];
    if (fee) {
      plates.push({ text: 'Avgift' });
      const by = { v: null, l: null, s: null };
      fee.periods.forEach(p => p.days.forEach(d => { if (!by[d]) by[d] = `${hh(p.from)}-${hh(p.to)}`; }));
      plates.push({ times: by });
    }
    if (max) { plates.push({ text: `${max.h} tim` }); if (max.win) plates.push({ text: `${hh(max.win.from)}-${hh(max.win.to)}` }); }
    if (win) plates.push({ text: `${hh(win.win.from)}-${hh(win.win.to)}` });
    if (fee && fee.boende) plates.push({ text: 'Boende' });
    groups.push({ sign: 'P', plates });
  } else groups.push({ sign: 'P', plates: [] });
  seg.rules.filter(r => r.k === 'servicedag').forEach(r => groups.push({ sign: 'noP', plates: [{ text: `${WD_SIGN[r.wd]} ${Math.floor(r.from)}-${Math.floor(r.to)}` }] }));
  return groups;
}
