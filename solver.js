/* Counter sales: pure rules for one bill with many items. No DOM.
 * Browser: window.Solver. Node tests: require().
 *
 * Bill: gross G (VAT inclusive), VAT V%. Taxable base X = G / (1 + V%).
 * Line amounts (paisa) must add up to X exactly. One line absorbs the rest:
 *   pcs and dozen: rate absorbs (count never rounded)
 *   kg: quantity absorbs by default (rate fixed at max rate)
 * Each line keeps its max rate. Rates above max are flagged (more tax).
 */
(function (root) {
  'use strict';

  var BAND_LOW = 5;   // % over buy cost; below this is LOSS
  var BAND_HIGH = 7;  // % over buy cost; above this is OVER_TAX

  function roundTo(n, d) {
    var f = Math.pow(10, d);
    var r = Math.round(Math.abs(n) * f + 1e-9) / f;
    return n < 0 ? -r : r;
  }
  function round2(n) { return roundTo(n, 2); }

  // Money in paisa (integer), after removing float noise.
  function toPaisa(x) { return Math.round(Math.round(x * 1e6) / 1e4); }

  function taxable(G, V) {
    var base = round2(G / (1 + V / 100));
    return { base: base, vat: round2(G - base) };
  }

  // Kg with the rate fixed: quantity to 3 dp, or 4 dp when that makes the amount exact.
  function solveKgQty(base, rate) {
    var raw = base / rate;
    var q3 = roundTo(raw, 3);
    if (toPaisa(q3 * rate) === toPaisa(base)) return q3;
    var q4 = roundTo(raw, 4);
    return toPaisa(q4 * rate) === toPaisa(base) ? q4 : q3;
  }

  function countError(unit, q) {
    if (!(q > 0)) return 'Enter the count.';
    if (unit === 'pcs' && q !== Math.floor(q)) return 'Pcs are whole numbers.';
    if (unit === 'doz' && Math.abs(q * 2 - Math.round(q * 2)) > 1e-9) return 'Dozens go in halves.';
    if (unit === 'kg' && Math.abs(q * 1000 - Math.round(q * 1000)) > 1e-6) return 'Weight goes to 3 decimals.';
    return null;
  }

  // Margin of a rate over buy cost (same unit). Band 5% to 7%.
  function bandStatus(rate, buy) {
    if (!(buy > 0)) return { status: 'NONE', pct: null };
    var m = (rate - buy) / buy * 100;
    var status = 'OK';
    if (m < BAND_LOW - 1e-9) status = 'LOSS';
    else if (m > BAND_HIGH + 1e-9) status = 'OVER_TAX';
    return { status: status, pct: round2(m) };
  }

  // Rate used by a line: typed override, else max rate.
  function effRate(l) { return l.rate > 0 ? l.rate : l.std; }

  // Default absorber: first kg line, else the pcs/dozen line with the smallest count.
  function defaultAbsorber(lines) {
    var kg = null, small = null;
    lines.forEach(function (l) {
      if (!kg && l.unit === 'kg') kg = l;
      if (l.unit !== 'kg' && l.count > 0 && (!small || l.count < small.count)) small = l;
    });
    var pick = kg || small;
    return pick ? pick.id : null;
  }

  // Count-1 line that can take a paisa gap: its rate moves, its count stays.
  function fixerRow(rows) {
    var found = null;
    rows.forEach(function (r) { if (!found && !r.absorbs && !r.error && r.qty === 1) found = r; });
    return found;
  }

  // Kg absorber: try the 3 dp and 4 dp weights either side of the exact one.
  // Order: exact, then a gap a count-1 line closes within its max, then fewer decimals
  // (scales read to 1 g), then the smaller gap.
  function pickKgQty(rem, rate, fix) {
    var raw = rem / 100 / rate;
    var cands = [];
    [[1000, 3], [10000, 4]].forEach(function (p) {
      var f = p[0], dec = p[1];
      [Math.floor(raw * f + 1e-9) / f, Math.ceil(raw * f - 1e-9) / f].forEach(function (q) {
        if (q > 0 && !cands.some(function (c) { return c.q === q; })) cands.push({ q: q, dec: dec });
      });
    });
    var best = null;
    cands.forEach(function (c) {
      var gap = rem - toPaisa(c.q * rate);
      var rank = 2;
      if (gap === 0) rank = 0;
      else if (fix && fix.rate > 0) {
        var nr = round2(fix.rate + gap / 100);
        if (nr > 0 && (!(fix.std > 0) || nr <= fix.std + 1e-9)) rank = 1;
      }
      var key = [rank, c.dec, Math.abs(gap)];
      if (!best || lessKey(key, best.key)) best = { q: c.q, key: key };
    });
    return best.q;
  }

  function lessKey(a, b) {
    for (var i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return a[i] < b[i];
    }
    return false;
  }

  function sumSubs(rows) {
    return rows.reduce(function (s, r) { return s + (r.error ? 0 : r.sub); }, 0);
  }

  // lines: [{id, name, unit, count, std, buy, rate, kgMode}]
  // absorberId: line that takes the rest, or null (then the variance shows).
  function solveBill(G, V, lines, absorberId) {
    var haveBill = G > 0 && V >= 0;
    var t = haveBill ? taxable(G, V) : { base: NaN, vat: NaN };
    var out = { ok: false, msg: '', G: G, V: V, base: t.base, vat: t.vat, X: NaN,
                rows: [], total: 0, variance: 0 };
    if (!(G > 0)) { out.msg = 'Enter the bill total.'; return out; }
    if (!(V >= 0)) { out.msg = 'Enter the VAT %.'; return out; }
    if (!lines.length) { out.msg = 'Add at least one item.'; return out; }

    var X = toPaisa(t.base);
    out.X = X;

    var absorber = null;
    lines.forEach(function (l) { if (l.id === absorberId) absorber = l; });

    var rows = lines.map(function (l) {
      return { id: l.id, name: l.name, unit: l.unit, qty: l.count, rate: NaN, std: l.std, buy: l.buy,
               sub: 0, absorbs: l === absorber, adjusted: false, error: null,
               flag: 'NONE', pct: null, aboveMax: false };
    });
    var errors = [];
    var fixed = 0;

    // 1. Lines priced as entered (all except the absorber).
    lines.forEach(function (l, i) {
      var row = rows[i];
      if (l === absorber) return;
      var err = countError(l.unit, l.count);
      if (!err && !(effRate(l) > 0)) err = 'Enter the max rate.';
      if (err) { row.error = err; errors.push(err); return; }
      row.rate = effRate(l);
      row.sub = toPaisa(l.count * row.rate);
      fixed += row.sub;
    });

    // 2. Absorber takes the rest of X.
    if (absorber) {
      var row = rows[lines.indexOf(absorber)];
      var rem = X - fixed;
      var err2 = null;
      if (rem <= 0) {
        err2 = 'Other lines already reach the bill total. Lower a count or rate.';
      } else if (absorber.unit === 'kg' && absorber.kgMode !== 'rate') {
        if (!(effRate(absorber) > 0)) err2 = 'Enter the max rate.';
        else {
          row.rate = effRate(absorber);
          row.qty = pickKgQty(rem, row.rate, fixerRow(rows));
        }
      } else {
        err2 = countError(absorber.unit, absorber.count);
        if (!err2) {
          row.qty = absorber.count;
          row.rate = round2(rem / 100 / row.qty);
        }
      }
      if (!err2 && !(row.qty > 0 && row.rate > 0)) err2 = 'Rate would be zero. Lower other lines.';
      if (err2) { row.error = err2; errors.push(err2); }
      else row.sub = toPaisa(row.qty * row.rate);
    }

    // 3. Close a paisa gap on a line of count 1: its rate moves by the gap, never above max.
    var total = sumSubs(rows);
    var resid = X - total;
    if (absorber && resid !== 0 && !errors.length) {
      var fix = fixerRow(rows);
      if (fix) {
        var nr = round2(fix.rate + resid / 100);
        if (nr > 0 && (!(fix.std > 0) || nr <= fix.std + 1e-9)) {
          fix.rate = nr;
          fix.sub = toPaisa(nr);
          fix.adjusted = true;
          total = sumSubs(rows);
        }
      }
    }

    // 4. Flags per line.
    rows.forEach(function (r) {
      if (r.error) return;
      var b = bandStatus(r.rate, r.buy);
      r.flag = b.status;
      r.pct = b.pct;
      r.aboveMax = r.std > 0 && r.rate > r.std + 1e-9;
    });

    out.rows = rows;
    out.total = total;
    out.variance = total - X;
    out.ok = errors.length === 0;
    out.msg = errors.length ? errors[0] : '';
    return out;
  }

  var api = {
    roundTo: roundTo,
    round2: round2,
    toPaisa: toPaisa,
    taxable: taxable,
    solveKgQty: solveKgQty,
    countError: countError,
    bandStatus: bandStatus,
    effRate: effRate,
    defaultAbsorber: defaultAbsorber,
    solveBill: solveBill,
    BAND_LOW: BAND_LOW,
    BAND_HIGH: BAND_HIGH
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Solver = api;
})(typeof window !== 'undefined' ? window : {});
