/* Counter sales: reverse-VAT unit solver. Standalone, works offline.
 * Rules: taxable base X = G / (1 + V%). Pcs and dozen counts are never rounded;
 * the rate absorbs the difference. Kg: quantity absorbs by default (rate fixed).
 */
(function () {
  'use strict';

  var BAND_LOW = 5;   // % over buy cost; below this is a LOSS
  var BAND_HIGH = 7;  // % over buy cost; above this is OVER TAX
  var VAT_DEFAULT = '13';
  var WORD = { pcs: 'pcs', doz: 'doz', kg: 'kg' };
  var PER = { pcs: 'pc', doz: 'dozen', kg: 'kg' };
  var STEPS = {
    pcs: { steps: [-1, 1, 10], presets: [1, 2, 3, 5], min: 1 },
    doz: { steps: [-0.5, 0.5, 1], presets: [0.5, 1, 1.5, 2], min: 0.5 }
  };

  // ---------- pure rules (unit tested) ----------

  function roundTo(n, d) {
    var f = Math.pow(10, d);
    var r = Math.round(Math.abs(n) * f + 1e-9) / f;
    return n < 0 ? -r : r;
  }
  function round2(n) { return roundTo(n, 2); }

  // Amount in paisa, after removing float noise.
  function toPaisa(x) { return Math.round(Math.round(x * 1e6) / 1e4); }

  function taxable(gross, vatPct) {
    var base = round2(gross / (1 + vatPct / 100));
    return { base: base, vat: round2(gross - base) };
  }

  // Kg with the rate fixed: quantity to 3 dp, or 4 dp if that makes the total exact.
  function solveKgQty(base, rate) {
    var raw = base / rate;
    var q3 = roundTo(raw, 3);
    if (toPaisa(q3 * rate) === toPaisa(base)) return q3;
    var q4 = roundTo(raw, 4);
    return toPaisa(q4 * rate) === toPaisa(base) ? q4 : q3;
  }

  function countError(unit, q) {
    if (!(q > 0)) return 'Enter the count sold.';
    if (unit === 'pcs' && q !== Math.floor(q)) return 'Pcs are whole numbers: 1, 2, 3…';
    if (unit === 'doz' && Math.abs(q * 2 - Math.round(q * 2)) > 1e-9) return 'Dozens go in halves: ½, 1, 1½…';
    if (unit === 'kg' && Math.abs(q * 1000 - Math.round(q * 1000)) > 1e-6) return 'Weight goes to 3 decimals at most.';
    return null;
  }

  // Margin of rate over buy cost (both in the same unit).
  function bandStatus(rate, buy, low, high) {
    if (!(buy > 0)) return { status: 'NONE' };
    var m = (rate - buy) / buy * 100;
    var out = {
      status: 'OK',
      pct: round2(m),
      low: round2(buy * (1 + low / 100)),
      high: round2(buy * (1 + high / 100))
    };
    if (m < low - 1e-9) out.status = 'LOSS';
    else if (m > high + 1e-9) out.status = 'OVER_TAX';
    return out;
  }

  // Closest whole counts (pcs) or half-dozens (doz) to the standard rate.
  function closestCounts(base, unit, std) {
    if (!(base > 0) || !(std > 0)) return [];
    var step = unit === 'doz' ? 0.5 : 1;
    var center = Math.round(base / std / step) * step;
    var seen = {}, list = [];
    for (var k = -2; k <= 2; k++) {
      var n = roundTo(center + k * step, 2);
      if (n < step - 1e-9 || seen[n]) continue;
      seen[n] = true;
      var rate = round2(base / n);
      list.push({ count: n, rate: rate, gapPct: roundTo((rate - std) / std * 100, 2) });
    }
    list.sort(function (a, b) { return Math.abs(a.gapPct) - Math.abs(b.gapPct) || a.count - b.count; });
    return list.slice(0, 4);
  }

  // ---------- screen ----------

  var state = { unit: 'pcs', absorb: 'qty', rateManual: false };
  var nf = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var toastTimer = null;

  function $(id) { return document.getElementById(id); }
  function fmt(n) { return nf.format(n); }
  function trimNum(n, d) { return String(Number(n.toFixed(d))); }
  function fmtQty(q) { return trimNum(q, state.unit === 'kg' ? 4 : 2); }
  function fracLabel(n) {
    var w = Math.floor(n + 1e-9), half = n - w > 0.25;
    return (w ? String(w) : '') + (half ? '½' : '') || '0';
  }
  function val(id) {
    var s = $(id).value.trim();
    return s === '' ? NaN : Number(s);
  }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1800);
  }

  // Everything the result needs, from the current inputs.
  function compute() {
    var G = val('gross'), V = val('vat');
    var u = state.unit, kg = u === 'kg';
    var r = { ok: false, msg: 'Enter the bill total to start.', G: G, V: V };
    if (!(G > 0)) return r;
    if (!(V >= 0)) { r.msg = 'Enter the VAT %.'; return r; }

    var t = taxable(G, V);
    r.base = t.base;
    r.vat = t.vat;

    var qty, rate;
    if (kg && state.absorb === 'qty') {
      var std = val('std');
      if (!(std > 0)) { r.msg = 'Enter the standard rate per kg.'; return r; }
      rate = std;
      qty = solveKgQty(r.base, std);
    } else {
      qty = val('qty');
      var err = countError(u, qty);
      if (err) { r.msg = err; return r; }
      if (!kg && state.rateManual) {
        rate = val('rate');
        if (!(rate > 0)) { r.msg = 'Enter the rate, or tap "Let rate follow count again".'; return r; }
      } else {
        rate = round2(r.base / qty);
      }
    }

    var totalP = toPaisa(qty * rate);
    r.ok = true;
    r.qty = qty;
    r.rate = rate;
    r.total = totalP / 100;
    r.variance = (totalP - toPaisa(r.base)) / 100;
    r.band = bandStatus(rate, val('buy'), BAND_LOW, BAND_HIGH);
    return r;
  }

  function labels() {
    var per = PER[state.unit];
    if (state.unit === 'kg') {
      return {
        std: 'Standard rate (NPR per kg)',
        buy: 'Buy cost (NPR per kg, optional)',
        rate: 'Rate (NPR per kg)',
        qty: state.absorb === 'qty' ? 'Quantity (worked out)' : 'Weight sold (kg)'
      };
    }
    return {
      std: 'Standard rate (NPR per ' + per + ')',
      buy: 'Buy cost (NPR per ' + per + ', optional)',
      rate: 'Rate (NPR per ' + per + ')',
      qty: state.unit === 'pcs' ? 'Pieces sold (whole)' : 'Dozens sold (halves)'
    };
  }

  function hints() {
    if (state.unit === 'kg') {
      return {
        absorb: state.absorb === 'qty'
          ? 'Quantity adjusts. Rate stays at the standard.'
          : 'Rate adjusts. You type the weight sold.',
        qty: state.absorb === 'qty'
          ? 'Worked out so the total equals the bill.'
          : 'Type the weight you sold.',
        rate: 'Worked out from the weight.'
      };
    }
    return {
      absorb: '',
      qty: state.unit === 'pcs' ? 'Whole pieces only. The rate absorbs the difference.'
                                : 'Halves only. The rate absorbs the difference.',
      rate: state.rateManual
        ? 'Typed by you. The count is held and the variance shows the difference.'
        : 'Follows the count. Type here to hold a rate instead.'
    };
  }

  function setPressed(selector, key, value) {
    var list = document.querySelectorAll(selector);
    for (var i = 0; i < list.length; i++) {
      var on = list[i].dataset[key] === value;
      list[i].classList.toggle('active', on);
      list[i].setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }

  function makeButton(label, cls, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  function buildStepper() {
    var box = $('stepper'), pre = $('presets');
    if (box.dataset.built === state.unit) return;
    box.dataset.built = state.unit;
    box.innerHTML = '';
    pre.innerHTML = '';
    var cfg = STEPS[state.unit];
    if (!cfg) return;
    cfg.steps.forEach(function (d) {
      box.appendChild(makeButton((d > 0 ? '+' : '−') + fracLabel(Math.abs(d)), 'step-btn', function () { bump(d); }));
    });
    cfg.presets.forEach(function (n) {
      pre.appendChild(makeButton(fracLabel(n), 'step-btn', function () { pick(n); }));
    });
  }

  function renderCands(r) {
    var box = $('cands');
    var list = (state.unit !== 'kg' && r.base !== undefined)
      ? closestCounts(r.base, state.unit, val('std')) : [];
    box.innerHTML = '';
    box.hidden = list.length === 0;
    if (!list.length) return;

    var head = document.createElement('p');
    head.className = 'hint';
    head.textContent = 'Closest counts at the standard rate. Tap one to use it.';
    box.appendChild(head);

    list.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cand';
      var s = document.createElement('strong');
      s.textContent = fmtQty(c.count) + ' ' + WORD[state.unit];
      var sp = document.createElement('span');
      sp.textContent = 'rate ' + fmt(c.rate) + ' (' + (c.gapPct > 0 ? '+' : '') + c.gapPct + '% vs std)';
      b.appendChild(s);
      b.appendChild(sp);
      b.addEventListener('click', function () { pick(c.count); });
      box.appendChild(b);
    });
  }

  function render() {
    var kg = state.unit === 'kg';
    var r = compute();
    var L = labels(), H = hints();

    buildStepper();
    setPressed('[data-unit]', 'unit', state.unit);
    setPressed('[data-absorb]', 'absorb', state.absorb);

    $('kgBox').hidden = !kg;
    $('absorbHint').textContent = kg ? H.absorb : '';
    $('countKeys').hidden = kg;
    $('stdLabel').textContent = L.std;
    $('buyLabel').textContent = L.buy;
    $('qtyLabel').textContent = L.qty;
    $('rateLabel').textContent = L.rate;
    $('qtyHint').textContent = H.qty;
    $('rateHint').textContent = H.rate;
    $('qty').readOnly = kg && state.absorb === 'qty';
    $('rate').readOnly = kg;
    $('letRate').hidden = kg || !state.rateManual;

    // Step 1 ledger
    $('baseOut').textContent = r.base !== undefined ? fmt(r.base) : '—';
    $('vatOut').textContent = r.vat !== undefined ? fmt(r.vat) : '—';
    $('formula').textContent = r.base !== undefined
      ? 'Taxable base = ' + fmt(r.G) + ' ÷ (1 + ' + r.V + '%)' : '';

    // Values the calculator fills in. The user types only the fixed ones.
    if (kg && state.absorb === 'qty') $('qty').value = r.ok ? trimNum(r.qty, 4) : '';
    if (kg || !state.rateManual) {
      $('rate').value = r.ok ? (kg ? trimNum(r.rate, 4) : r.rate.toFixed(2)) : '';
    }

    // Step 4 result
    var verify = $('verify'), cls = 'verify';
    if (!r.ok) {
      $('verifyEq').textContent = '—';
      $('verifyStatus').textContent = r.msg;
      $('band').textContent = '';
      $('band').className = 'band';
    } else {
      $('verifyEq').textContent = fmtQty(r.qty) + ' ' + WORD[state.unit] + ' × ' +
        fmt(r.rate) + ' = ' + fmt(r.total);
      $('verifyStatus').textContent = r.variance === 0
        ? 'Exact. The total equals the taxable base ' + fmt(r.base) + '.'
        : 'Variance ' + (r.variance > 0 ? '+' : '−') + fmt(Math.abs(r.variance)) +
          ' against the taxable base ' + fmt(r.base) + '.';

      var b = r.band, bandCls = 'band ok', bandText;
      if (b.status === 'NONE') {
        bandCls = 'band';
        bandText = 'Enter the buy cost to check the 5–7% band.';
      } else if (b.status === 'LOSS') {
        bandCls = 'band bad';
        bandText = 'LOSS: margin ' + b.pct + '% is below ' + BAND_LOW +
          '%. Staff, rent and other costs are not covered.';
      } else if (b.status === 'OVER_TAX') {
        bandCls = 'band warn';
        bandText = 'OVER TAX: margin ' + b.pct + '% is above ' + BAND_HIGH +
          '%. Extra tax applies to the profit above the band.';
      } else {
        bandText = 'Margin ' + b.pct + '%, inside the band. Allowed rate NPR ' +
          fmt(b.low) + ' to ' + fmt(b.high) + ' per ' + PER[state.unit] + '.';
      }
      $('band').textContent = bandText;
      $('band').className = bandCls;

      if (b.status === 'LOSS') cls = 'verify bad';
      else if (b.status === 'OVER_TAX' || r.variance !== 0) cls = 'verify warn';
      else cls = 'verify ok';
    }
    verify.className = cls;

    var name = $('item').value.trim() || 'Item';
    $('billing').value = r.ok
      ? name + ': ' + fmtQty(r.qty) + ' ' + WORD[state.unit] + ' × NPR ' + fmt(r.rate) +
        ' = NPR ' + fmt(r.total)
      : '';

    renderCands(r);
  }

  // Count choices from buttons: the count is set and the rate follows it again.
  function pick(n) {
    $('qty').value = String(n);
    state.rateManual = false;
    render();
  }

  function bump(d) {
    var cfg = STEPS[state.unit];
    var step = state.unit === 'doz' ? 0.5 : 1;
    var cur = val('qty');
    if (!(cur > 0)) cur = 0;
    var next = Math.max(cfg.min, Math.round((cur + d) / step) * step);
    pick(next);
  }

  function setUnit(u) {
    var from = state.unit;
    if (u === from) return;
    var kgSwitch = from === 'kg' || u === 'kg';
    var factor = (from === 'pcs' && u === 'doz') ? 12
               : (from === 'doz' && u === 'pcs') ? 1 / 12 : 1;
    ['std', 'buy'].forEach(function (id) {
      var v = val(id);
      if (kgSwitch) $(id).value = '';
      else if (v > 0) $(id).value = String(roundTo(v * factor, 4));
    });
    state.unit = u;
    state.rateManual = false;
    $('qty').value = '';
    $('rate').value = '';
    render();
  }

  function resetAll() {
    ['gross', 'item', 'std', 'buy', 'qty', 'rate'].forEach(function (id) { $(id).value = ''; });
    $('vat').value = VAT_DEFAULT;
    state.unit = 'pcs';
    state.absorb = 'qty';
    state.rateManual = false;
    render();
    $('gross').focus();
    toast('Cleared. Ready for the next bill.');
  }

  function onInput(e) {
    // Typing in the rate holds it. Only the "Let rate follow count again" button releases it.
    if (e.target.id === 'rate') state.rateManual = true;
    render();
  }

  function copyLine() {
    var el = $('billing'), text = el.value;
    if (!text) { toast('Enter the bill first.'); return; }
    function fallback() {
      el.removeAttribute('readonly');
      el.focus();
      el.select();
      el.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      el.setAttribute('readonly', '');
      toast(ok ? 'Copied.' : 'Select the text and copy it.');
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { toast('Copied.'); }, fallback);
    } else {
      fallback();
    }
  }

  function init() {
    ['gross', 'vat', 'std', 'buy', 'item', 'qty', 'rate'].forEach(function (id) {
      $(id).addEventListener('input', onInput);
    });
    document.querySelectorAll('[data-unit]').forEach(function (b) {
      b.addEventListener('click', function () { setUnit(b.dataset.unit); });
    });
    document.querySelectorAll('[data-absorb]').forEach(function (b) {
      b.addEventListener('click', function () { state.absorb = b.dataset.absorb; render(); });
    });
    $('letRate').addEventListener('click', function () {
      state.rateManual = false;
      $('rate').value = '';
      render();
    });
    $('resetBtn').addEventListener('click', resetAll);
    $('copyBtn').addEventListener('click', copyLine);
    render();
  }

  // Pure rules are exported for tests (Node). The page only needs init().
  var api = {
    roundTo: roundTo, round2: round2, toPaisa: toPaisa, taxable: taxable,
    solveKgQty: solveKgQty, countError: countError, bandStatus: bandStatus,
    closestCounts: closestCounts
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})();
