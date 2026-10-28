/* Counter sales: pure rules, item search and a plain calculator. No DOM.
 * Browser: window.Solver. Node tests: require().
 *
 * VAT modes:
 *   incl (default): bill total G is VAT inclusive. Taxable base = G / (1 + V%). VAT = G - base.
 *   excl:           taxable amount T is typed (or built from the items). VAT = T x V%. Total = T + VAT.
 * Every line is priced as typed: count x rate. Rate starts at the max sell rate.
 * Nothing absorbs the difference. The status shows the variance against the bill total.
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
      var vat = round2(base * V / 100);
      return { base: base, vat: vat, total: round2(base + vat) };
    }
    var t = taxable(amount, V);
    return { base: t.base, vat: t.vat, total: amount };
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

  // Rate used by a line: typed rate, else max sell rate.
  function effRate(l) { return l.rate > 0 ? l.rate : l.std; }

  // lines: [{id, name, unit, count, std, buy, rate}]
  // mode: 'incl' (default) or 'excl'. In excl, G is the taxable amount; NaN or 0 means build from items.
  function solveBill(G, V, lines, mode) {
    var excl = mode === 'excl';
    var out = { ok: false, msg: '', mode: excl ? 'excl' : 'incl', hasTarget: false, G: G, V: V,
                base: NaN, vat: NaN, billTotal: NaN, X: NaN, total: 0, variance: 0, rows: [] };
    // A target exists once a bill total (or typed taxable amount) and a VAT % are given.
    var target = (G > 0 && V >= 0) ? toPaisa(taxableOf(G, V, out.mode).base) : null;
    out.hasTarget = target !== null;

    // Lines are always priced, so each line can show its own message before the total is typed.
    var errors = [];
    var total = 0;
    out.rows = lines.map(function (l) {
      var row = { id: l.id, name: l.name, unit: l.unit, qty: l.count, rate: NaN, std: l.std, buy: l.buy,
                  sub: 0, error: null, flag: 'NONE', pct: null, aboveMax: false };
      var err = countError(l.unit, l.count);
      if (!err && !(effRate(l) > 0)) err = 'Enter the rate.';
      if (err) { row.error = err; errors.push(err); return row; }
      row.rate = effRate(l);
      row.sub = toPaisa(l.count * row.rate);
      total += row.sub;
      var b = bandStatus(row.rate, row.buy);
      row.flag = b.status;
      row.pct = b.pct;
      row.aboveMax = row.std > 0 && row.rate > row.std + 1e-9;
      return row;
    });

    out.total = total;
    out.ok = errors.length === 0 && V >= 0 && lines.length > 0 && (excl || G > 0);
    out.msg = !(V >= 0) ? 'Enter the VAT %.'
      : (!excl && !(G > 0)) ? 'Enter the bill total.'
      : errors.length ? errors[0] : '';
    out.X = target !== null ? target : total;
    out.variance = target !== null ? total - target : 0;

    // Taxable base, VAT, bill total. Without a target and with errors, the base is unknown.
    if (!(V >= 0) || (target === null && !out.ok)) return out;
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

  var api = {
    roundTo: roundTo,
    round2: round2,
    toPaisa: toPaisa,
    taxable: taxable,
    taxableOf: taxableOf,
    countError: countError,
    bandStatus: bandStatus,
    effRate: effRate,
    solveBill: solveBill,
    searchKey: searchKey,
    matchItems: matchItems,
    findItem: findItem,
    evalExpr: evalExpr,
    BAND_LOW: BAND_LOW,
    BAND_HIGH: BAND_HIGH
  };

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

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Solver = api;
})(typeof window !== 'undefined' ? window : {});
