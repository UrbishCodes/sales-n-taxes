/* Counter sales: one bill, one or many items, VAT included or excluded, plus a side calculator.
 * Uses window.Solver (solver.js). Works offline. */
(function () {
  'use strict';

  var S = window.Solver;
  var VAT_DEFAULT = '13';
  var WORD = { pcs: 'pcs', doz: 'doz', kg: 'kg' };
  var PER = { pcs: 'pc', doz: 'dozen', kg: 'kg' };
  var KEYS = { pcs: [-1, 1, 10], doz: [-0.5, 0.5, 1], kg: [] };
  var MIN = { pcs: 1, doz: 0.5, kg: 0 };
  var COUNT_LABEL = { pcs: 'Count (pcs)', doz: 'Count (dozens)', kg: 'Weight (kg)' };
  var FIX_LABEL = { pcs: 'Count', doz: 'Count', kg: 'Weight' };
  var FLAG_TEXT = {
    OK: 'margin inside 5–7% band',
    LOSS: 'LOSS: margin below 5%',
    OVER_TAX: 'OVER TAX: margin above 7%',
    NONE: 'no buy cost entered'
  };
  var MODE_TEXT = {
    incl: {
      label: 'Total paid, incl. VAT (NPR)',
      placeholder: 'e.g. 7500',
      hint: 'Type what the customer paid. Taxable base and VAT are worked out from it.',
      items: 'Type the count or the rate. The other box follows, and the total stays the same. One line absorbs the rest.',
      use: 'bill total'
    },
    excl: {
      label: 'Taxable amount, before VAT (NPR)',
      placeholder: 'blank = build from items',
      hint: 'Type the taxable amount, or leave it blank and build the bill from the items. VAT is added on top.',
      items: 'Type the count or the rate. The other box follows. One line absorbs the rest of the taxable amount.',
      itemsBuild: 'No taxable amount typed, so no line absorbs. Lines are priced as entered, then VAT is added on top.',
      use: 'taxable amount'
    }
  };

  var st = { lines: [], absorber: null, seq: 0, mode: 'incl', lastAbs: null, prev: null,
             calc: { expr: '', fresh: false, err: false } };
  var nf = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var nfCalc = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 4 });
  var toastTimer = null;

  function $(id) { return document.getElementById(id); }
  function fmt(n) { return nf.format(n); }
  function trimNum(n, d) { return String(Number(n.toFixed(d))); }
  function num(el) { var s = el.value.trim(); return s === '' ? NaN : Number(s); }
  function setIfIdle(el, v) { if (document.activeElement !== el) el.value = v; }
  function mk(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function fracLabel(n) {
    var w = Math.floor(n + 1e-9), half = n - w > 0.25;
    return (w ? String(w) : '') + (half ? '½' : '') || '0';
  }
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1800);
  }
  function setPressed(nodes, key, value) {
    for (var i = 0; i < nodes.length; i++) {
      var on = nodes[i].dataset[key] === value;
      nodes[i].classList.toggle('active', on);
      nodes[i].setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }

  // ---------- lines ----------

  function newLine() {
    st.seq += 1;
    return { id: 'L' + st.seq, name: '', unit: 'pcs', count: NaN, std: NaN, buy: NaN, rate: NaN, fixed: undefined };
  }
  function findLine(id) {
    for (var i = 0; i < st.lines.length; i++) if (st.lines[i].id === id) return st.lines[i];
    return null;
  }
  function cardFor(id) { return document.querySelector('#lines .line[data-id="' + id + '"]'); }

  function effectiveAbsorber() {
    if (st.absorber === 'none') return null;
    if (st.absorber && findLine(st.absorber)) return st.absorber;
    return S.defaultAbsorber(st.lines);
  }
  function isAbsorber(l) { return effectiveAbsorber() === l.id; }

  function addLine() {
    var l = newLine();
    st.lines.push(l);
    var card = $('lineTpl').content.firstElementChild.cloneNode(true);
    card.dataset.id = l.id;
    card.querySelector('.r-absorb').value = l.id;
    $('lines').appendChild(card);
  }

  function removeLine(l) {
    var card = cardFor(l.id);
    if (card) card.remove();
    st.lines = st.lines.filter(function (x) { return x.id !== l.id; });
    if (st.absorber === l.id) st.absorber = null;
    if (!st.lines.length) addLine();
  }

  function setUnit(l, u) {
    if (u === l.unit) return;
    var from = l.unit, kgSwitch = from === 'kg' || u === 'kg';
    var factor = (from === 'pcs' && u === 'doz') ? 12 : (from === 'doz' && u === 'pcs') ? 1 / 12 : 1;
    if (kgSwitch) {
      l.std = NaN;
      l.buy = NaN;
    } else {
      if (l.std > 0) l.std = S.roundTo(l.std * factor, 4);
      if (l.buy > 0) l.buy = S.roundTo(l.buy * factor, 4);
    }
    l.unit = u;
    l.count = NaN;
    l.rate = NaN;
    l.fixed = undefined;
    var card = cardFor(l.id);
    card.querySelector('.f-count').value = '';
    card.querySelector('.f-rate').value = '';
    card.querySelector('.f-std').value = isFinite(l.std) ? String(l.std) : '';
    card.querySelector('.f-buy').value = isFinite(l.buy) ? String(l.buy) : '';
  }

  // Stepper: starts from the count shown (typed or computed), then fixes it.
  function bump(l, countEl, d) {
    var step = l.unit === 'doz' ? 0.5 : 1;
    var cur = num(countEl);
    if (!(cur > 0)) cur = 0;
    var next = Math.max(MIN[l.unit], Math.round((cur + d) / step) * step);
    l.count = next;
    l.fixed = 'count';
    if (isAbsorber(l)) l.rate = NaN;
    countEl.value = String(next);
  }

  // ---------- rendering ----------

  function buildKeys(card, unit) {
    var box = card.querySelector('.count-keys');
    if (box.dataset.unit === unit) return;
    box.dataset.unit = unit;
    box.innerHTML = '';
    (KEYS[unit] || []).forEach(function (d) {
      var b = mk('button', 'step-btn', (d > 0 ? '+' : '−') + fracLabel(Math.abs(d)));
      b.type = 'button';
      b.dataset.d = String(d);
      box.appendChild(b);
    });
  }

  function fmtCount(n) { return trimNum(n, 3); }

  function renderCard(l, row, absId, res) {
    var card = cardFor(l.id);
    if (!card) return;
    var isAbs = l.id === absId, kg = l.unit === 'kg';
    var ok = !!row && !row.error;
    var rateFixed = isAbs && !!row && row.fixedBy === 'rate';
    var countFixed = isAbs && !!row && row.fixedBy === 'count';
    var fixNow = row && row.fixedBy ? row.fixedBy : S.fixedOf(l);

    setPressed(card.querySelectorAll('.b-unit'), 'unit', l.unit);
    card.querySelector('.r-absorb').checked = isAbs;
    card.querySelector('.l-count').textContent = COUNT_LABEL[l.unit];
    card.querySelector('.l-rate').textContent = 'Rate (NPR per ' + PER[l.unit] + ')';
    card.querySelector('.l-std').textContent = 'Max rate (NPR per ' + PER[l.unit] + ')';
    buildKeys(card, l.unit);

    card.querySelector('.fixed-row').hidden = !isAbs;
    card.querySelector('.b-fix[data-fix="count"]').textContent = FIX_LABEL[l.unit];
    setPressed(card.querySelectorAll('.b-fix'), 'fix', fixNow);

    // The box the user fixes keeps what was typed. The other box shows the computed value.
    var countEl = card.querySelector('.f-count'), rateEl = card.querySelector('.f-rate');
    if (ok && rateFixed) setIfIdle(countEl, fmtCount(row.qty));
    if (ok && countFixed) setIfIdle(rateEl, trimNum(row.rate, 2));
    rateEl.placeholder = isFinite(l.std) ? String(l.std) : '';

    card.querySelector('.b-usemax').hidden = !(l.rate > 0);

    // Count suggestions at the typed (or max) rate, with exact counts for this total.
    var cands = card.querySelector('.cands');
    cands.innerHTML = '';
    var showC = rateFixed && !kg && row.typedRate > 0 && isFinite(res.remP);
    cands.hidden = !showC;
    if (showC) {
      cands.appendChild(mk('p', 'hint', 'Counts that keep the total. Tap one to fix that count.'));
      S.countOptions(l.unit, res.remP, row.typedRate).forEach(function (c) {
        var b = mk('button', 'cand');
        b.type = 'button';
        b.dataset.count = String(c.count);
        b.appendChild(mk('strong', '', fmtCount(c.count) + ' ' + WORD[l.unit]));
        b.appendChild(mk('span', '', 'rate ' + fmt(c.rate) + (c.exact ? ' · exact' : '')));
        cands.appendChild(b);
      });
      var ex = S.exactCounts(l.unit, res.remP, row.qty);
      cands.appendChild(mk('p', 'hint', ex.length
        ? 'Exact for this total: ' + ex.map(function (e) { return fmtCount(e.count); }).join(', ') + ' ' + WORD[l.unit] + '.'
        : 'No whole count gives this total exactly. The variance shows.'));
    }

    var msg = card.querySelector('.line-msg');
    var text = '', tone = '';
    if (row && row.error) {
      text = row.error;
      tone = 'bad';
    } else if (row) {
      var parts = [];
      if (rateFixed) {
        var basis = l.rate > 0 ? 'Typed rate ' : 'Max rate ';
        if (kg) parts.push(basis + fmt(row.typedRate) + ' kept. Weight ' + fmtCount(row.qty) + ' kg solved.');
        else parts.push(basis + fmt(row.typedRate) + ' gives ' + fmtCount(row.qty) + ' ' + WORD[l.unit] +
          ' at NPR ' + fmt(row.rate) + '.');
      } else if (countFixed) {
        parts.push((kg ? 'Weight' : 'Count') + ' fixed. Rate absorbs.');
      }
      if (row.adjusted) parts.push('Rate moved 1 paisa to close the bill.');
      parts.push(FLAG_TEXT[row.flag] + (row.pct !== null ? ' (' + row.pct + '%)' : ''));
      if (row.flag === 'LOSS') tone = 'bad';
      else if (row.flag === 'OVER_TAX') tone = 'warn';
      if (row.aboveMax) {
        parts.push('Above max rate: more tax.');
        if (tone !== 'bad') tone = 'warn';
      }
      text = parts.join(' ');
    }
    msg.textContent = text;
    msg.className = 'line-msg ' + tone;
  }

  function addTot(label, value) {
    var d = mk('div');
    d.appendChild(mk('span', '', label));
    d.appendChild(mk('strong', '', value));
    $('totals').appendChild(d);
  }

  // Bill card: labels, mode buttons, ledger and formula, from the mode.
  function renderModeUI(res, G, V) {
    var m = MODE_TEXT[st.mode];
    setPressed($('modeBtns').querySelectorAll('.b-mode'), 'mode', st.mode);
    $('grossLabel').textContent = m.label;
    $('gross').placeholder = m.placeholder;
    $('modeHint').textContent = m.hint;
    $('useCalcBtn').textContent = 'Use as ' + m.use;

    var hasBase = isFinite(res.base);
    $('baseOut').textContent = hasBase ? fmt(res.base) : '—';
    $('vatOut').textContent = hasBase ? fmt(res.vat) : '—';
    $('totalOut').textContent = hasBase ? fmt(res.billTotal / 100) : '—';

    var f = '';
    if (st.mode === 'incl') {
      if (G > 0 && V >= 0) f = 'Taxable base = ' + fmt(G) + ' ÷ (1 + ' + V + '%). VAT = total − base.';
    } else if (hasBase) {
      f = res.hasTarget
        ? 'VAT = ' + fmt(res.base) + ' × ' + V + '%. Total = base + VAT.'
        : 'Built from items. VAT = ' + fmt(res.base) + ' × ' + V + '%. Total = base + VAT.';
    }
    $('formula').textContent = f;
  }

  function renderResult(res, G, V) {
    var excl = st.mode === 'excl';
    var hasBase = isFinite(res.base);

    var box = $('resRows');
    box.innerHTML = '';
    res.rows.forEach(function (r, i) {
      if (r.error) return;
      var row = mk('div', 'res-row');
      var left = mk('div');
      left.appendChild(mk('strong', '', r.name || ('Item ' + (i + 1))));
      var detail = fmtCount(r.qty) + ' ' + WORD[r.unit] + ' × NPR ' + fmt(r.rate);
      if (r.absorbs) detail += ' (absorbs)';
      if (r.adjusted) detail += ' (1 paisa)';
      left.appendChild(mk('small', '', detail));
      row.appendChild(left);
      row.appendChild(mk('strong', '', fmt(r.sub / 100)));
      box.appendChild(row);
    });

    var tot = $('totals');
    tot.innerHTML = '';
    if (hasBase) {
      var sign = res.variance > 0 ? '+' : (res.variance < 0 ? '−' : '');
      addTot('Taxable base', fmt(res.base));
      addTot('Lines total', fmt(res.total / 100));
      if (res.hasTarget) addTot('Variance', sign + fmt(Math.abs(res.variance) / 100));
      addTot('VAT ' + V + '%', fmt(res.vat));
      addTot('Lines + VAT', fmt((res.total + S.toPaisa(res.vat)) / 100));
      addTot(excl ? 'Total incl. VAT' : 'Bill total', fmt(res.billTotal / 100));
    }

    var status = $('status');
    var flagged = res.rows.filter(function (r) {
      return !r.error && (r.flag === 'LOSS' || r.flag === 'OVER_TAX' || r.aboveMax);
    }).length;
    var text, tone;
    if (!res.ok && excl === false && !(G > 0)) { text = 'Enter the bill total.'; tone = ''; }
    else if (!res.ok) { text = res.msg; tone = 'bad'; }
    else if (!res.hasTarget) {
      text = 'Built from items. Taxable NPR ' + fmt(res.base) + '. Total incl. VAT NPR ' + fmt(res.billTotal / 100) + '.';
      tone = 'ok';
    } else if (res.variance === 0) {
      text = excl
        ? 'Exact. Lines = taxable NPR ' + fmt(res.base) + '. Total incl. VAT NPR ' + fmt(res.billTotal / 100) + '.'
        : 'Exact. Lines + VAT = NPR ' + fmt(G) + '.';
      tone = 'ok';
    } else {
      text = 'Off by NPR ' + fmt(Math.abs(res.variance) / 100) + '.';
      tone = 'warn';
    }
    if (res.ok && flagged) {
      text += ' ' + flagged + ' line(s) outside band or above max rate.';
      if (tone === 'ok') tone = 'warn';
    }
    status.textContent = text;
    status.className = 'status ' + tone;

    var out = [];
    if (hasBase && res.ok) {
      res.rows.forEach(function (r, i) {
        if (r.error) return;
        out.push((r.name || ('Item ' + (i + 1))) + ': ' + fmtCount(r.qty) + ' ' + WORD[r.unit] +
          ' × NPR ' + fmt(r.rate) + ' = NPR ' + fmt(r.sub / 100));
      });
      out.push('Taxable total NPR ' + fmt(res.total / 100));
      out.push('VAT ' + V + '% NPR ' + fmt(res.vat));
      out.push((excl ? 'Bill total incl. VAT NPR ' : 'Bill total NPR ') + fmt(res.billTotal / 100));
    }
    $('billing').value = out.join('\n');
    $('absNone').checked = st.absorber === 'none';
  }

  // The old absorber stops absorbing (radio changed, a new default, or the taxable amount was
  // cleared). Its computed box becomes typed, so the screen and the pricing agree.
  function commitShown(G, V, id, mode) {
    var l = findLine(id);
    if (!l) return;
    var r = S.solveBill(G, V, st.lines, id, mode);
    var row = null;
    r.rows.forEach(function (x) { if (x.id === id) row = x; });
    if (!row || row.error) return;
    if (row.fixedBy === 'rate') l.count = row.qty;
    else if (row.fixedBy === 'count') l.rate = row.rate;
  }

  function render() {
    var G = num($('gross')), V = num($('vat'));
    var mode = st.mode;
    var needAbs = !(mode === 'excl' && !(G > 0));
    var absId = needAbs ? effectiveAbsorber() : null;
    if (st.lastAbs && st.lastAbs !== absId && st.prev) commitShown(st.prev.G, st.prev.V, st.lastAbs, st.prev.mode);
    st.lastAbs = absId;
    st.prev = { G: G, V: V, mode: mode };

    $('absBox').hidden = !needAbs;
    $('itemsHint').textContent = needAbs ? MODE_TEXT[mode].items : MODE_TEXT[mode].itemsBuild;

    var res = S.solveBill(G, V, st.lines, absId, mode);
    st.lines.forEach(function (l, i) { renderCard(l, res.rows[i], absId, res); });
    renderModeUI(res, G, V);
    renderResult(res, G, V);
  }

  // ---------- side calculator ----------

  function prettyExpr(e) { return e.replace(/\*/g, '×').replace(/\//g, '÷'); }
  function vatPct() { var v = num($('vat')); return v >= 0 ? v : 0; }

  function renderCalc() {
    var c = st.calc;
    var now = $('calcNow'), prev = $('calcPrev');
    if (c.err) { now.textContent = 'Error'; prev.textContent = ''; return; }
    now.textContent = c.expr === '' ? '0' : prettyExpr(c.expr);
    var v = (c.expr === '' || c.fresh) ? NaN : S.evalExpr(c.expr);
    prev.textContent = isNaN(v) ? '' : '= ' + nfCalc.format(v);
  }

  function calcKey(k) {
    var c = st.calc;
    if (k === 'C') { c.expr = ''; c.fresh = false; c.err = false; }
    else if (k === 'DEL') {
      c.expr = c.fresh ? '' : c.expr.slice(0, -1);
      c.fresh = false;
      c.err = false;
    } else if (k === '=') {
      var v = S.evalExpr(c.expr);
      c.err = isNaN(v);
      c.expr = c.err ? '' : String(S.roundTo(v, 8));
      c.fresh = true;
    } else if (k === 'ADDVAT' || k === 'REMVAT') {
      if (c.expr === '') { toast('Enter a value first.'); return; }
      var base = S.evalExpr(c.expr);
      c.err = isNaN(base);
      if (!c.err) {
        var p = vatPct();
        var nv = k === 'ADDVAT' ? base * (1 + p / 100) : base / (1 + p / 100);
        c.expr = String(S.roundTo(nv, 8));
        c.fresh = true;
      }
    } else if (k === 'USE') {
      var u = c.expr === '' ? NaN : S.evalExpr(c.expr);
      if (!(u > 0)) { toast('Enter a value first.'); return; }
      $('gross').value = String(S.roundTo(u, 2));
      toast('Set as ' + MODE_TEXT[st.mode].use + '.');
      render();
      return;
    } else {
      c.err = false;
      if (c.fresh && /[0-9.(]/.test(k)) c.expr = '';
      c.fresh = false;
      c.expr += k;
    }
    renderCalc();
  }

  function toggleCalc(force) {
    var panel = $('calcPanel');
    var open = typeof force === 'boolean' ? force : panel.hidden;
    panel.hidden = !open;
    $('calcBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) renderCalc();
  }

  // ---------- events ----------

  // Typing one box on the absorber clears the other, so only the fixed box is used.
  // Other lines keep both values as typed.
  function onInput(e) {
    var t = e.target;
    var card = t.closest ? t.closest('.line') : null;
    var l = card ? findLine(card.dataset.id) : null;
    if (l) {
      var abs = isAbsorber(l);
      if (t.classList.contains('f-name')) l.name = t.value.trim();
      else if (t.classList.contains('f-count')) {
        l.count = num(t);
        l.fixed = 'count';
        if (abs) l.rate = NaN;
      } else if (t.classList.contains('f-std')) l.std = num(t);
      else if (t.classList.contains('f-buy')) l.buy = num(t);
      else if (t.classList.contains('f-rate')) {
        l.rate = num(t);
        l.fixed = 'rate';
        if (abs) l.count = NaN;
      }
    }
    render();
  }

  function onChange(e) {
    if (e.target.name === 'absorber') {
      st.absorber = e.target.value;
      render();
    }
  }

  function onFocusIn(e) {
    var t = e.target;
    if (t.tagName === 'INPUT' && t.type === 'number' && t.select) t.select();
  }

  function onClick(e) {
    var t = e.target.closest('button');
    if (!t) return;
    if (t.id === 'addLine') { addLine(); render(); return; }
    if (t.id === 'resetBtn') { resetAll(); return; }
    if (t.id === 'copyBtn') { copyText(); return; }
    if (t.id === 'calcBtn') { toggleCalc(); return; }
    if (t.id === 'calcClose') { toggleCalc(false); return; }
    if (t.dataset.calc !== undefined) { calcKey(t.dataset.calc); return; }
    if (t.classList.contains('b-mode')) { st.mode = t.dataset.mode; render(); return; }

    var card = t.closest('.line');
    var l = card ? findLine(card.dataset.id) : null;
    if (!l) return;
    var countEl = card.querySelector('.f-count'), rateEl = card.querySelector('.f-rate');

    if (t.classList.contains('b-unit')) setUnit(l, t.dataset.unit);
    else if (t.classList.contains('step-btn')) bump(l, countEl, Number(t.dataset.d));
    else if (t.classList.contains('b-fix')) {
      // Keep the value shown in the box being fixed. The other box is recomputed.
      if (t.dataset.fix === 'rate') { l.rate = num(rateEl); l.count = NaN; }
      else { l.count = num(countEl); l.rate = NaN; }
      l.fixed = t.dataset.fix;
    } else if (t.classList.contains('cand')) {
      l.count = Number(t.dataset.count);
      l.fixed = 'count';
      l.rate = NaN;
      countEl.value = String(l.count);
    } else if (t.classList.contains('b-usemax')) {
      l.rate = NaN;
      l.fixed = 'rate';
      rateEl.value = '';
    } else if (t.classList.contains('b-remove')) removeLine(l);
    else return;
    render();
  }

  function resetAll() {
    $('lines').innerHTML = '';
    st.lines = [];
    st.absorber = null;
    st.lastAbs = null;
    st.prev = null;
    addLine();
    $('gross').value = '';
    $('vat').value = VAT_DEFAULT;
    render();
    $('gross').focus();
    toast('Cleared. Ready for the next bill.');
  }

  function copyText() {
    var ta = $('billing'), text = ta.value;
    if (!text) { toast('Enter the bill first.'); return; }
    function fallback() {
      ta.removeAttribute('readonly');
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      ta.setAttribute('readonly', '');
      toast(ok ? 'Copied.' : 'Select the text and copy it.');
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { toast('Copied.'); }, fallback);
    } else {
      fallback();
    }
  }

  function init() {
    addLine();
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    document.addEventListener('click', onClick);
    document.addEventListener('focusin', onFocusIn);
    render();
    renderCalc();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
