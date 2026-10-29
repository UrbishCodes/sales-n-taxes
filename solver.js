/* FanumTaxxed — pure rules: linked amounts, absorber engine, item search, calculator. No DOM.
 * Browser: window.Solver. Node tests: require().
 *
 * VAT modes:
 *   rev (VAT included):    the typed figure G is VAT inclusive. Base X = G / (1 + V%). VAT = G - X.
 *   nonrev (VAT excluded): the typed figure is the taxable base X (or the bill is built from the
 *                          items). VAT = X x V%. Total = X + VAT.
 *
 * Absorber engine (restored — it was deleted from the live build on Oct 28):
 *   Lines add up to the taxable base exactly. One line takes the rest of the target.
 *   The field the user LAST TYPED is the anchor and is never overwritten:
 *     anchor count -> the rate absorbs.  rate = remainder / count, 2 dp, deeper decimals only
 *                     when that is what makes the line exact to the paisa.
 *     anchor rate  -> pcs/doz: count = nearest valid step (whole pcs, half dozens),
 *                     then rate = remainder / count (the count constraint wins).
 *                  -> kg: the weight absorbs at 3-4 dp; the typed rate is kept.
 *   The box the user did NOT touch shows the reconciled value. User input always wins.
 *   The old "fixed" ping-pong (typing one box wiped the other) is gone: both typed values
 *   are remembered; only the last-edited one anchors, the other reconciles.
 *
 * Band: the stock summary prices most items 6.9-7.5% over buy cost, so the old 5-7% band
 * flagged 52 of 93 items at their own max rate. The band is now 5-8.5%.
 */
(function (root) {
  'use strict';

  var BAND_LOW = 5;    // % over buy cost; below this is LOSS
  var BAND_HIGH = 8.5; // % over buy cost; above this is OVER_TAX

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
  function amountsFromGross(G, V) {
    var t = taxable(G, V);
    return { base: t.base, vat: t.vat, total: round2(G) };
  }
  function amountsFromBase(X, V) {
    var base = round2(X);
    var vat = round2(base * V / 100);
    return { base: base, vat: vat, total: round2(base + vat) };
  }
  // mode: 'rev' | 'nonrev' (accepts the old 'incl' | 'excl' too). amount is the typed figure.
  function taxableOf(amount, V, mode) {
    if (mode === 'nonrev' || mode === 'excl') return amountsFromBase(amount, V);
    return amountsFromGross(amount, V);
  }
  function normMode(mode) { return (mode === 'excl' || mode === 'nonrev') ? 'nonrev' : 'rev'; }

  function stepOf(unit) { return unit === 'doz' ? 0.5 : 1; }

  function countError(unit, q) {
    if (!(q > 0)) return 'Enter the count.';
    if (unit === 'pcs' && q !== Math.floor(q)) return 'Pcs are whole numbers.';
    if (unit === 'doz' && Math.abs(q * 2 - Math.round(q * 2)) > 1e-9) return 'Dozens go in halves.';
    if (unit === 'kg' && Math.abs(q * 10000 - Math.round(q * 10000)) > 1e-6) return 'Weight goes to 4 decimals.';
    return null;
  }

  // Margin of a rate over buy cost (same unit). Band 5% to 8.5%.
  function bandStatus(rate, buy) {
    if (!(buy > 0)) return { status: 'NONE', pct: null };
    var m = (rate - buy) / buy * 100;
    var status = 'OK';
    if (m < BAND_LOW - 1e-9) status = 'LOSS';
    else if (m > BAND_HIGH + 1e-9) status = 'OVER_TAX';
    return { status: status, pct: round2(m) };
  }

  // Rate used by a line: typed rate, else max sell rate.
  function effRate(l) { return l.rate > 0 ? l.rate : l.std; }

  // What the user last typed on a line: 'count' or 'rate'. Falls back to whichever is present.
  function anchorOf(l) { return l.lastField || (l.count > 0 ? 'count' : 'rate'); }

  // Whole count (or half dozen) that keeps the rate closest to the given rate.
  function nearestCount(unit, remRupees, rate) {
    var step = stepOf(unit);
    var lo = Math.max(step, Math.floor(remRupees / rate / step + 1e-9) * step);
    var hi = lo + step;
    return Math.abs(remRupees / lo - rate) <= Math.abs(remRupees / hi - rate) ? lo : hi;
  }

  // Rate that prices qty x rate exactly to rem paisa: 2 dp first, deeper only if exact.
  function bestRateFor(remP, qty) {
    for (var dp = 2; dp <= 5; dp++) {
      var r = roundTo(remP / 100 / qty, dp);
      if (toPaisa(r * qty) === remP) return { rate: r, dp: dp };
    }
    return { rate: round2(remP / 100 / qty), dp: 2 };
  }

  // Kg with the rate fixed: weight to 3 dp, or 4 dp when that makes the amount exact.
  function solveKgQty(base, rate) {
    var raw = base / rate;
    var q3 = roundTo(raw, 3);
    if (toPaisa(q3 * rate) === toPaisa(base)) return q3;
    var q4 = roundTo(raw, 4);
    return toPaisa(q4 * rate) === toPaisa(base) ? q4 : q3;
  }

  // Kg absorber candidates (3 dp and 4 dp either side of the exact weight), best first.
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
    return best ? best.q : roundTo(raw, 3);
  }

  function lessKey(a, b) {
    for (var i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return a[i] < b[i];
    }
    return false;
  }

  // Counts around the current one and the rate each gives (the same deep-dp rate the
  // solver would actually apply). exact: amount to the paisa.
  function countOptions(unit, remP, around, basis) {
    var step = stepOf(unit);
    var list = [];
    for (var k = -2; k <= 2; k++) {
      var n = roundTo(around + k * step, 2);
      if (n < step - 1e-9) continue;
      var r = bestRateFor(remP, n).rate;
      list.push({
        count: n,
        rate: r,
        gapPct: basis > 0 ? roundTo((r - basis) / basis * 100, 2) : 0,
        exact: remP % n === 0
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
      if (Math.abs(remP / n - Math.round(remP / n)) < 1e-6) {
        out.push({ count: n, rate: roundTo(remP / n / 100, 4) });
      }
    }
    return out;
  }

  // Kg weight chips: the pickKgQty candidates with their paisa gap.
  function kgChips(rem, rate) {
    var raw = rem / 100 / rate;
    var seen = {}, out = [];
    [[1000, 3], [10000, 4]].forEach(function (p) {
      var f = p[0], dec = p[1];
      [Math.floor(raw * f + 1e-9) / f, Math.ceil(raw * f - 1e-9) / f].forEach(function (q) {
        if (q > 0 && !seen[q]) {
          seen[q] = 1;
          out.push({ w: roundTo(q, 4), gap: rem - toPaisa(q * rate) });
        }
      });
    });
    out.sort(function (a, b) { return Math.abs(a.gap) - Math.abs(b.gap); });
    return out.slice(0, 4);
  }

  // Absorber default: a line with a blank count (rate/std basis), else the pcs/dozen line
  // with the smallest count, else the first kg line, else the first line.
  function defaultAbsorber(lines) {
    var blank = null, kg = null, small = null;
    lines.forEach(function (l) {
      if (!blank && !(l.count > 0) && anchorOf(l) === 'rate') blank = l;
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

  function sumSubs(rows) {
    return rows.reduce(function (s, r) { return s + (r.error ? 0 : r.sub); }, 0);
  }

  // lines: [{id, name, unit, count, std, buy, rate, lastField}]
  //   count / rate are the USER-TYPED values (NaN when untouched). lastField: 'count' | 'rate'.
  // X: taxable base in rupees (the target), or null/NaN when there is none.
  // absorberId: line that takes the rest, or null (then the variance shows).
  function solveBill(X, V, lines, absorberId) {
    var hasTarget = isFinite(X) && X > 0;
    var out = { ok: false, msg: '', hasTarget: hasTarget, X: hasTarget ? round2(X) : NaN,
                remP: NaN, rows: [], total: 0, variance: 0 };
    if (!lines.length) { out.msg = 'Add at least one item.'; return out; }

    var target = hasTarget ? toPaisa(X) : null;

    var absorber = null;
    if (hasTarget) lines.forEach(function (l) { if (l.id === absorberId) absorber = l; });

    var rows = lines.map(function (l) {
      return { id: l.id, name: l.name, unit: l.unit, qty: l.count, rate: NaN, rateDp: 2,
               std: l.std, buy: l.buy, sub: 0, absorbs: l === absorber, anchor: null,
               typedRate: null, adjusted: false, error: null, flag: 'NONE', pct: null, aboveMax: false };
    });
    var errors = [];
    var fixedSum = 0;

    // 1. Lines priced as entered (all except the absorber).
    lines.forEach(function (l, i) {
      var row = rows[i];
      if (l === absorber) return;
      var err = countError(l.unit, l.count);
      if (!err && !(effRate(l) > 0)) err = 'Enter the rate.';
      if (err) { row.error = err; errors.push(err); return; }
      row.rate = effRate(l);
      row.sub = toPaisa(l.count * row.rate);
      fixedSum += row.sub;
    });

    // 2. Absorber takes the rest of the target. The anchor box keeps the user's typing.
    if (absorber) {
      var row = rows[lines.indexOf(absorber)];
      var rem = target - fixedSum;
      var anchor = anchorOf(absorber);
      var err2 = null;
      out.remP = rem;
      row.anchor = anchor;

      if (rem <= 0) {
        err2 = 'Other lines already reach the bill total. Lower a count or rate.';
      } else if (anchor === 'count' && absorber.count > 0) {
        // User's count kept exactly; the rate absorbs.
        var cnt = countError(absorber.unit, absorber.count);
        if (cnt) err2 = cnt;
        else {
          row.qty = absorber.count;
          var best = bestRateFor(rem, row.qty);
          row.rate = best.rate;
          row.rateDp = best.dp;
        }
      } else {
        // Rate basis: typed rate, else max rate. The other box re-derives.
        var basis = absorber.rate > 0 ? absorber.rate : absorber.std;
        row.typedRate = basis;
        if (!(basis > 0)) err2 = 'Enter the count or the rate.';
        else if (absorber.unit === 'kg') {
          row.rate = basis;                       // typed rate kept; weight absorbs
          row.qty = pickKgQty(rem, basis, fixerRow(rows));
        } else {
          row.qty = nearestCount(absorber.unit, rem / 100, basis);
          var best2 = bestRateFor(rem, row.qty);  // count constraint wins; rate reconciles
          row.rate = best2.rate;
          row.rateDp = best2.dp;
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
    out.variance = target === null ? 0 : total - target;
    return out;
  }

  // ---------- unit switch: keep the item, keep pcs/doz rates convertible ----------

  // std/buy for a line after switching units (values, so manual edits convert too).
  // pcs<->doz converts by 12. A kg switch blanks them (per-kg rates are a different number);
  // the caller keeps the item link and restores these from the item when switching back.
  function switchUnitMeta(std, buy, from, to) {
    if (from === to) return { std: std, buy: buy };
    if (from === 'kg' || to === 'kg') return { std: NaN, buy: NaN };
    var factor = (from === 'pcs' && to === 'doz') ? 12 : 1 / 12;
    return {
      std: std > 0 ? roundTo(std * factor, 4) : NaN,
      buy: buy > 0 ? roundTo(buy * factor, 4) : NaN
    };
  }

  // ---------- calculator "Use as bill total" without the VAT-space trap ----------

  // v: the calculator value. space: 'gross' (incl. VAT figure) | 'base' | null (unknown).
  // origin: the number it was converted FROM (+VAT: the base; -VAT / SPLIT: the gross).
  // mode 'rev': the bill box is the VAT-INCLUSIVE total. mode 'nonrev': it is the base.
  // Returns the value to type into the bill box, converted so it is never divided twice.
  function useValue(v, V, mode, space, origin) {
    var m = normMode(mode);
    if (m === 'rev') {
      if (space === 'base') {
        return { value: origin > 0 ? round2(origin) : round2(v * (1 + V / 100)), converted: true };
      }
      return { value: round2(v), converted: false };
    }
    if (space === 'gross') {
      return { value: origin > 0 ? round2(origin) : round2(v / (1 + V / 100)), converted: true };
    }
    return { value: round2(v), converted: false };
  }

  // ---------- item search ----------

  // Spelling in the stock summary (and the way people type it). Both sides are mapped the same way.
  var FIXES = [
    ['proterector', 'protector'], ['proterctor', 'protector'], ['protrector', 'protector'],
    ['protertor', 'protector'], ['proctertor', 'protector'], ['procetor', 'protector'],
    ['protaction', 'protector'], ['protiction', 'protector'],
    ['tempr', 'temper'], ['sticket', 'sticker'], ['camara', 'camera'], ['selfile', 'selfie']
  ];

  function searchKey(s) {
    var k = String(s == null ? '' : s).toLowerCase().replace(/#/g, ' ').replace(/\s+/g, ' ').trim();
    FIXES.forEach(function (p) { k = k.split(p[0]).join(p[1]); });
    return k;
  }

  // Items whose name holds every word typed. Names starting with the first word come first.
  function matchItems(items, text, limit) {
    var q = searchKey(text);
    if (!q) return [];
    var toks = q.split(' ');
    var hits = [];
    items.forEach(function (it, idx) {
      var k = searchKey(it.name);
      for (var i = 0; i < toks.length; i++) {
        if (k.indexOf(toks[i]) < 0) return;
      }
      hits.push({ it: it, idx: idx, rank: k.indexOf(toks[0]) === 0 ? 0 : 1, len: k.length });
    });
    hits.sort(function (a, b) { return a.rank - b.rank || a.len - b.len || a.idx - b.idx; });
    return hits.slice(0, limit || 12).map(function (h) { return h.it; });
  }

  // The item whose name matches exactly (ignoring case and the spelling fixes), or null.
  function findItem(items, name) {
    var k = searchKey(name);
    if (!k) return null;
    for (var i = 0; i < items.length; i++) {
      if (searchKey(items[i].name) === k) return items[i];
    }
    return null;
  }

  // ---------- plain calculator ----------

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
    amountsFromGross: amountsFromGross,
    amountsFromBase: amountsFromBase,
    normMode: normMode,
    stepOf: stepOf,
    countError: countError,
    bandStatus: bandStatus,
    effRate: effRate,
    anchorOf: anchorOf,
    nearestCount: nearestCount,
    bestRateFor: bestRateFor,
    solveKgQty: solveKgQty,
    pickKgQty: pickKgQty,
    countOptions: countOptions,
    exactCounts: exactCounts,
    kgChips: kgChips,
    defaultAbsorber: defaultAbsorber,
    solveBill: solveBill,
    switchUnitMeta: switchUnitMeta,
    useValue: useValue,
    searchKey: searchKey,
    matchItems: matchItems,
    findItem: findItem,
    evalExpr: evalExpr,
    BAND_LOW: BAND_LOW,
    BAND_HIGH: BAND_HIGH
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Solver = api;
})(typeof window !== 'undefined' ? window : {});
