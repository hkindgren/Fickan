import {
  buildSegments, generalSegments, attachService, forbudSegments, evaluate, chance, verdict, shortStatus, ruleFacts, signPlates,
  distToLines, durText, WD_SHORT,
} from './rules.js?v=202610122331';
import { planRoutes, departures, navLinks } from './route.js?v=202610122331';
import { GANTRIES } from './toll.js?v=202610122331';

const L = window.L;
const API = 'https://openparking.stockholm.se/LTF-Tolken/v1/';
const RADIUS = 500;
const DURS = [30, 60, 120, 180, 240, 480, 720];
const COL = { free: 'var(--free)', paid: 'var(--paid)', cond: 'var(--cond)', stop: 'var(--stop)', load: 'var(--load)' };
const look = ev => ev.status === 'stop' && ev.first && ev.first.why === 'lastzon' ? 'load' : ev.status;
const CSS = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- lagring (bara i den här webbläsaren) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('fickan:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('fickan:' + k, JSON.stringify(v)); } catch { /* privat läge */ } },
};

const st = window.fickanState = {
  key: store.get('apiKey', ''),
  boende: new Set(store.get('boende', [])),
  hcp: store.get('hcp', false),
  dayOff: 0, slot: 0, dur: store.get('dur', 120), sort: store.get('sort', 'smart'),
  dest: null, destLabel: '', destSub: '',
  segs: [], hcpSegs: [], sel: null, results: new Map(), districts: new Set(store.get('districts', [])),
};

// Resplanering (se längst ner)
const trip = { from: null, fromLabel: '', routes: [], pick: 0, dep: 0, base: 0, abort: null, msg: '' };

// ---------- karta ----------
const map = L.map('map', { zoomControl: true, attributionControl: true }).setView([59.334, 18.063], 13);
// Kartstilar, som "Standard / Satellit / Ljus" i Google Maps. Valet sparas i webbläsaren.
const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
const BASEMAPS = {
  standard: L.tileLayer(ESRI + 'World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Karta © Esri, HERE, Garmin, ' + OSM_ATTR }),
  satellit: L.tileLayer(ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Bilder © Esri, Maxar, Earthstar Geographics' }),
  ljus: L.layerGroup([
    L.tileLayer(ESRI + 'Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, maxNativeZoom: 16, attribution: 'Karta © Esri, HERE, Garmin, ' + OSM_ATTR }),
    L.tileLayer(ESRI + 'Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, maxNativeZoom: 16 }),
  ]),
  osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: OSM_ATTR }),
};
const BASENAMES = { standard: 'Standard', satellit: 'Satellit', ljus: 'Ljus', osm: 'OpenStreetMap' };
let base = store.get('basemap', 'standard');
if (!BASEMAPS[base]) base = 'standard';
BASEMAPS[base].addTo(map);
document.documentElement.dataset.basemap = base;
const baseCtl = L.control({ position: 'topright' });
baseCtl.onAdd = () => {
  const div = L.DomUtil.create('div', 'basepick');
  div.setAttribute('role', 'group'); div.setAttribute('aria-label', 'Kartstil');
  div.innerHTML = Object.entries(BASENAMES).map(([k, n]) => `<button type="button" data-k="${k}" aria-pressed="${k === base}">${n}</button>`).join('');
  L.DomEvent.disableClickPropagation(div);
  div.querySelectorAll('button').forEach(b => b.onclick = () => {
    map.removeLayer(BASEMAPS[base]); base = b.dataset.k; BASEMAPS[base].addTo(map); if (BASEMAPS[base].bringToBack) BASEMAPS[base].bringToBack();
    store.set('basemap', base); document.documentElement.dataset.basemap = base;
    div.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
  });
  return div;
};
baseCtl.addTo(map);
const routeLayer = L.layerGroup().addTo(map);
const segLayer = L.layerGroup().addTo(map);
const topLayer = L.layerGroup().addTo(map);
let destMarker = null;
const PIN = `<svg viewBox="0 0 30 40" width="30" height="40"><path d="M15 39C6 26 2 21 2 14a13 13 0 1 1 26 0c0 7-4 12-13 25z" fill="#15202b" stroke="#fff" stroke-width="2"/><circle cx="15" cy="14" r="5" fill="#fff"/></svg>`;

map.on('click', e => setDest([e.latlng.lng, e.latlng.lat], 'Vald punkt på kartan', ''));

// ---------- hämtning ----------
let jsonpN = 0;
function jsonp(url, ms = 20000) {
  return new Promise((resolve, reject) => {
    const cb = '__fickan' + (++jsonpN), s = document.createElement('script');
    const timer = setTimeout(() => { clean(); reject(new Error('timeout')); }, ms);
    function clean() { clearTimeout(timer); try { delete window[cb]; } catch { window[cb] = undefined; } s.remove(); }
    window[cb] = data => { clean(); resolve(data); };
    s.onerror = () => { clean(); reject(new Error('network')); };
    s.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cb;
    document.head.appendChild(s);
  });
}
async function getJSON(url) {
  let r;
  try { r = await fetch(url); } catch { return jsonp(url); }   // CORS saknas: tjänsten stöder JSONP
  if (r.status === 401 || r.status === 403) throw new Error('badkey');
  if (!r.ok) throw new Error('http ' + r.status);
  return r.json();
}
const cache = new Map();
// Gatunät från OpenStreetMap (Overpass) för gator där staden saknar föreskrifter.
const OVERPASS = 'https://overpass-api.de/api/interpreter';
async function fetchOSM(lngLat) {
  const [lng, lat] = lngLat;
  const q = `[out:json][timeout:20];(way(around:${RADIUS + 100},${lat},${lng})[highway~"^(residential|unclassified|living_street|tertiary|secondary|primary|service)$"];node(around:${RADIUS + 100},${lat},${lng})[highway=crossing];);out geom;`;
  const r = await fetch(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  if (!r.ok) throw new Error('osm ' + r.status);
  return r.json();
}
// Stadens kartdatabas (OGC API Features) har lager som parkerings-API:et saknar, t.ex. förbud per gatusida.
const OGC = () => `https://openstreetgs.stockholm.se/geoservice/api/${encodeURIComponent(st.key)}/ogc/features/v1/collections`;
function bboxAround([lng, lat], m) {
  const dLat = m / 111320, dLng = m / (111320 * Math.cos(lat * Math.PI / 180));
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat].map(v => v.toFixed(6)).join(',');
}
async function fetchLayer(name, lngLat) {
  const r = await fetch(`${OGC()}/${name}/items?f=json&limit=3000&bbox=${bboxAround(lngLat, RADIUS + 100)}`);
  if (!r.ok) throw new Error(name + ' ' + r.status);
  return r.json();
}
async function fetchRules(lngLat) {
  const k = lngLat.map(v => v.toFixed(4)).join(',');
  if (cache.has(k)) return cache.get(k);
  const q = `within?radius=${RADIUS}&lat=${lngLat[1]}&lng=${lngLat[0]}&outputFormat=json&apiKey=${encodeURIComponent(st.key)}`;
  // Servicetider och platser för rörelsehindrade finns redan i ptillaten.
  const [p, osm, forbud, service] = await Promise.all([
    getJSON(API + 'ptillaten/' + q),
    fetchOSM(lngLat).catch(() => null),
    fetchLayer('LTFR_P_FORBUD', lngLat).catch(() => null),
    fetchLayer('LTFR_SERVICEDAG', lngLat).catch(() => null),
  ]);
  if (!p || !Array.isArray(p.features)) throw new Error('badkey');
  const out = buildSegments(p);
  const fb = forbudSegments(forbud);
  out.forbud = fb.filter(s => s.cls === 'forbud');
  const timed = fb.filter(s => s.cls === 'general');
  out.general = [];
  if (osm) {
    const gen = generalSegments(osm, [...out.car, ...out.hcp], fb).filter(s => distToLines(lngLat, s.lines) <= RADIUS + 50);
    if (service) attachService(gen, service);
    out.general = gen;
  }
  out.general.push(...timed);
  out.partial = { osm: !!osm, forbud: !!forbud, service: !!service };
  cache.set(k, out);
  return out;
}

function showStatus(text, err = false) {
  const el = $('status');
  if (!text) { el.hidden = true; return; }
  el.hidden = false; el.textContent = text; el.classList.toggle('err', err);
}

async function setDest(lngLat, label, sub) {
  trip.routes = []; trip.msg = ''; routeLayer.clearLayers();
  st.dest = lngLat; st.destLabel = label; st.destSub = sub; st.sel = null;
  if (destMarker) destMarker.remove();
  destMarker = L.marker([lngLat[1], lngLat[0]], { icon: L.divIcon({ className: 'destpin', html: PIN, iconSize: [30, 40], iconAnchor: [15, 39] }), interactive: false }).addTo(map);
  map.setView([lngLat[1], lngLat[0]], Math.max(map.getZoom(), 16));
  $('destLine').innerHTML = `${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}`;
  if (!st.key) { renderWelcome(); return; }
  showStatus('Hämtar parkeringsregler…');
  try {
    const d = await fetchRules(lngLat);
    st.segs = [...d.car, ...d.general, ...d.forbud];
    st.hcpSegs = d.hcp;
    st.segs.forEach(s => s.pdistrict && st.districts.add(s.pdistrict));
    store.set('districts', [...st.districts].sort());
    showStatus(st.segs.length ? '' : 'Inga parkeringsregler hittades inom 500 m.');
  } catch (e) {
    st.segs = []; st.hcpSegs = [];
    showStatus(e.message === 'badkey'
      ? 'Staden godkände inte API-nyckeln. Kontrollera den under Inställningar.'
      : 'Kunde inte nå Stockholms stads tjänst. Försök igen om en stund.', true);
  }
  render();
}

// ---------- adressök (OpenStreetMap Nominatim) ----------
$('searchForm').addEventListener('submit', async e => {
  e.preventDefault();
  const q = $('q').value.trim(); if (!q) return;
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=se'
    + '&viewbox=17.75,59.45,18.25,59.20&bounded=1&accept-language=sv&q=' + encodeURIComponent(/stockholm/i.test(q) ? q : q + ', Stockholm');
  const box = $('suggest');
  try {
    const res = await (await fetch(url)).json();
    if (!res.length) { box.hidden = false; box.innerHTML = '<li class="empty">Hittade ingen sådan adress i Stockholm.</li>'; return; }
    const pick = r => {
      const a = r.address || {};
      const label = [a.road, a.house_number].filter(Boolean).join(' ') || r.name || r.display_name.split(',')[0];
      const sub = [a.suburb || a.city_district, a.postcode].filter(Boolean).join(', ');
      box.hidden = true; $('q').value = label;
      setDest([+r.lon, +r.lat], label, sub);
    };
    if (res.length === 1) return pick(res[0]);
    box.innerHTML = res.map((r, i) => `<li><button type="button" data-i="${i}">${esc(r.display_name.split(',').slice(0, 2).join(','))}<br><small>${esc(r.display_name.split(',').slice(2, 4).join(','))}</small></button></li>`).join('');
    box.hidden = false;
    box.querySelectorAll('button').forEach(b => b.onclick = () => pick(res[+b.dataset.i]));
  } catch {
    box.hidden = false; box.innerHTML = '<li class="empty">Adressöket svarar inte just nu. Tryck på kartan i stället.</li>';
  }
});
document.addEventListener('click', e => { if (!$('searchForm').contains(e.target)) $('suggest').hidden = true; });

$('locate').onclick = () => {
  if (!navigator.geolocation) return showStatus('Din webbläsare kan inte dela plats.', true);
  showStatus('Hämtar din plats…');
  navigator.geolocation.getCurrentPosition(
    p => setDest([p.coords.longitude, p.coords.latitude], 'Din plats', ''),
    () => showStatus('Fick inte tillgång till din plats.', true),
    { enableHighAccuracy: true, timeout: 10000 });
};

// ---------- beräkning ----------
function startMs() { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + st.dayOff); return d.getTime() + st.slot * 15 * 60000; }
const pool = () => st.hcp ? [...st.segs, ...st.hcpSegs] : st.segs;
const walk = s => Math.round(distToLines(st.dest, s.lines) * 1.25 / 10) * 10;
const okFor = ev => ev.status !== 'stop';

function ranked() {
  const list = pool().filter(s => okFor(st.results.get(s.id).ev) && walk(s) <= RADIUS);
  const score = s => {
    const { ev, ch } = st.results.get(s.id), pen = (ev.status === 'cond' ? 40 : 0) + (s.cls === 'load' ? 60 : 0) + (s.cls === 'general' ? 15 : 0);
    if (st.sort === 'near') return walk(s) + pen;
    if (st.sort === 'cheap') return ev.cost * 1000 + walk(s) + pen * 10;
    if (st.sort === 'chance') return -ch.score * 1000 + walk(s) / 10 + pen;
    return ev.cost + walk(s) / 20 + pen - ch.score * 20;
  };
  return list.sort((a, b) => score(a) - score(b));
}

// ---------- rendering ----------
function render() {
  const start = startMs(), t = new Date(start);
  $('timeOut').textContent = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  st.results = new Map(pool().map(s => {
    const ev = evaluate(s, start, st.dur, { boende: st.boende });
    return [s.id, { ev, ch: chance(s, ev) }];
  }));
  const r = st.dest ? ranked() : [];
  renderWelcome(); renderMap(r); renderInsight(); renderList(r); renderDetail(); renderTrip();
}

function renderWelcome() { $('welcome').hidden = !!st.key; }

function renderMap(r) {
  segLayer.clearLayers(); topLayer.clearLayers();
  for (const s of pool()) {
    const { ev } = st.results.get(s.id), sel = s.id === st.sel;
    const ll = s.lines.map(line => line.map(([x, y]) => [y, x]));
    if (sel) L.polyline(ll, { color: CSS('--ink'), weight: 12, opacity: .9, interactive: false }).addTo(segLayer);
    L.polyline(ll, { color: CSS('--' + look(ev)), weight: s.cls === 'general' ? 5 : 6, opacity: s.cls === 'general' ? .8 : .95, dashArray: s.cls === 'general' ? '8 6' : null, lineCap: 'round', bubblingMouseEvents: false })
      .on('click', () => select(s.id))
      .bindTooltip(`${s.address}: ${shortStatus(ev)}`, { sticky: true })
      .addTo(segLayer);
  }
  if (!st.hcp) for (const s of st.hcpSegs) {
    L.polyline(s.lines.map(line => line.map(([x, y]) => [y, x])), { color: CSS('--hcp'), weight: 5, dashArray: '4 5', bubblingMouseEvents: false })
      .bindTooltip(`${s.address}: reserverad för rörelsehindrade med tillstånd`, { sticky: true }).addTo(segLayer);
  }
  r.slice(0, 5).forEach((s, i) => {
    const { ev } = st.results.get(s.id);
    L.marker([s.mid[1], s.mid[0]], { bubblingMouseEvents: false, icon: L.divIcon({ className: '', html: `<div class="rankpin" style="background:${COL[look(ev)]}">${i + 1}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }) })
      .on('click', () => select(s.id)).addTo(topLayer);
  });
}

function renderInsight() {
  const box = $('insight');
  const full = pool().filter(s => ['free', 'paid'].includes(st.results.get(s.id).ev.status) && walk(s) <= RADIUS);
  if (!st.dest || !st.segs.length) { box.hidden = true; return; }
  box.hidden = false;
  if (!full.length) { box.innerHTML = `Ingen gata inom 500 m räcker för ${durText(st.dur)}. Prova kortare tid eller annan ankomst.`; return; }
  const near = full.reduce((a, b) => walk(a) <= walk(b) ? a : b), nc = st.results.get(near.id).ev.cost;
  const nearby = full.filter(s => walk(s) <= walk(near) + 300);
  const cheap = nearby.reduce((a, b) => { const ca = st.results.get(a.id).ev.cost, cb = st.results.get(b.id).ev.cost; return cb < ca || (cb === ca && walk(b) < walk(a)) ? b : a; });
  const cc = st.results.get(cheap.id).ev.cost;
  box.innerHTML = cheap.id !== near.id && nc - cc >= 10
    ? `Närmast är <b>${esc(near.address)}</b>, ${walk(near)} m, för <b>${nc} kr</b>. Gå <b>${walk(cheap) - walk(near)} m</b> längre till <b>${esc(cheap.address)}</b> och betala ${cc} kr. <span class="save">Du sparar ${nc - cc} kr.</span>`
    : `Närmast är <b>${esc(near.address)}</b>, ${walk(near)} m, för <b>${nc} kr</b> i ${durText(st.dur)}. Inget billigare inom 300 m till.`;
}

function renderList(r) {
  if (!st.dest) { $('list').innerHTML = ''; return; }
  $('list').innerHTML = r.slice(0, 12).map((s, i) => {
    const { ev, ch } = st.results.get(s.id);
    return `<li><button class="item" type="button" data-id="${esc(s.id)}" aria-current="${st.sel === s.id}">
      <span class="rank" style="background:${COL[look(ev)]}">${i + 1}</span>
      <span style="min-width:0"><div class="name">${esc(s.address)}${s.cls === 'load' ? ' <small class="tag">lastplats</small>' : s.cls === 'general' ? ' <small class="tag gen">allmänna regler</small>' : ''}</div><div class="sub">${esc(shortStatus(ev))} · ${walk(s)} m · chans ${ch.label.toLowerCase()}</div></span>
      <span class="price">${ev.cost} kr<small>${ev.status === 'cond' ? 'till flytt' : durText(st.dur)}</small></span>
    </button></li>`;
  }).join('') || (st.key && st.segs.length ? '<li class="empty">Inga tillåtna platser inom 500 m vid den tiden.</li>' : '');
  $('list').querySelectorAll('.item').forEach(b => b.onclick = () => select(b.dataset.id));
}

const PILL = { free: ['s-free', 'Gratis'], paid: ['s-paid', 'Avgift'], cond: ['s-cond', 'Villkor'], stop: ['s-stop', 'Förbjudet nu'], load: ['s-load', 'Lastplats nu'] };
const SVG_P = `<svg viewBox="0 0 60 60" width="56" height="56" aria-hidden="true"><rect x="1.5" y="1.5" width="57" height="57" rx="7" fill="var(--sign-blue)" stroke="var(--sign-white)" stroke-width="2.5"/><text x="30" y="47" text-anchor="middle" font-family="Barlow Condensed,Arial Narrow,sans-serif" font-weight="700" font-size="46" fill="var(--sign-white)">P</text></svg>`;
const SVG_NOP = `<svg viewBox="0 0 60 60" width="56" height="56" aria-hidden="true"><circle cx="30" cy="30" r="27" fill="var(--sign-blue)" stroke="var(--sign-red)" stroke-width="6"/><line x1="12" y1="12" x2="48" y2="48" stroke="var(--sign-red)" stroke-width="6"/></svg>`;
function plateHTML(p) {
  if (p.text) return `<div class="plate">${esc(p.text)}</div>`;
  const t = p.times, out = [];
  if (t.v) out.push(t.v); if (t.l) out.push(`(${t.l})`); if (t.s) out.push(`<span class="red">${t.s}</span>`);
  return `<div class="plate">${out.join(' ')}</div>`;
}
function renderDetail() {
  const box = $('detail');
  const s = pool().find(x => x.id === st.sel);
  if (!s) { box.hidden = true; return; }
  const { ev, ch } = st.results.get(s.id);
  box.hidden = false;
  box.innerHTML = `
    <div class="detail-head"><div><h2>${esc(s.address)}</h2>
      <div class="sub">${esc([s.district, s.type, `ca ${s.spots} platser`, `${walk(s)} m från målet`].filter(Boolean).join(' · '))}</div></div>
      <button class="close" type="button" id="closeDetail" aria-label="Stäng">×</button></div>
    <div class="row nowrap"><span class="pill ${PILL[look(ev)][0]}">${PILL[look(ev)][1]}</span><span class="chance">Chans att hitta plats: ${ch.label} (uppskattning)</span></div>
    <div class="verdict">${esc(verdict(ev, st.dur))}</div>
    ${s.cls === 'general' ? '<div class="warn">Staden har inga föreskrifter här, så tolkningen bygger på de allmänna reglerna. Kontrollera alltid skyltarna.</div>' : ''}
    ${s.cls === 'load' ? '<div class="warn">Lastplats. Stadens data kan sakna vissa tider, så kontrollera skylten innan du parkerar.</div>' : ''}
    <span class="lbl">Så borde skyltarna se ut</span>
    <div class="signs">${signPlates(s).map(g => `<figure class="sign">${g.sign === 'P' ? SVG_P : SVG_NOP}${g.plates.map(plateHTML).join('')}</figure>`).join('')}</div>
    <span class="lbl">Tolkning</span>
    <ul class="facts">${ruleFacts(s).map(f => `<li>${esc(f)}</li>`).join('')}</ul>
    ${s.rate ? `<div class="src">Stadens taxetext: ${esc(s.rate.raw)}</div>` : ''}
    <div class="src"${s.citations.length ? '' : ' hidden'}>Föreskrifter: ${s.citations.map(c => c.u ? `<a href="${esc(c.u)}" target="_blank" rel="noopener">${esc(c.c)}</a>` : esc(c.c)).join(' · ')}</div>
    <details class="raw"><summary>Rådata från staden (${s.raws.length})</summary><pre>${esc(JSON.stringify(s.raws.map(r => { const o = { ...r }; delete o.RDT_URL; return o; }), null, 2))}</pre></details>`;
  $('closeDetail').onclick = () => { st.sel = null; render(); };
}
function select(id) {
  st.sel = id; render();
  if (matchMedia('(max-width:860px)').matches) $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- kontroller ----------
function setNow() {
  const d = new Date(); st.dayOff = 0;
  st.slot = Math.min(95, Math.ceil((d.getHours() * 60 + d.getMinutes()) / 15));
  $('day').value = 0; $('time').value = st.slot;
}
(function init() {
  const d = new Date();
  for (let i = 0; i < 7; i++) {
    const x = new Date(d); x.setDate(d.getDate() + i);
    const o = document.createElement('option'); o.value = i;
    o.textContent = (i === 0 ? 'Idag, ' : i === 1 ? 'Imorgon, ' : '') + `${WD_SHORT[x.getDay()]} ${x.getDate()}/${x.getMonth() + 1}`;
    $('day').appendChild(o);
  }
  $('dur').innerHTML = DURS.map(m => `<button class="chip" type="button" data-m="${m}" aria-pressed="${m === st.dur}">${m < 60 ? m + ' min' : m / 60 + ' h'}</button>`).join('');
  $('dur').querySelectorAll('.chip').forEach(b => b.onclick = () => {
    st.dur = +b.dataset.m; store.set('dur', st.dur);
    $('dur').querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', x === b)); render();
  });
  $('day').onchange = e => { st.dayOff = +e.target.value; render(); };
  $('time').oninput = e => { st.slot = +e.target.value; render(); };
  $('now').onclick = () => { setNow(); render(); };
  $('sort').querySelectorAll('button').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.k === st.sort);
    b.onclick = () => { st.sort = b.dataset.k; store.set('sort', st.sort); $('sort').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); render(); };
  });

  // inställningar
  const dlg = $('settings');
  $('openSettings').onclick = () => {
    $('apiKey').value = st.key; $('hcp').checked = st.hcp;
    const ds = [...new Set([...st.districts, ...st.boende])].sort((a, b) => a.localeCompare(b, 'sv'));
    $('boendeList').innerHTML = ds.length
      ? ds.map((n, i) => `<label class="toggle"><input type="checkbox" id="b${i}" value="${esc(n)}" ${st.boende.has(n) ? 'checked' : ''}> ${esc(n)}</label>`).join('')
      : '<p class="muted">Områdena dyker upp här när du har sökt en adress.</p>';
    dlg.showModal();
  };
  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'save') return;
    const newKey = $('apiKey').value.trim();
    if (newKey !== st.key) cache.clear();
    st.key = newKey; store.set('apiKey', st.key);
    st.hcp = $('hcp').checked; store.set('hcp', st.hcp);
    st.boende = new Set([...$('boendeList').querySelectorAll('input:checked')].map(i => i.value)); store.set('boende', [...st.boende]);
    if (st.dest) setDest(st.dest, st.destLabel, st.destSub); else render();
  });
  $('welcomeKeyForm').addEventListener('submit', e => {
    e.preventDefault();
    const k = $('welcomeKey').value.trim(); if (!k) return;
    st.key = k; store.set('apiKey', k); cache.clear();
    if (st.dest) setDest(st.dest, st.destLabel, st.destSub); else render();
  });

  setNow(); render();
})();

// ---------- Kör hit: rutt, trängselskatt och avresetid ----------
function tripTarget() {
  const s = pool().find(x => x.id === st.sel) || (st.dest ? ranked()[0] : null);
  if (s) return { lngLat: s.mid, label: s.address + (s.id === st.sel ? '' : ' (bästa fickan)') };
  return st.dest ? { lngLat: st.dest, label: st.destLabel } : null;
}
const fmtMin = sec => { const m = Math.round(sec / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
const hhmm = ms => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

function renderTrip() {
  const box = $('trip');
  box.hidden = !st.dest;
  if (!st.dest) return;
  const tgt = tripTarget();
  $('tripTarget').textContent = tgt ? (trip.fromLabel ? `från ${trip.fromLabel} ` : '') + 'till ' + tgt.label : '';
  const out = $('tripOut');
  if (!trip.routes.length) { out.innerHTML = trip.msg ? `<p class="muted">${esc(trip.msg)}</p>` : ''; drawRoute(); return; }
  const r = trip.routes[trip.pick], deps = departures(r, trip.base), cur = deps[trip.dep];
  const best = deps.reduce((a, b) => b.total < a.total ? b : a, deps[0]);
  const names = { snabbast: 'Snabbast', alternativ: 'Alternativ', 'utan tull': 'Utan trängselskatt' };
  const nowCosts = trip.routes.map(x => departures(x, trip.base)[trip.dep].total);
  let tip = '';
  if (best.total < cur.total) tip = `<div class="insight">Vänta till <b>${hhmm(best.t)}</b> så kostar det <b>${best.total} kr</b> i stället för ${cur.total} kr. <span class="save">Du sparar ${cur.total - best.total} kr.</span></div>`;
  else if (cur.total === 0) tip = `<div class="insight">Ingen trängselskatt på den här resan${r.pass.length ? ' vid den tiden' : ''}.</div>`;
  const free = trip.routes.findIndex(x => x.kind === 'utan tull');
  if (free >= 0 && free !== trip.pick && cur.total > 0) tip += `<div class="insight">Kör <b>utan trängselskatt</b>: ${fmtMin(trip.routes[free].sec - r.sec)} längre, sparar <span class="save">${cur.total} kr</span>.</div>`;
  const links = navLinks(trip.from, tgt.lngLat, r);
  out.innerHTML = `
    <div class="routes">${trip.routes.map((x, i) => `<button type="button" class="route" data-i="${i}" aria-pressed="${i === trip.pick}">
      <span class="rname">${names[x.kind] || x.kind} · ${fmtMin(x.sec)}</span>
      <span class="rsub">${x.km.toFixed(1).replace('.', ',')} km · ${x.pass.length ? x.pass.length + ' betalstation' + (x.pass.length > 1 ? 'er' : '') : 'inga betalstationer'}</span>
      <span class="rcost">${nowCosts[i]} kr<small>skatt</small></span></button>`).join('')}</div>
    ${tip}
    <span class="lbl">Avresa</span>
    <div class="deps">${deps.map((d, i) => `<button type="button" class="dep${d.total === best.total && best.total < deps[0].total ? ' best' : ''}" data-i="${i}" aria-pressed="${i === trip.dep}">
      <small>${d.min ? '+' + d.min + ' min' : ($('depart').value ? 'Vald tid' : 'Nu')}</small><b>${hhmm(d.t)}</b><small>${d.total} kr</small></button>`).join('')}</div>
    <p class="muted">Framme ca <b>${hhmm(cur.arrive)}</b>. Restiden räknas utan köer.</p>
    ${cur.items.length ? `<ul class="tolls">${cur.items.map(p => `<li>${esc(p.name)} ${hhmm(p.t)}: ${p.amount} kr</li>`).join('')}</ul>${cur.capped ? '<p class="muted">Taket per dag gäller.</p>' : ''}` : ''}
    <span class="lbl">Navigera</span>
    <div class="nav">
      <a class="btn" href="${links.google}" target="_blank" rel="noopener">Google Maps</a>
      <a class="btn" href="${links.apple}" target="_blank" rel="noopener">Apple Kartor</a>
      <a class="btn" href="${links.waze}" target="_blank" rel="noopener">Waze</a>
    </div>
    ${r.kind === 'utan tull' ? '<p class="muted">Google Maps får mellanpunkter så att den följer vägen utan tull. Apple Kartor och Waze kan välja en annan väg.</p>' : ''}
    <details class="steps"><summary>Vägbeskrivning (${r.steps.length} steg)</summary><ol>${r.steps.map(x => `<li>${esc(x.text)}</li>`).join('')}</ol></details>`;
  out.querySelectorAll('.route').forEach(b => b.onclick = () => { trip.pick = +b.dataset.i; applyArrival(); });
  out.querySelectorAll('.dep').forEach(b => b.onclick = () => { trip.dep = +b.dataset.i; applyArrival(); });
  drawRoute();
}
function drawRoute() {
  routeLayer.clearLayers();
  if (!trip.routes.length) return;
  trip.routes.forEach((r, i) => {
    if (i === trip.pick) return;
    L.polyline(r.coords.map(([x, y]) => [y, x]), { color: '#7b8794', weight: 5, opacity: .55, bubblingMouseEvents: false })
      .on('click', () => { trip.pick = i; applyArrival(); }).addTo(routeLayer);
  });
  const r = trip.routes[trip.pick];
  L.polyline(r.coords.map(([x, y]) => [y, x]), { color: CSS('--accent'), weight: 6, opacity: .9, interactive: false }).addTo(routeLayer);
  for (const p of r.pass) L.marker([p.pos[1], p.pos[0]], { interactive: false, icon: L.divIcon({ className: '', html: '<div class="gantry">kr</div>', iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(routeLayer);
}
// Parkeringen räknas från när du är framme.
function applyArrival() {
  const r = trip.routes[trip.pick];
  if (r) {
    const arrive = trip.base + (departures(r, trip.base)[trip.dep].min * 60 + r.sec) * 1000;
    const d0 = new Date(); d0.setHours(0, 0, 0, 0);
    const a = new Date(arrive), a0 = new Date(a); a0.setHours(0, 0, 0, 0);
    st.dayOff = Math.round((a0 - d0) / 86400000);
    st.slot = Math.min(95, Math.ceil((a.getHours() * 60 + a.getMinutes()) / 15));
    if (st.dayOff >= 0 && st.dayOff < 7) { $('day').value = st.dayOff; $('time').value = st.slot; }
  }
  render();
}
async function geocode(q) {
  // Sök i Stockholms län först (även utan ord som "centrum"), annars i Sverige men bara nära målet.
  const base = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=se&accept-language=sv&q=';
  const short = q.replace(/\b(centrum|c)\b\.?/gi, '').trim();
  const tries = [[q, true], [short, true], [q + ', Stockholm', false], [q, false]];
  const near = st.dest || [18.06, 59.33];
  for (const [text, bounded] of tries) {
    if (!text) continue;
    const res = await (await fetch(base + encodeURIComponent(text) + (bounded ? '&viewbox=17.2,60.2,19.4,58.7&bounded=1' : ''))).json();
    const hit = res.find(r => distToLines([+r.lon, +r.lat], [[near, near]]) < 150000);
    if (hit) return { lngLat: [+hit.lon, +hit.lat], label: hit.display_name.split(',').slice(0, 3).join(',') };
  }
  throw new Error('Hittade ingen sådan startadress i närheten. Prova med gatuadress.');
}
function departBase() {
  const v = $('depart').value;
  const t = v ? new Date(v).getTime() : NaN;
  return Number.isFinite(t) && t > Date.now() - 60000 ? t : Date.now();
}
async function plan() {
  const tgt = tripTarget();
  if (!tgt || !trip.from) return;
  if (trip.abort) trip.abort.abort();
  trip.abort = new AbortController();
  trip.routes = []; trip.msg = 'Räknar ut rutter…'; renderTrip();
  try {
    trip.routes = await planRoutes(trip.from, tgt.lngLat, { signal: trip.abort.signal });
    trip.pick = 0; trip.dep = 0; trip.base = departBase(); trip.msg = '';
    const b = L.latLngBounds(trip.routes[0].coords.map(([x, y]) => [y, x]));
    map.fitBounds(b, { padding: [30, 30] });
    applyArrival();
  } catch (e) {
    if (e.name === 'AbortError') return;
    trip.routes = []; trip.msg = 'Kunde inte räkna ut en rutt just nu. Försök igen om en stund.';
    renderTrip();
  }
}
$('fromForm').addEventListener('submit', async e => {
  e.preventDefault();
  const q = $('from').value.trim();
  if (!q && trip.from) return plan();
  if (!q) { $('from').focus(); return; }
  try { const g = await geocode(q); trip.from = g.lngLat; trip.fromLabel = g.label; plan(); }
  catch (err) { trip.msg = err.message; trip.routes = []; renderTrip(); }
});
$('depart').addEventListener('change', () => { if (trip.routes.length) { trip.base = departBase(); trip.dep = 0; applyArrival(); } });
$('fromHere').onclick = () => {
  if (!navigator.geolocation) { trip.msg = 'Din webbläsare kan inte dela plats. Skriv en startadress.'; return renderTrip(); }
  navigator.geolocation.getCurrentPosition(p => { trip.from = [p.coords.longitude, p.coords.latitude]; $('from').value = 'Min plats'; trip.fromLabel = 'min plats'; plan(); },
    () => { trip.msg = 'Fick inte tillgång till din plats. Skriv en startadress.'; renderTrip(); }, { enableHighAccuracy: true, timeout: 10000 });
};
