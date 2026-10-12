import test from 'node:test';
import assert from 'node:assert/strict';
import { amountAt, taxFree, highSeason, passages, tollFor, dayCap } from '../js/toll.js';
import { decodePolyline6, shapeTimes } from '../js/route.js';

const at = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

test('belopp per tid, säsong och plats', () => {
  assert.equal(amountAt(at(2026, 10, 13, 7, 30)), 45);          // högsäsong rusning
  assert.equal(amountAt(at(2026, 10, 13, 7, 30), true), 40);    // Essingeleden
  assert.equal(amountAt(at(2026, 12, 15, 7, 30)), 35);          // lågsäsong
  assert.equal(amountAt(at(2026, 10, 13, 12, 0)), 11);
  assert.equal(amountAt(at(2026, 10, 13, 18, 29)), 20);
  assert.equal(amountAt(at(2026, 10, 13, 18, 30)), 0);
  assert.equal(amountAt(at(2026, 10, 13, 5, 59)), 0);
  assert.equal(dayCap(at(2026, 10, 13, 8)), 135); assert.equal(dayCap(at(2026, 1, 13, 8)), 105);
});
test('skattefria dagar 2026 enligt Transportstyrelsen', () => {
  for (const [m, d] of [[1, 1], [1, 5], [1, 6], [4, 3], [4, 6], [5, 1], [5, 14], [6, 19], [12, 24], [12, 25], [12, 31]]) assert.ok(taxFree(new Date(2026, m - 1, d)), `${d}/${m}`);
  assert.ok(!taxFree(new Date(2026, 3, 2)));   // skärtorsdag
  assert.ok(!taxFree(new Date(2026, 3, 30)));  // dagen före 1 maj (vardag)
  assert.ok(!taxFree(new Date(2026, 6, 7)));   // femte vardagen i juli
  assert.ok(taxFree(new Date(2026, 6, 8)));
  assert.ok(highSeason(new Date(2026, 5, 18)) && !highSeason(new Date(2026, 5, 19)));
});
test('passager längs en rutt över Skanstullsbron', () => {
  const coords = [[18.0774, 59.3120], [18.0774, 59.3063], [18.0774, 59.2990]];   // norr → söder över bron
  const times = [0, 60, 120];
  const p = passages(coords, times);
  assert.deepEqual(p.map(x => x.ref), ['3', '4']);           // Skanstullsbron + Johanneshovsbron (räknas var för sig)
  const t = tollFor(p, at(2026, 10, 13, 7, 0));
  assert.equal(t.total, 90);
});
test('Essingeleden räknas som en passage', () => {
  const coords = [[17.9966, 59.3150], [17.9966, 59.3229], [18.0040, 59.3251], [18.0107, 59.3315], [18.0101, 59.3365]];
  const p = passages(coords, [0, 60, 120, 180, 240]);
  assert.equal(p.length, 1); assert.ok(p[0].essinge);
});
test('polyline6 och tider', () => {
  assert.deepEqual(decodePolyline6('_izlhA~rlgdF_{geC~ywl@_kwzCn`{nI'), [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]);
  const tt = shapeTimes([[0, 0], [0, 1], [0, 2], [0, 3]], [{ begin_shape_index: 0, end_shape_index: 2, time: 20 }, { begin_shape_index: 2, end_shape_index: 3, time: 10 }]);
  assert.deepEqual(tt, [0, 10, 20, 30]);
});
