/* Counter sales: one bill, many items. Uses window.Solver (solver.js). Works offline. */
(function () {
  'use strict';

  var S = window.Solver;
  var VAT_DEFAULT = '13';
  var WORD = { pcs: 'pcs', doz: 'doz', kg: 'kg' };
  var PER = { pcs: 'pc', doz: 'dozen', kg: 'kg' };
  var KEYS = { pcs: [-1, 1, 10], doz: [-0.5, 0.5, 1], kg: [] };
  var MIN = { pcs: 1, doz: 0.5, kg: 0 };
  var COUNT_LABEL = { pcs: 'Pieces sold', doz: 'Dozens sold', kg: 'Weight sold (kg)' };
  var FLAG_TEXT = {
    OK: 'margin inside 5–7% band',
    LOSS: 'LOSS: margin below 5%',
    OVER_TAX: 'OVER TAX: margin above 7%',
    NONE: 'no buy cost entered'
  };

  var st = { lines: [], absorber: null, seq: 0 };
  var nf = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

  // ---------- lines ----------

  function newLine() {
    st.seq += 1;
    return { id: 'L' + st.seq, name: '', unit: 'pcs', count: NaN, std: NaN, buy: NaN, rate: NaN, kgMode: 'qty' };
  }
  function findLine(id) {
    for (var i = 0; i < st.lines.length; i++) if (st.lines[i].id === id) return st.lines[i];
    return null;
  }
  function cardFor(id) { return document.querySelector('#lines .line[data-id="' + id + '"]'); }

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
    l.kgMode = 'qty';
    var card = cardFor(l.id);
    card.querySelector('.f-count').value = '';
    card.querySelector('.f-rate').value = '';
    card.querySelector('.f-std').value = isFinite(l.std) ? String(l.std) : '';
    card.querySelector('.f-buy').value = isFinite(l.buy) ? String(l.buy) : '';
  }

  function bump(l, d) {
    var step = l.unit === 'doz' ? 0.5 : 1;
    var cur = l.count > 0 ? l.count : 0;
    var next = Math.max(MIN[l.unit], Math.round((cur + d) / step) * step);
    l.count = next;
    cardFor(l.id).querySelector('.f-count').value = String(next);
  }

  function effectiveAbsorber() {
    if (st.absorber === 'none') return null;
    if (st.absorber && findLine(st.absorber)) return st.absorber;
    return S.defaultAbsorber(st.lines);
  }

  // ---------- rendering ----------

  function setPressed(nodes, key, value) {
    for (var i = 0; i < nodes.length; i++) {
      var on = nodes[i].dataset[key] === value;
      nodes[i].classList.toggle('active', on);
      nodes[i].setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }

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

  function renderCard(l, row, absId) {
    var card = cardFor(l.id);
    if (!card) return;
    var isAbs = l.id === absId, kg = l.unit === 'kg';
    var computedQty = isAbs && kg && l.kgMode !== 'rate';
    var ok = !!row && !row.error;

    setPressed(card.querySelectorAll('.b-unit'), 'unit', l.unit);
    card.querySelector('.l-count').textContent = COUNT_LABEL[l.unit];
    card.querySelector('.l-std').textContent = 'Max rate (NPR per ' + PER[l.unit] + ')';
    card.querySelector('.l-rate').textContent = isAbs
      ? 'Rate (worked out)' : 'Rate used (NPR per ' + PER[l.unit] + ')';
    buildKeys(card, l.unit);

    var count = card.querySelector('.f-count');
    count.readOnly = computedQty;
    if (computedQty) setIfIdle(count, ok ? trimNum(row.qty, 4) : '');

    var rate = card.querySelector('.f-rate');
    rate.readOnly = isAbs;
    if (ok && row.rate > 0) setIfIdle(rate, trimNum(row.rate, 2));
    card.querySelector('.b-usemax').hidden = isAbs || !(l.rate > 0);
    card.querySelector('.kg-mode').hidden = !(isAbs && kg);
    setPressed(card.querySelectorAll('.b-kgmode'), 'mode', l.kgMode);
    card.querySelector('.r-absorb').checked = isAbs;

    var text = '', tone = '';
    if (row && row.error) {
      text = row.error;
      tone = 'bad';
    } else if (row) {
      var parts = [];
      if (isAbs) parts.push('Absorbs the rest of the bill.');
      if (row.adjusted) parts.push('Rate moved 1 paisa to close the bill exactly.');
      parts.push(FLAG_TEXT[row.flag] + (row.pct !== null ? ' (' + row.pct + '%)' : ''));
      if (row.flag === 'LOSS') tone = 'bad';
      else if (row.flag === 'OVER_TAX') tone = 'warn';
      if (row.aboveMax) {
        parts.push('Above max rate: more tax.');
        if (tone !== 'bad') tone = 'warn';
      }
      text = parts.join(' ');
    }
    var msg = card.querySelector('.line-msg');
    msg.textContent = text;
    msg.className = 'line-msg ' + tone;
  }

  function addTot(label, value) {
    var d = mk('div');
    d.appendChild(mk('span', '', label));
    d.appendChild(mk('strong', '', value));
    $('totals').appendChild(d);
  }

  function renderResult(res, G, V) {
    var haveBill = G > 0 && V >= 0;
    $('baseOut').textContent = haveBill ? fmt(res.base) : '—';
    $('vatOut').textContent = haveBill ? fmt(res.vat) : '—';
    $('formula').textContent = haveBill ? 'Taxable base = ' + fmt(G) + ' ÷ (1 + ' + V + '%)' : '';

    var box = $('resRows');
    box.innerHTML = '';
    res.rows.forEach(function (r, i) {
      if (r.error) return;
      var row = mk('div', 'res-row');
      var left = mk('div');
      left.appendChild(mk('strong', '', r.name || ('Item ' + (i + 1))));
      var detail = trimNum(r.qty, 4) + ' ' + WORD[r.unit] + ' × NPR ' + fmt(r.rate);
      if (r.absorbs) detail += ' (absorbs)';
      if (r.adjusted) detail += ' (1 paisa)';
      left.appendChild(mk('small', '', detail));
      row.appendChild(left);
      row.appendChild(mk('strong', '', fmt(r.sub / 100)));
      box.appendChild(row);
    });

    var tot = $('totals');
    tot.innerHTML = '';
    if (haveBill && res.ok) {
      var sign = res.variance > 0 ? '+' : (res.variance < 0 ? '−' : '');
      addTot('Taxable base (G ÷ (1 + V%))', fmt(res.base));
      addTot('Lines total', fmt(res.total / 100));
      addTot('Variance', sign + fmt(Math.abs(res.variance) / 100));
      addTot('VAT ' + V + '%', fmt(res.vat));
      addTot('Bill total (lines + VAT)', fmt((res.total + S.toPaisa(res.vat)) / 100));
      addTot('Bill total entered', fmt(G));
    }

    var status = $('status');
    var flagged = res.rows.filter(function (r) {
      return !r.error && (r.flag === 'LOSS' || r.flag === 'OVER_TAX' || r.aboveMax);
    }).length;
    var text, tone;
    if (!haveBill) { text = 'Enter the bill total.'; tone = ''; }
    else if (!res.ok) { text = res.msg; tone = 'bad'; }
    else if (res.variance === 0) { text = 'Exact. Lines + VAT = NPR ' + fmt(G) + '.'; tone = 'ok'; }
    else {
      text = 'Off by NPR ' + fmt(Math.abs(res.variance) / 100) +
        '. Add a 1-piece line or a kg line to absorb it.';
      tone = 'warn';
    }
    if (haveBill && res.ok && flagged) {
      text += ' ' + flagged + ' line(s) outside band or above max rate.';
      if (tone === 'ok') tone = 'warn';
    }
    status.textContent = text;
    status.className = 'status ' + tone;

    var out = [];
    if (haveBill && res.ok) {
      res.rows.forEach(function (r, i) {
        if (r.error) return;
        out.push((r.name || ('Item ' + (i + 1))) + ': ' + trimNum(r.qty, 4) + ' ' + WORD[r.unit] +
          ' × NPR ' + fmt(r.rate) + ' = NPR ' + fmt(r.sub / 100));
      });
      out.push('Taxable total NPR ' + fmt(res.total / 100));
      out.push('VAT ' + V + '% NPR ' + fmt(res.vat));
      out.push('Bill total NPR ' + fmt(G));
    }
    $('billing').value = out.join('\n');
    $('absNone').checked = st.absorber === 'none';
  }

  function render() {
    var G = num($('gross')), V = num($('vat'));
    var absId = effectiveAbsorber();
    var res = S.solveBill(G, V, st.lines, absId);
    st.lines.forEach(function (l, i) { renderCard(l, res.rows[i], absId); });
    renderResult(res, G, V);
  }

  // ---------- events ----------

  function onInput(e) {
    var t = e.target;
    var card = t.closest ? t.closest('.line') : null;
    var l = card ? findLine(card.dataset.id) : null;
    if (l) {
      if (t.classList.contains('f-name')) l.name = t.value.trim();
      else if (t.classList.contains('f-count')) l.count = num(t);
      else if (t.classList.contains('f-std')) l.std = num(t);
      else if (t.classList.contains('f-buy')) l.buy = num(t);
      else if (t.classList.contains('f-rate')) l.rate = num(t);
    }
    render();
  }

  function onChange(e) {
    if (e.target.name === 'absorber') {
      st.absorber = e.target.value;
      render();
    }
  }

  function onClick(e) {
    var t = e.target.closest('button');
    if (!t) return;
    if (t.id === 'addLine') { addLine(); render(); return; }
    if (t.id === 'resetBtn') { resetAll(); return; }
    if (t.id === 'copyBtn') { copyText(); return; }

    var card = t.closest('.line');
    var l = card ? findLine(card.dataset.id) : null;
    if (!l) return;
    if (t.classList.contains('b-unit')) setUnit(l, t.dataset.unit);
    else if (t.classList.contains('step-btn')) bump(l, Number(t.dataset.d));
    else if (t.classList.contains('b-kgmode')) l.kgMode = t.dataset.mode;
    else if (t.classList.contains('b-usemax')) {
      l.rate = NaN;
      card.querySelector('.f-rate').value = '';
    } else if (t.classList.contains('b-remove')) { removeLine(l); }
    else return;
    render();
  }

  function resetAll() {
    $('lines').innerHTML = '';
    st.lines = [];
    st.absorber = null;
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
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
