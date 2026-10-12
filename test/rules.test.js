import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRate, parseService, dayType, parseHM, weekdayIndex, normalize, buildSegments, evaluate, verdict, chance, distToLines, ruleFacts } from '../js/rules.js';

const at = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const T3 = 'taxa 3: 20 kr/tim vardagar 7-19, 15 kr/tim dag före helgdag 11-17, Boende: 1100 kr/månad eller 75 kr/dygn';
const T2 = 'taxa 2: 31 kr/tim vardagar 7-21 och dag före helgdag och helgdag 9-19, 20 kr/tim övrig tid, Boende: 1100 kr/månad eller 75 kr/dygn';
const T12 = 'taxa 12: Vardagar utom vardag före sön- och helgdag klockan 07.00 - 21.00, vardag före sön- och helgdag klockan 9.00 - 19.00 och sön- och helgdag klockan 9.00 - 19.00, 7,75 kr/tim. Övrig tid 5 kr/tim.';
const T13 = 'taxa 13: Vardagar utom vardag före sön- och helgdag klockan 7.00 - 19.00, 5 kr/tim. Vardag före sön- och helgdag klockan 11.00 - 17.00, 3,75 kr/tim.';

test('taxa 3 (pris före dagar)', () => {
  const r = parseRate(T3);
  assert.equal(r.taxa, '3'); assert.equal(r.boende, true); assert.equal(r.other, 0);
  assert.deepEqual(r.periods, [{ days: ['v'], from: 7, to: 19, rate: 20 }, { days: ['l'], from: 11, to: 17, rate: 15 }]);
});
test('taxa 2 (flera dagtyper och övrig tid)', () => {
  const r = parseRate(T2);
  assert.deepEqual(r.periods, [{ days: ['v'], from: 7, to: 21, rate: 31 }, { days: ['l', 's'], from: 9, to: 19, rate: 31 }]);
  assert.equal(r.other, 20);
});
test('taxa 12 (lång form, pris efter dagar)', () => {
  const r = parseRate(T12);
  assert.equal(r.periods.length, 3);
  assert.ok(r.periods.every(p => p.rate === 7.75));
  assert.deepEqual(r.periods[0], { days: ['v'], from: 7, to: 21, rate: 7.75 });
  assert.equal(r.other, 5);
});
test('taxa 13 (två priser i lång form)', () => {
  const r = parseRate(T13);
  assert.deepEqual(r.periods, [{ days: ['v'], from: 7, to: 19, rate: 5 }, { days: ['l'], from: 11, to: 17, rate: 3.75 }]);
});
test('avgiftsfri och äldre format', () => {
  const f = parseRate('avgiftsfri'); assert.equal(f.free, true); assert.equal(f.periods.length, 0);
  const r = parseRate('taxa 4: 10 kr/tim vardagar 7-19, dag före helgdag 11-17, Boende: 500 kr/månad');
  assert.deepEqual(r.periods, [{ days: ['v'], from: 7, to: 19, rate: 10 }, { days: ['l'], from: 11, to: 17, rate: 10 }]);
});

test('servicetid från OTHER_INFO och från fält', () => {
  assert.deepEqual(parseService('Servicetid onsdag 09:00–14:00'), { k: 'servicedag', wd: 3, from: 9, to: 14 });
  assert.deepEqual(parseService(null, { START_WEEKDAY: 'måndag', START_TIME: 600, END_TIME: 0 }), { k: 'servicedag', wd: 1, from: 0, to: 6 });
  const ex = parseService('Servicetid tisdag 09:00 - 14:00 utom under tiden 15 juni - 15 augusti', { START_MONTH: 6, END_MONTH: 8 });
  assert.deepEqual(ex.except, { m1: 6, d1: 15, m2: 8, d2: 15 });
});

test('dagtyper med helgdagar', () => {
  assert.equal(dayType(new Date(2026, 9, 12)), 'v');
  assert.equal(dayType(new Date(2026, 9, 17)), 'l');
  assert.equal(dayType(new Date(2026, 9, 18)), 's');
  assert.equal(dayType(new Date(2026, 9, 31)), 's');   // alla helgons dag 2026
  assert.equal(dayType(new Date(2026, 9, 30)), 'l');
  assert.equal(dayType(new Date(2026, 11, 24)), 'l');
  assert.equal(dayType(new Date(2026, 3, 3)), 's');    // långfredag 2026
});
test('tid- och veckodagsfält', () => {
  assert.equal(parseHM(600), 6); assert.equal(parseHM(1830), 18.5); assert.equal(parseHM(0), 0);
  assert.equal(weekdayIndex('tisdag'), 2); assert.equal(weekdayIndex('Måndag'), 1);
});

test('äldre exempelsvar normaliseras', () => {
  const fx = JSON.parse(readFileSync(new URL('./fixture-rorelsehindrad.json', import.meta.url)));
  const s = normalize(fx.features[0]);
  assert.equal(s.cls, 'hcp'); assert.equal(s.street, 'Nathorstvägen');
});

// Svar i samma format som LTF-Tolken/ptillaten (fält och värden från riktig data)
const line = (lng, lat, d = 0.0008) => ({ type: 'LineString', coordinates: [[lng, lat], [lng + d, lat]] });
const F = (id, g, props) => ({ type: 'Feature', id: 'LTFR_P_TILLATEN.' + id, geometry: g, properties: { FID: id, ADDRESS: '<Adress saknas>', PARKING_DISTRICT: 'Vasastan', VEHICLE: 'fordon', ...props } });
const gA = line(18.05, 59.34), gB = line(18.051, 59.341), gC = line(18.052, 59.342);
const DATA = { features: [
  F(1, gA, { STREET_NAME: 'Döbelnsgatan', VF_PLATS_TYP: 'P Avgift, boende', PARKING_RATE: T3, START_WEEKDAY: 'fredag', START_TIME: 1400, END_TIME: 900, OTHER_INFO: 'Servicetid fredag 09:00–14:00', CITATION: '0180 2023-1' }),
  F(2, gA, { STREET_NAME: 'Döbelnsgatan', VF_PLATS_TYP: '7', PARKING_RATE: T3, DAY_TYPE: 'vardag utom vardag före sön- och helgdag', START_TIME: 700, END_TIME: 1900, CITATION: '0180 2017-2' }),
  F(3, gB, { STREET_NAME: 'Sveavägen', VF_PLATS_TYP: 'P-avgift endast besök', PARKING_RATE: T2, START_WEEKDAY: 'måndag', START_TIME: 600, END_TIME: 0, OTHER_INFO: 'Servicetid måndag 00:00–06:00' }),
  F(4, gC, { STREET_NAME: 'Dalagatan', VF_PLATS_TYP: 'Reserverad p-plats rörelsehindrad', VEHICLE: 'rörelsehindrade', PARKING_RATE: T3 }),
  F(5, gC, { STREET_NAME: 'Dalagatan', VF_PLATS_TYP: 'Reserverad p-plats beskickningsbil', VEHICLE: 'beskickningsfordon', PARKING_RATE: 'avgiftsfri' }),
  F(6, gC, { STREET_NAME: 'Dalagatan', VF_PLATS_TYP: 'Reserverad p-plats motorcykel boende', VEHICLE: 'motorcykel', PARKING_RATE: T13 }),
] };

test('sträckor slås ihop och sorteras efter platstyp', () => {
  const { car, hcp } = buildSegments(DATA);
  assert.equal(hcp.length, 1);
  assert.equal(car.length, 3);                            // Döbelnsgatan vanlig + lastplats, Sveavägen
  assert.equal(car[0].address, 'Döbelnsgatan');           // "<Adress saknas>" ersätts
  assert.ok(car[0].rules.some(r => r.k === 'servicedag' && r.wd === 5 && r.from === 9 && r.to === 14));
  assert.ok(car.some(s => s.cls === 'load' && s.rules.some(r => r.k === 'lastzon')));
  assert.equal(car.find(s => s.street === 'Sveavägen').rate.boende, false);  // endast besök
});

test('utvärdering mot riktiga regeltyper', () => {
  const { car } = buildSegments(DATA);
  const [doeb, load, svea] = [car.find(s => s.cls === 'car' && s.street === 'Döbelnsgatan'), car.find(s => s.cls === 'load'), car.find(s => s.street === 'Sveavägen')];
  // måndag 9–11: taxa 3 = 40 kr
  let ev = evaluate(doeb, at(2026, 10, 12, 9), 120);
  assert.equal(ev.status, 'paid'); assert.equal(ev.cost, 40);
  // fredag 08 i 2 h: servicetid 09 → villkor
  ev = evaluate(doeb, at(2026, 10, 16, 8), 120);
  assert.equal(ev.status, 'cond'); assert.match(verdict(ev, 120), /senast 09:00/);
  // fredag 10: förbjudet till 14
  ev = evaluate(doeb, at(2026, 10, 16, 10), 60);
  assert.equal(ev.status, 'stop'); assert.equal(new Date(ev.okFrom).getHours(), 14);
  // boende i Vasastan gör det gratis
  ev = evaluate(doeb, at(2026, 10, 12, 9), 120, { boende: new Set(['Vasastan']) });
  assert.equal(ev.status, 'free');
  // lastplats: vardag 10 → lastplats, kväll 20 → ok
  ev = evaluate(load, at(2026, 10, 12, 10), 60);
  assert.equal(ev.status, 'stop'); assert.equal(ev.first.why, 'lastzon'); assert.equal(new Date(ev.okFrom).getHours(), 19);
  ev = evaluate(load, at(2026, 10, 12, 20), 60);
  assert.equal(ev.status, 'free');
  // lastplats på lördag (dag före helgdag) gäller inte
  ev = evaluate(load, at(2026, 10, 17, 10), 60);
  assert.notEqual(ev.status, 'stop');
  // Sveavägen taxa 2 på söndag kväll: 20 kr/tim övrig tid
  ev = evaluate(svea, at(2026, 10, 18, 20), 60);
  assert.equal(ev.cost, 20);
  // natt mot måndag: servicetid 00–06
  ev = evaluate(svea, at(2026, 10, 12, 2), 60);
  assert.equal(ev.status, 'stop');
  assert.ok(chance(doeb, evaluate(doeb, at(2026, 10, 12, 9), 60)).score > 0);
  assert.ok(ruleFacts(load).some(f => /Lastplats vardagar 7–19/.test(f)));
});

test('sommarundantag för servicetid', () => {
  const { car } = buildSegments({ features: [F(9, gA, { STREET_NAME: 'Hagagatan', VF_PLATS_TYP: 'P Avgift, boende', PARKING_RATE: T3, OTHER_INFO: 'Servicetid tisdag 09:00 - 14:00 utom under tiden 15 juni - 15 augusti', START_MONTH: 6, END_MONTH: 8, START_DAY: 15, END_DAY: 15 })] });
  assert.equal(evaluate(car[0], at(2026, 7, 7, 10), 60).status, 'paid');   // juli: undantag
  assert.equal(evaluate(car[0], at(2026, 10, 13, 10), 60).status, 'stop'); // oktober: servicetid
});

test('avstånd till linje i meter', () => {
  const d = distToLines([18.0504, 59.3401], [[[18.05, 59.34], [18.0508, 59.34]]]);
  assert.ok(d > 10 && d < 12, String(d));
});
