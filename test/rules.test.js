import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRate, dayType, parseHM, weekdayIndex, normalize, buildSegments, evaluate, verdict, chance, distToLines } from '../js/rules.js';

const at = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

test('tolkar PARKING_RATE från riktigt svar', () => {
  const r = parseRate('taxa 4: 10 kr/tim vardagar 7-19, dag före helgdag 11-17, Boende: 500 kr/månad eller 35 kr/dygn');
  assert.equal(r.taxa, '4');
  assert.equal(r.boende, true);
  assert.deepEqual(r.periods, [{ days: ['v'], from: 7, to: 19, rate: 10 }, { days: ['l'], from: 11, to: 17, rate: 10 }]);
});

test('tolkar alla dagar, övrig tid och minuter', () => {
  const r = parseRate('taxa 2: 26 kr/tim alla dagar 7-21, övrig tid 15 kr/tim');
  assert.deepEqual(r.periods, [{ days: ['v', 'l', 's'], from: 7, to: 21, rate: 26 }]);
  assert.equal(r.other, 15);
  const r2 = parseRate('taxa 3: 20 kr/tim vardagar 7.30-18.30, sön- och helgdagar 11-17');
  assert.deepEqual(r2.periods[0], { days: ['v'], from: 7.5, to: 18.5, rate: 20 });
  assert.deepEqual(r2.periods[1].days, ['s']);
});

test('dagtyper med helgdagar', () => {
  assert.equal(dayType(new Date(2026, 9, 12)), 'v');   // måndag
  assert.equal(dayType(new Date(2026, 9, 17)), 'l');   // lördag
  assert.equal(dayType(new Date(2026, 9, 18)), 's');   // söndag
  assert.equal(dayType(new Date(2026, 9, 31)), 's');   // alla helgons dag 2026 (lördag)
  assert.equal(dayType(new Date(2026, 9, 30)), 'l');   // fredag före
  assert.equal(dayType(new Date(2026, 11, 24)), 'l');  // julafton
  assert.equal(dayType(new Date(2026, 3, 3)), 's');    // långfredag 2026
});

test('tid- och veckodagsfält', () => {
  assert.equal(parseHM(600), 6); assert.equal(parseHM(1830), 18.5); assert.equal(parseHM('06:00'), 6); assert.equal(parseHM(8), 8);
  assert.equal(weekdayIndex('tisdag'), 2); assert.equal(weekdayIndex('Måndag'), 1); assert.equal(weekdayIndex(7), 0);
});

test('riktigt GeoJSON normaliseras', () => {
  const fx = JSON.parse(readFileSync(new URL('./fixture-rorelsehindrad.json', import.meta.url)));
  const s = normalize(fx.features[0], 'prorelsehindrad');
  assert.equal(s.street, 'Nathorstvägen');
  assert.equal(s.spots, 1);
  assert.ok(s.mid && Math.abs(s.mid[1] - 59.29698) < 0.001);
  assert.ok(s.rules.some(r => r.k === 'avgift'));
});

// Syntetiskt svar i samma format som LTF-Tolken
const line = (lng, lat, dLng) => ({ type: 'LineString', coordinates: [[lng, lat], [lng + dLng, lat]] });
const P = { features: [
  { id: 'LTFR_P_TILLATEN.1', geometry: line(18.05, 59.34, 0.0008), properties: { FID: 1, STREET_NAME: 'Döbelnsgatan', ADDRESS: 'Döbelnsgatan 10', PARKING_RATE: 'taxa 3: 20 kr/tim vardagar 7-19, dag före helgdag 11-17, Boende: 1100 kr/månad', PARKING_DISTRICT: 'Vasastaden' } },
  { id: 'LTFR_P_TILLATEN.2', geometry: line(18.051, 59.341, 0.0008), properties: { FID: 2, STREET_NAME: 'Döbelnsgatan', ADDRESS: 'Döbelnsgatan 30', MAX_HOURS: 2, START_TIME: 800, END_TIME: 1800 } },
  { id: 'LTFR_P_TILLATEN.3', geometry: line(18.052, 59.342, 0.0008), properties: { FID: 3, STREET_NAME: 'Rådmansgatan', ADDRESS: 'Rådmansgatan 1', VEHICLE: 'Lastbil' } },
] };
const SD = { features: [
  { id: 'LTFR_SERVICEDAG.9', geometry: line(18.05, 59.34001, 0.0008), properties: { FID: 9, STREET_NAME: 'Döbelnsgatan', START_WEEKDAY: 'tisdag', START_TIME: 0, END_TIME: 600 } },
] };

test('servicedag kopplas till rätt sträcka, lastbilsplats filtreras bort', () => {
  const segs = buildSegments(P, SD);
  assert.equal(segs.length, 2);
  assert.ok(segs[0].rules.some(r => r.k === 'servicedag' && r.wd === 2));
  assert.ok(!segs[1].rules.some(r => r.k === 'servicedag'));
});

test('utvärdering: avgift, servicedag, maxtid, boende', () => {
  const [a, b] = buildSegments(P, SD);
  const mon9 = at(2026, 10, 12, 9);
  let ev = evaluate(a, mon9, 120);
  assert.equal(ev.status, 'paid'); assert.equal(ev.cost, 40);
  assert.match(verdict(ev, 120), /stå kvar till tis 00:00/);
  ev = evaluate(a, at(2026, 10, 13, 1), 60);
  assert.equal(ev.status, 'stop'); assert.equal(new Date(ev.okFrom).getHours(), 6);
  ev = evaluate(a, at(2026, 10, 17, 10), 120);          // lördag 10–12: avgift från 11
  assert.equal(ev.cost, 20);
  ev = evaluate(a, mon9, 120, { boende: new Set(['Vasastaden']) });
  assert.equal(ev.status, 'free');
  ev = evaluate(b, mon9, 180);
  assert.equal(ev.status, 'cond'); assert.equal(new Date(ev.first.t).getHours(), 11);
  ev = evaluate(b, at(2026, 10, 12, 17), 180);          // 17–20: bara 1 h inom fönstret
  assert.equal(ev.status, 'free');
  assert.ok(chance(a, evaluate(a, mon9, 60)).score > 0);
});

test('avstånd till linje i meter', () => {
  const d = distToLines([18.0504, 59.3401], [[[18.05, 59.34], [18.0508, 59.34]]]);
  assert.ok(d > 10 && d < 12, String(d));
});
