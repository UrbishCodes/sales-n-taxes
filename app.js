/* Counter sales: one bill, many items, VAT included or excluded, item list from the stock summary,
 * plus a side calculator. Uses window.Solver (solver.js) and window.Catalog (items.js). Works offline. */
(function () {
  'use strict';

  var S = window.Solver;
  var ITEMS = (window.Catalog && window.Catalog.ITEMS) || [];
  var VAT_DEFAULT = '13';
  var WORD = { pcs: 'pcs', doz: 'doz', kg: 'kg' };
  var PER = { pcs: 'pc', doz: 'dozen', kg: 'kg' };
  var KEYS = { pcs: [-1, 1, 10], doz: [-0.5, 0.5, 1], kg: [] };
  var MIN = { pcs: 1, doz: 0.5, kg: 0 };
  var COUNT_LABEL = { pcs: 'Count (pcs)', doz: 'Count (dozens)', kg: 'Weight (kg)' };
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
      use: 'bill total'
    },
    excl: {
      label: 'Taxable amount, before VAT (NPR)',
      placeholder: 'blank = build from items',
      hint: 'Type the taxable amount, or leave it blank and build the bill from the items. VAT is added on top.',
      use: 'taxable amount'
    }
  };

  var st = { lines: [], seq: 0, mode: 'incl', sug: { line: null, items: [], idx: 0 },
             calc: { expr: '', fresh: false, err: false } };
  var nf = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var nfCalc = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 4 });
  var toastTimer = null;

  function $(id) { return document.getElementById(id); }
  function fmt(n) { return nf.format(n); }
  function trimNum(n, d) { return String(Number(n.toFixed(d))); }
  function fmtCount(n) { return trimNum(n, 3); }
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
    // rate NaN = not typed, so the line uses its max sell rate (std).
    return { id: 'L' + st.seq, name: '', item: null, unit: 'pcs', count: NaN, std: NaN, buy: NaN, rate: NaN };
  }
  function findLine(id) {
    for (var i = 0; i < st.lines.length; i++) if (st.lines[i].id === id) return st.lines[i];
    return null;
  }
  function cardFor(id) { return document.querySelector('#lines .line[data-id="' + id + '"]'); }
  function lineOf(el) {
    var card = el.closest ? el.closest('.line') : null;
    return card ? findLine(card.dataset.id) : null;
  }

  function addLine() {
    var l = newLine();
    st.lines.push(l);
    var card = $('lineTpl').content.firstElementChild.cloneNode(true);
    card.dataset.id = l.id;
    $('lines').appendChild(card);
  }

  function removeLine(l) {
    var card = cardFor(l.id);
    if (card) card.remove();
    st.lines = st.lines.filter(function (x) { return x.id !== l.id; });
    if (st.sug.line === l.id) st.sug = { line: null, items: [], idx: 0 };
    if (!st.lines.length) addLine();
  }

  // Fill the line from a stock-summary item. Rate goes back to max.
  function applyItem(l, item) {
    if (l.unit !== item.unit) l.count = NaN;
    l.name = item.name;
    l.item = item;
    l.unit = item.unit;
    l.std = item.rate;
    l.buy = item.buy == null ? NaN : item.buy;
    l.rate = NaN;
  }

  function showList(l, text) {
    var items = S.matchItems(ITEMS, text, 12);
    st.sug = { line: items.length ? l.id : null, items: items, idx: 0 };
  }

  function pickAt(i) {
    var l = findLine(st.sug.line);
    var item = st.sug.items[i];
    if (!l || !item) return;
    applyItem(l, item);
    st.sug = { line: null, items: [], idx: 0 };
    var card = cardFor(l.id);
    card.querySelector('.f-name').value = item.name;
    render();
    card.querySelector('.f-count').focus();
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
    l.item = null;
  }

  function bump(l, d) {
    var step = l.unit === 'doz' ? 0.5 : 1;
    var cur = l.count > 0 ? l.count : 0;
    l.count = Math.max(MIN[l.unit], Math.round((cur + d) / step) * step);
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

  function renderCard(l, row) {
    var card = cardFor(l.id);
    if (!card) return;
    var kg = l.unit === 'kg';

    setPressed(card.querySelectorAll('.b-unit'), 'unit', l.unit);
    card.querySelector('.l-count').textContent = COUNT_LABEL[l.unit];
    card.querySelector('.l-rate').textContent = 'Rate (NPR per ' + PER[l.unit] + ')';
    card.querySelector('.l-std').textContent = 'Max rate (NPR per ' + PER[l.unit] + ')';
    buildKeys(card, l.unit);
    card.querySelector('.count-keys').hidden = kg;

    // Boxes show the typed value. The rate box shows the max rate until a rate is typed.
    var countEl = card.querySelector('.f-count'), rateEl = card.querySelector('.f-rate');
    setIfIdle(countEl, isFinite(l.count) ? fmtCount(l.count) : '');
    setIfIdle(rateEl, l.rate > 0 ? trimNum(l.rate, 4) : (isFinite(l.std) ? trimNum(l.std, 4) : ''));
    setIfIdle(card.querySelector('.f-std'), isFinite(l.std) ? trimNum(l.std, 4) : '');
    setIfIdle(card.querySelector('.f-buy'), isFinite(l.buy) ? trimNum(l.buy, 4) : '');
    card.querySelector('.b-usemax').hidden = !(l.rate > 0);

    var stock = card.querySelector('.stock');
    stock.hidden = !l.item;
    if (l.item) stock.textContent = 'Summary stock: ' + trimNum(l.item.stock, 3) + ' ' + WORD[l.item.unit] +
      ' (for reference, not deducted)';

    var msg = card.querySelector('.line-msg');
    var text = '', tone = '';
    if (row && row.error) {
      text = row.error;
      tone = 'bad';
    } else if (row) {
      var parts = [(l.rate > 0 ? 'Typed rate' : 'Max rate') + ' NPR ' + fmt(row.rate) + '.'];
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

  // Item list under the name box. Shown only while that line's name has matches.
  function renderSuggest() {
    st.lines.forEach(function (l) {
      var card = cardFor(l.id);
      if (!card) return;
      var box = card.querySelector('.suggest');
      var open = st.sug.line === l.id && st.sug.items.length > 0;
      var input = card.querySelector('.f-name');
      input.setAttribute('aria-expanded', open ? 'true' : 'false');
      box.hidden = !open;
      box.innerHTML = '';
      if (!open) return;
      st.sug.items.forEach(function (it, i) {
        var b = mk('button', 'sug' + (i === st.sug.idx ? ' on' : ''));
        b.type = 'button';
        b.dataset.i = String(i);
        b.appendChild(mk('strong', '', it.name));
        b.appendChild(mk('span', '', 'max NPR ' + fmt(it.rate) + ' per ' + PER[it.unit] +
          (it.buy != null ? ' · buy ' + trimNum(it.buy, 4) : '') + ' · stock ' + trimNum(it.stock, 3) + ' ' + WORD[it.unit]));
        box.appendChild(b);
      });
    });
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
      if (r.aboveMax) detail += ' (above max)';
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

    var flagged = res.rows.filter(function (r) {
      return !r.error && (r.flag === 'LOSS' || r.flag === 'OVER_TAX' || r.aboveMax);
    }).length;
    var text, tone;
    if (!excl && !(G > 0)) { text = 'Enter the bill total.'; tone = ''; }
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
    var status = $('status');
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
  }

  function render() {
    var G = num($('gross')), V = num($('vat'));
    var res = S.solveBill(G, V, st.lines, st.mode);
    res.rows.forEach(function (row, i) { renderCard(st.lines[i], row); });
    renderSuggest();
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

  function onInput(e) {
    var t = e.target;
    var l = lineOf(t);
    if (l) {
      if (t.classList.contains('f-name')) {
        l.name = t.value.trim();
        var exact = S.findItem(ITEMS, t.value);
        if (exact) {
          if (!l.item || l.item.name !== exact.name) applyItem(l, exact);
          st.sug = { line: null, items: [], idx: 0 };
        } else {
          l.item = null;
          showList(l, t.value);
        }
      }
      else if (t.classList.contains('f-count')) l.count = num(t);
      else if (t.classList.contains('f-std')) l.std = num(t);
      else if (t.classList.contains('f-buy')) l.buy = num(t);
      else if (t.classList.contains('f-rate')) l.rate = num(t);
    }
    render();
  }

  // Keep the list open while the name box is tapped; a tap on an item must not blur the box first.
  function onMouseDown(e) {
    if (e.target.closest && e.target.closest('.suggest')) e.preventDefault();
  }

  function onKeyDown(e) {
    var t = e.target;
    if (!t.classList || !t.classList.contains('f-name')) return;
    var l = lineOf(t);
    var n = st.sug.items.length;
    if (!l || st.sug.line !== l.id || !n) return;
    if (e.key === 'ArrowDown') { st.sug.idx = (st.sug.idx + 1) % n; e.preventDefault(); renderSuggest(); }
    else if (e.key === 'ArrowUp') { st.sug.idx = (st.sug.idx - 1 + n) % n; e.preventDefault(); renderSuggest(); }
    else if (e.key === 'Enter') { e.preventDefault(); pickAt(st.sug.idx); }
    else if (e.key === 'Escape') { st.sug.line = null; renderSuggest(); }
  }

  function onFocusIn(e) {
    var t = e.target;
    if (t.tagName === 'INPUT' && t.type === 'number' && t.select) t.select();
    if (t.classList && t.classList.contains('f-name')) {
      var l = lineOf(t);
      if (l) {
        if (S.findItem(ITEMS, t.value)) st.sug = { line: null, items: [], idx: 0 };
        else showList(l, t.value);
        renderSuggest();
      }
    }
  }

  function onFocusOut(e) {
    var t = e.target;
    if (!t.classList || !t.classList.contains('f-name')) return;
    var l = lineOf(t);
    var id = l ? l.id : null;
    setTimeout(function () {
      if (st.sug.line === id) { st.sug = { line: null, items: [], idx: 0 }; renderSuggest(); }
    }, 200);
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
    if (t.classList.contains('sug')) { pickAt(Number(t.dataset.i)); return; }

    var l = lineOf(t);
    if (!l) return;
    if (t.classList.contains('b-unit')) setUnit(l, t.dataset.unit);
    else if (t.classList.contains('step-btn')) bump(l, Number(t.dataset.d));
    else if (t.classList.contains('b-usemax')) l.rate = NaN;
    else if (t.classList.contains('b-remove')) removeLine(l);
    else return;
    render();
  }

  function resetAll() {
    $('lines').innerHTML = '';
    st.lines = [];
    st.sug = { line: null, items: [], idx: 0 };
    st.mode = 'incl';
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
    document.addEventListener('click', onClick);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    render();
    renderCalc();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
