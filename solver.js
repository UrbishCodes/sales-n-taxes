/* Counter sales: pure rules for one bill, one or many items, and a plain calculator. No DOM.
 * Browser: window.Solver. Node tests: require().
 *
 * VAT modes:
 *   incl (default): bill total G is VAT inclusive. Taxable base X = G / (1 + V%). VAT = G - X.
 *   excl:           taxable amount T is typed (or built from the items). VAT = T x V%. Total = T + VAT.
 * Line amounts (paisa) add up to the taxable amount exactly. One absorbing line takes the rest.
 * On the absorbing line the user fixes one box and the other adjusts:
 *   pcs / dozen: fix count -> rate absorbs
 *                fix rate  -> count suggested (nearest whole or half), rate absorbs
 *   kg:          fix rate  -> weight absorbs (3 dp first)
 *                fix weight -> rate absorbs
 * Excl mode with no taxable amount typed: no absorber. Lines are priced as entered and the bill
 * is built from them (taxable = sum of lines, then VAT on top).
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

  // VAT inclusive: base = G / (1 + V%).
  function taxable(G, V) {
    var base = round2(G / (1 + V / 100));
    return { base: base, vat: round2(G - base) };
  }

  // Taxable base and VAT for a typed amount, by mode. incl: amount is the total. excl: amount is the base.
  function taxableOf(amount, V, mode) {
    if (mode === 'excl') {
      var base = round2(amount);
      return { base: base, vat: round2(base * V / 100), total: round2(base + round2(base * V / 100)) };
    }
    var t = taxable(amount, V);
    return { base: t.base, vat: t.vat, total: amount };
  }

  function stepOf(unit) { return unit === 'doz' ? 0.5 : 1; }

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

  // Rate used by a line: typed rate, else max rate.
  function effRate(l) { return l.rate > 0 ? l.rate : l.std; }

  // What the user fixed on a line: 'count' or 'rate'. Default: count if one is typed, else rate.
  function fixedOf(l) { return l.fixed || (l.count > 0 ? 'count' : 'rate'); }

  // Whole count (or half dozen) that keeps the rate closest to the given rate.
  function nearestCount(unit, remRupees, rate) {
    var step = stepOf(unit);
    var lo = Math.max(step, Math.floor(remRupees / rate / step) * step);
    var hi = lo + step;
    return Math.abs(remRupees / lo - rate) <= Math.abs(remRupees / hi - rate) ? lo : hi;
  }

  // Counts around the suggestion and the rate each one gives. exact: amount to the paisa.
  function countOptions(unit, remP, rate) {
    var step = stepOf(unit);
    var c = nearestCount(unit, remP / 100, rate);
    var list = [];
    for (var k = -2; k <= 2; k++) {
      var n = roundTo(c + k * step, 2);
      if (n < step - 1e-9) continue;
      var r = round2(remP / 100 / n);
      list.push({
        count: n,
        rate: r,
        gapPct: roundTo((r - rate) / rate * 100, 2),
        exact: Number.isInteger(remP / n)
      });
    }
    list.sort(function (a, b) { return Math.abs(a.gapPct) - Math.abs(b.gapPct) || a.count - b.count; });
    return list;
  }

  // Counts that give the total to the paisa, searched up to about twice the suggestion.
  function exactCounts(unit, remP, around) {
    var step = stepOf(unit), out = [];
    var top = Math.max(around * 2, 6);
    for (var n = step; n <= top + 1e-9 && out.length < 6; n += step) {
      if (Number.isInteger(remP / n)) out.push({ count: n, rate: remP / n / 100 });
    }
    return out;
  }

  // Absorber: a line with a blank count (it suggests its own count), else the pcs/dozen line
  // with the smallest count (a count of 1 keeps the rate exact to the paisa), else the first kg
  // line (its rate would absorb a typed weight and can leave a gap), else the first line.
  function defaultAbsorber(lines) {
    var blank = null, kg = null, small = null;
    lines.forEach(function (l) {
      if (!blank && !(l.count > 0) && fixedOf(l) === 'rate') blank = l;
      if (!kg && l.unit === 'kg') kg = l;
      if (l.unit !== 'kg' && l.count > 0 && (!small || l.count < small.count)) small = l;
    });
    var pick = blank || small || kg || lines[0] || null;
    return pick ? pick.id : null;
  }

  // Count-1 line that can take a paisa gap: its rate moves, its count stays.
  function fixerRow(rows) {
    var found = null;
    rows.forEach(function (r) { if (!found && !r.absorbs && !r.error && r.qty === 1) found = r; });
    return found;
  }

  // Kg absorber with the rate fixed: try 3 dp and 4 dp weights either side of the exact one.
  // Order: exact, then a gap a count-1 line closes within its max, then fewer decimals,
  // then the smaller gap.
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

  // lines: [{id, name, unit, count, std, buy, rate, fixed}]
  // absorberId: line that takes the rest, or null (then the variance shows).
  // mode: 'incl' (default) or 'excl'. In excl, G is the taxable amount; NaN or 0 means build from items.
  function solveBill(G, V, lines, absorberId, mode) {
    var excl = mode === 'excl';
    var out = { ok: false, msg: '', mode: excl ? 'excl' : 'incl', hasTarget: false, G: G, V: V,
                base: NaN, vat: NaN, billTotal: NaN, X: NaN, remP: NaN, rows: [], total: 0, variance: 0 };
    if (!(V >= 0)) { out.msg = 'Enter the VAT %.'; return out; }
    if (!excl && !(G > 0)) { out.msg = 'Enter the bill total.'; return out; }
    if (!lines.length) { out.msg = 'Add at least one item.'; return out; }

    var hasTarget = !excl || G > 0;
    out.hasTarget = hasTarget;
    var target = hasTarget ? toPaisa(taxableOf(G, V, out.mode).base) : null;

    var absorber = null;
    if (hasTarget) lines.forEach(function (l) { if (l.id === absorberId) absorber = l; });

    var rows = lines.map(function (l) {
      return { id: l.id, name: l.name, unit: l.unit, qty: l.count, rate: NaN, std: l.std, buy: l.buy,
               sub: 0, absorbs: l === absorber, adjusted: false, error: null,
               flag: 'NONE', pct: null, aboveMax: false, fixedBy: null, typedRate: null };
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

    // 2. Absorber takes the rest of the target.
    if (absorber) {
      var row = rows[lines.indexOf(absorber)];
      var rem = target - fixed;
      var rateVal = effRate(absorber);
      var rateFixed = fixedOf(absorber) === 'rate' && rateVal > 0;
      var err2 = null;
      out.remP = rem;
      row.fixedBy = rateFixed ? 'rate' : 'count';
      if (rateFixed) row.typedRate = rateVal;

      if (rem <= 0) {
        err2 = 'Other lines already reach the bill total. Lower a count or rate.';
      } else if (absorber.unit === 'kg' && rateFixed) {
        row.rate = rateVal;
        row.qty = pickKgQty(rem, rateVal, fixerRow(rows));
      } else if (absorber.unit !== 'kg' && rateFixed) {
        row.qty = nearestCount(absorber.unit, rem / 100, rateVal);
        row.rate = round2(rem / 100 / row.qty);
      } else {
        err2 = countError(absorber.unit, absorber.count);
        if (err2 && fixedOf(absorber) === 'rate') err2 = 'Enter the max rate or the count.';
        if (!err2) {
          row.qty = absorber.count;
          row.rate = round2(rem / 100 / row.qty);
        }
      }
      if (!err2 && !(row.qty > 0 && row.rate > 0)) err2 = 'Rate would be zero. Lower other lines.';
      if (err2) { row.error = err2; errors.push(err2); }
      else row.sub = toPaisa(row.qty * row.rate);
    }

    // 3. Close a paisa gap on a count-1 line: its rate moves by the gap, never above max.
    var total = sumSubs(rows);
    var resid = (target === null ? 0 : target) - total;
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
    out.ok = errors.length === 0;
    out.msg = errors.length ? errors[0] : '';
    out.X = target === null ? total : target;
    out.variance = target === null ? 0 : total - target;

    // Taxable base, VAT, bill total. Without a target and with errors, the base is unknown.
    if (target === null && !out.ok) return out;
    var baseRup = roundTo(out.X / 100, 2);
    out.base = baseRup;
    if (excl) {
      out.vat = round2(baseRup * V / 100);
      out.billTotal = out.X + toPaisa(out.vat);
    } else {
      out.vat = round2(G - baseRup);
      out.billTotal = toPaisa(G);
    }
    return out;
  }

  // Plain arithmetic: numbers, + - * /, parentheses, unary minus. Returns NaN on error.
  // Trailing operators are ignored (so "5*" reads as 5). No eval.
  function evalExpr(src) {
    var s = String(src == null ? '' : src).replace(/×/g, '*').replace(/÷/g, '/').replace(/\s+/g, '');
    s = s.replace(/[+\-*\/]+$/, '');
    if (!s) return NaN;
    var toks = s.match(/\d+\.?\d*|\.\d+|[+\-*\/()]/g);
    if (!toks || toks.join('') !== s) return NaN;
    var i = 0;
    function primary() {
      var t = toks[i];
      if (t === '(') {
        i++;
        var v = expr();
        if (toks[i] !== ')') throw new Error('paren');
        i++;
        return v;
      }
      if (/^(\d|\.)/.test(t)) { i++; return Number(t); }
      throw new Error('token');
    }
    function unary() {
      if (toks[i] === '-') { i++; return -unary(); }
      if (toks[i] === '+') { i++; return unary(); }
      return primary();
    }
    function term() {
      var v = unary();
      while (toks[i] === '*' || toks[i] === '/') {
        var op = toks[i++], r = unary();
        v = op === '*' ? v * r : v / r;
      }
      return v;
    }
    function expr() {
      var v = term();
      while (toks[i] === '+' || toks[i] === '-') {
        var op = toks[i++], r = term();
        v = op === '+' ? v + r : v - r;
      }
      return v;
    }
    try {
      var result = expr();
      if (i !== toks.length || !isFinite(result)) return NaN;
      return result;
    } catch (e) {
      return NaN;
    }
  }

  var api = {
    roundTo: roundTo,
    round2: round2,
    toPaisa: toPaisa,
    taxable: taxable,
    taxableOf: taxableOf,
    solveKgQty: solveKgQty,
    countError: countError,
    bandStatus: bandStatus,
    effRate: effRate,
    fixedOf: fixedOf,
    nearestCount: nearestCount,
    countOptions: countOptions,
    exactCounts: exactCounts,
    defaultAbsorber: defaultAbsorber,
    solveBill: solveBill,
    evalExpr: evalExpr,
    BAND_LOW: BAND_LOW,
    BAND_HIGH: BAND_HIGH
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Solver = api;
})(typeof window !== 'undefined' ? window : {});
