/* FanumTaxxed — counter sales UI: one bill, many items, linked amounts, restored absorber.
 * Uses window.Solver (solver.js) and window.Catalog (items.js). Works offline.
 *
 * THE FIX the live build lost: the box the user is typing in is NEVER overwritten, and a
 * typed count or rate is never wiped when the other box is touched. Each line remembers
 * both typed values plus the last-edited one (the anchor). The anchor box shows exactly
 * what the user typed; only the other box shows the reconciled value.
 */
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
  var FIX_LABEL = { pcs: 'Count', doz: 'Count', kg: 'Weight' };
  var FLAG_TEXT = {
    OK: 'margin inside 5–8.5% band',
    LOSS: 'LOSS: margin below 5%',
    OVER_TAX: 'OVER TAX: margin above 8.5%',
    NONE: 'no buy cost entered'
  };
  var MODE_TEXT = {
    rev: {
      title: 'REV',
      hint: 'Type what the customer paid (or type the base — the boxes are linked either way). Taxable base and VAT are worked out from it.',
      use: 'bill total'
    },
    nonrev: {
      title: 'NON-REV',
      hint: 'Type the taxable amount, or leave it blank and build the bill from the items. VAT is added on top. The two boxes are linked — typing one fills the other.',
      use: 'taxable amount'
    }
  };

  var st = {
    lines: [], seq: 0,
    mode: 'nonrev',          // default NON-REV (VAT excluded) — switching never reinterprets the number
    typed: null,             // 'gross' | 'base' — which linked box the user typed last
    absorber: null,          // line id | 'none' | null (auto)
    absOn: true,             // auto-adjust ON by default (the engine the live build deleted)
    lastAbs: null, prev: null,
    sug: { line: null, items: [], idx: 0 }
  };
  var nf = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var toastTimer = null;

  function $(id) { return document.getElementById(id); }
  function fmt(n) { return nf.format(n); }
  function trimNum(n, d) { return String(Number(n.toFixed(d))); }
  function fmtCount(n) { return trimNum(n, 4); }
  function fmtRate(r, dp) { return trimNum(r, Math.max(dp || 2, 2)); }
  function num(el) { var s = el.value.trim(); return s === '' ? NaN : Number(s); }
  // The one rule that fixes the revert bug: never write into the box that has focus.
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
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2000);
  }
  function setPressed(nodes, key, value) {
    for (var i = 0; i < nodes.length; i++) {
      var on = nodes[i].dataset[key] === value;
      nodes[i].classList.toggle('active', on);
      nodes[i].setAttribute('aria-checked', on ? 'true' : 'false');
      if (nodes[i].getAttribute('aria-pressed') !== null) {
        nodes[i].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
  }

  // ---------- lines ----------

  function newLine() {
    st.seq += 1;
    // count / rate are USER-TYPED values (NaN = untouched); lastField is the anchor.
    return { id: 'L' + st.seq, name: '', item: null, unit: 'pcs',
             count: NaN, rate: NaN, std: NaN, buy: NaN, lastField: null };
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
    return l;
  }

  function removeLine(l) {
    var card = cardFor(l.id);
    if (card) card.remove();
    st.lines = st.lines.filter(function (x) { return x.id !== l.id; });
    if (st.sug.line === l.id) st.sug = { line: null, items: [], idx: 0 };
    if (st.absorber === l.id) st.absorber = null;
    if (!st.lines.length) addLine();
  }

  // Fill the line from a stock-summary item. The item link survives every later unit switch.
  function applyItem(l, item) {
    if (l.unit !== item.unit) l.count = NaN;
    l.name = item.name;
    l.item = item;
    l.unit = item.unit;
    l.std = item.rate;
    l.buy = item.buy == null ? NaN : item.buy;
    l.rate = NaN;                      // rate basis goes back to the max sell rate
    if (!(l.count > 0)) l.lastField = null;
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

  // Unit switch keeps the item (name, stock hint) and restores max/buy on the round trip.
  function setUnit(l, u) {
    if (u === l.unit) return;
    var from = l.unit;
    if (from === 'kg' || u === 'kg') {
      // Per-kg rates are a different number: blank them, but keep the item for the hint
      // and so the rates can be restored when switching back.
      l.std = NaN;
      l.buy = NaN;
      if (from === 'kg' && l.item && (l.item.unit === 'pcs' || l.item.unit === 'doz')) {
        var m = S.switchUnitMeta(l.item.rate, l.item.buy == null ? NaN : l.item.buy, l.item.unit, u);
        l.std = m.std;
        l.buy = m.buy;
      }
    } else {
      var meta = S.switchUnitMeta(l.std, l.buy, from, u);   // pcs <-> doz converts by 12
      l.std = meta.std;
      l.buy = meta.buy;
    }
    l.unit = u;
    l.count = NaN;      // counts do not convert across units
    l.rate = NaN;
    l.lastField = null;
    var card = cardFor(l.id);
    if (card) {
      card.querySelector('.f-count').value = '';
      card.querySelector('.f-rate').value = '';
    }
  }

  function bump(l, d) {
    var step = l.unit === 'doz' ? 0.5 : 1;
    var cur = l.count > 0 ? l.count : 0;
    l.count = Math.max(MIN[l.unit], Math.round((cur + d) / step) * step);
    l.lastField = 'count';           // the stepper fixes the count; the rate follows
    var card = cardFor(l.id);
    if (card) card.querySelector('.f-count').value = String(l.count);
  }

  // ---------- linked amounts (SALES CALC block) ----------

  function vatVal() { var v = num($('vat')); return v >= 0 ? v : 0; }

  // The (G, X) pair from whichever linked box the user typed. Never reinterprets silently.
  function amounts() {
    var V = vatVal();
    var G = num($('gross')), X = num($('base'));
    if (st.typed === 'gross' && G > 0) {
      var a = S.amountsFromGross(G, V);
      setIfIdle($('base'), trimNum(a.base, 2));
      return a;
    }
    if (st.typed === 'base' && X > 0) {
      var b = S.amountsFromBase(X, V);
      setIfIdle($('gross'), trimNum(b.total, 2));
      return b;
    }
    // Nothing typed: both boxes clear; the bill is built from the items (if any).
    setIfIdle($('base'), '');
    setIfIdle($('gross'), '');
    return null;
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

  function renderCard(l, row, absId, res) {
    var card = cardFor(l.id);
    if (!card) return;
    var isAbs = l.id === absId && !!row && !row.error;
    var kg = l.unit === 'kg';

    setPressed(card.querySelectorAll('.b-unit'), 'unit', l.unit);
    var absBtn = card.querySelector('.b-absorb');
    absBtn.setAttribute('aria-pressed', isAbs ? 'true' : 'false');
    absBtn.classList.toggle('on', isAbs);
    card.querySelector('.l-count').textContent = COUNT_LABEL[l.unit];
    card.querySelector('.l-rate').textContent = 'Rate (NPR per ' + PER[l.unit] + ')';
    card.querySelector('.l-std').textContent = 'Max rate (NPR per ' + PER[l.unit] + ')';
    buildKeys(card, l.unit);
    card.querySelector('.count-keys').hidden = kg;

    var countEl = card.querySelector('.f-count'), rateEl = card.querySelector('.f-rate');

    // ---- THE ANCHOR RULE ----
    // The box the user last typed in keeps exactly what they typed (never written to).
    // The other box shows the reconciled value. Non-absorber lines show typed values.
    if (isAbs && row.anchor === 'count') {
      // count box: user's typing (untouched). rate box: the rate that absorbs.
      setIfIdle(rateEl, fmtRate(row.rate, row.rateDp));
    } else if (isAbs && row.anchor === 'rate') {
      setIfIdle(countEl, fmtCount(row.qty));
      if (!(l.rate > 0)) setIfIdle(rateEl, fmtRate(row.rate, row.rateDp));
      // rate box keeps the user's typed rate while it holds focus or stays their anchor
    } else {
      setIfIdle(countEl, isFinite(l.count) ? fmtCount(l.count) : '');
      setIfIdle(rateEl, l.rate > 0 ? trimNum(l.rate, 4) : (isFinite(l.std) ? trimNum(l.std, 4) : ''));
    }
    setIfIdle(card.querySelector('.f-std'), isFinite(l.std) ? trimNum(l.std, 4) : '');
    setIfIdle(card.querySelector('.f-buy'), isFinite(l.buy) ? trimNum(l.buy, 4) : '');
    card.querySelector('.b-usemax').hidden = !(l.rate > 0);

    // Stock hint survives unit switches now (the item link is never dropped).
    var stock = card.querySelector('.stock');
    stock.hidden = !l.item;
    if (l.item) {
      stock.textContent = 'Summary stock: ' + trimNum(l.item.stock, 3) + ' ' + WORD[l.item.unit] +
        (l.item.unit !== l.unit ? ' (item is sold in ' + WORD[l.item.unit] + ')' : '') +
        ' — for reference, not deducted';
    }

    // ---- suggestions: counts (or kg weights) that keep the total ----
    var cands = card.querySelector('.cands');
    cands.innerHTML = '';
    var showC = isAbs && res.hasTarget && isFinite(res.remP);
    cands.hidden = !showC;
    if (showC) {
      if (kg) {
        cands.appendChild(mk('p', 'hint', 'Weights near the exact one (3 dp reads like the scale; 4 dp is tighter). Tap to fix that weight.'));
        S.kgChips(res.remP, row.rate).forEach(function (c) {
          var b = mk('button', 'cand');
          b.type = 'button';
          b.dataset.count = String(c.w);
          b.appendChild(mk('strong', '', trimNum(c.w, 4) + ' kg'));
          b.appendChild(mk('span', '', c.gap === 0 ? 'exact' : (c.gap > 0 ? '+' : '−') + fmt(Math.abs(c.gap) / 100)));
          cands.appendChild(b);
        });
      } else {
        var basis = row.typedRate != null && row.typedRate > 0 ? row.typedRate
                  : (l.rate > 0 ? l.rate : l.std);
        cands.appendChild(mk('p', 'hint', 'Counts near this one, each with the rate it needs. Tap one to fix that count.'));
        S.countOptions(l.unit, res.remP, row.qty, basis).forEach(function (c) {
          var b = mk('button', 'cand' + (Math.abs(c.count - row.qty) < 1e-9 ? ' on' : ''));
          b.type = 'button';
          b.dataset.count = String(c.count);
          b.appendChild(mk('strong', '', fmtCount(c.count) + ' ' + WORD[l.unit]));
          b.appendChild(mk('span', '', 'rate ' + fmt(c.rate) + (c.exact ? ' · exact' : '')));
          cands.appendChild(b);
        });
        var ex = S.exactCounts(l.unit, res.remP, row.qty);
        if (ex.length) {
          cands.appendChild(mk('p', 'hint', 'Exact for this total: ' +
            ex.map(function (e) { return fmtCount(e.count); }).join(', ') + ' ' + WORD[l.unit] + '.'));
        }
      }
    }

    // ---- line message ----
    var msg = card.querySelector('.line-msg');
    var text = '', tone = '';
    if (row && row.error) {
      text = row.error;
      tone = 'bad';
    } else if (row) {
      var parts = [];
      if (isAbs) {
        if (row.anchor === 'count') {
          parts.push((kg ? 'Weight' : 'Count') + ' kept. Rate absorbs → NPR ' + fmtRate(row.rate, row.rateDp) + '.');
        } else if (l.rate > 0) {
          parts.push(kg
            ? 'Typed rate NPR ' + fmt(row.typedRate) + ' kept. Weight ' + fmtCount(row.qty) + ' kg solved.'
            : 'Typed rate NPR ' + fmt(row.typedRate) + ' → ' + fmtCount(row.qty) + ' ' + WORD[l.unit] +
              ' @ NPR ' + fmtRate(row.rate, row.rateDp) + ' (rate absorbs).');
        } else {
          parts.push(kg
            ? 'Max rate NPR ' + fmt(row.typedRate) + ' kept. Weight ' + fmtCount(row.qty) + ' kg solved.'
            : 'Max rate NPR ' + fmt(row.typedRate) + ' → ' + fmtCount(row.qty) + ' ' + WORD[l.unit] +
              ' @ NPR ' + fmtRate(row.rate, row.rateDp) + '.');
        }
        if (row.rateDp > 2 && !kg) parts.push('Rate at ' + row.rateDp + ' dp for an exact bill.');
      } else {
        parts.push((l.rate > 0 ? 'Typed rate' : 'Max rate') + ' NPR ' + fmt(row.rate) + '.');
      }
      if (row.adjusted) parts.push('Rate moved 1 paisa to close the bill.');
      parts.push(FLAG_TEXT[row.flag] + (row.pct !== null ? ' (' + row.pct + '%)' : ''));
      if (row.flag === 'LOSS') tone = 'bad';
      else if (row.flag === 'OVER_TAX') tone = 'warn';
      if (row.aboveMax) {
        parts.push('Above max rate.');
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

  function renderModeUI(amt, res, V) {
    var m = MODE_TEXT[st.mode];
    setPressed($('modeBtns').querySelectorAll('.b-mode'), 'mode', st.mode);
    var vTxt = trimNum(V, 2);
    $('salesModeTitle').textContent = 'SALES CALC — ' + m.title + ' · ' + vTxt + '%';
    $('modeHint').textContent = m.hint;
    $('useCalcBtn').textContent = 'Use as ' + m.use;
    $('gross').placeholder = st.mode === 'rev' ? 'e.g. 42473' : 'auto — or type here';
    $('base').placeholder = st.mode === 'nonrev' ? 'blank = build from items' : 'auto — or type here';
    $$('#vatChips button').forEach(function (c) {
      c.classList.toggle('on', Math.abs(parseFloat(c.dataset.vat) - V) < 0.001);
    });

    // Built-from-items totals come from the solve; otherwise from the linked pair.
    var baseRu = null, vatRu = null, totRu = null;
    if (amt) {
      baseRu = amt.base; vatRu = amt.vat; totRu = amt.total;
    } else if (res && res.rows.length && !res.rows.some(function (r) { return r.error; })) {
      baseRu = res.total / 100;
      vatRu = S.round2(baseRu * V / 100);
      totRu = S.round2(baseRu + vatRu);
    }
    $('vatOut').textContent = vatRu == null ? '—' : fmt(vatRu);
    $('totalOut').textContent = totRu == null ? '—' : fmt(totRu);

    var f = '';
    if (st.typed === 'gross') {
      f = 'Taxable base = ' + fmt(num($('gross'))) + ' ÷ (1 + ' + vTxt + '%). VAT = total − base.';
    } else if (st.typed === 'base') {
      f = 'VAT = ' + fmt(num($('base'))) + ' × ' + vTxt + '%. Total = base + VAT.';
    } else if (baseRu != null) {
      f = 'Built from items. VAT = ' + fmt(baseRu) + ' × ' + vTxt + '%. Total = lines + VAT.';
    }
    $('formula').textContent = f;
  }

  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function renderResult(res, amt, V) {
    var box = $('resRows');
    box.innerHTML = '';
    res.rows.forEach(function (r, i) {
      if (r.error) return;
      var row = mk('div', 'res-row');
      var left = mk('div');
      left.appendChild(mk('strong', '', r.name || ('Item ' + (i + 1))));
      var detail = fmtCount(r.qty) + ' ' + WORD[r.unit] + ' × NPR ' + fmtRate(r.rate, r.rateDp);
      if (r.absorbs) detail += ' (takes the rest)';
      if (r.adjusted) detail += ' (1 paisa)';
      left.appendChild(mk('small', '', detail));
      row.appendChild(left);
      row.appendChild(mk('strong', '', fmt(r.sub / 100)));
      box.appendChild(row);
    });

    var tot = $('totals');
    tot.innerHTML = '';
    var hasBase = amt != null || (res.rows.length && !res.rows.some(function (r) { return r.error; }));
    if (hasBase) {
      var baseRu = amt ? amt.base : res.total / 100;
      var vatRu = amt ? amt.vat : S.round2(baseRu * V / 100);
      var totRu = amt ? amt.total : S.round2(baseRu + vatRu);
      var sign = res.variance > 0 ? '+' : (res.variance < 0 ? '−' : '');
      addTot('Taxable base', fmt(baseRu));
      addTot('Lines total', fmt(res.total / 100));
      if (res.hasTarget) addTot('Variance', sign + fmt(Math.abs(res.variance) / 100));
      addTot('VAT ' + trimNum(V, 2) + '%', fmt(vatRu));
      addTot('Lines + VAT', fmt((res.total + S.toPaisa(vatRu)) / 100));
      addTot('Bill total', fmt(totRu));
    }

    var bandFlags = res.rows.filter(function (r) {
      return !r.error && (r.flag === 'LOSS' || r.flag === 'OVER_TAX');
    }).length;
    var maxFlags = res.rows.filter(function (r) {
      return !r.error && r.aboveMax;
    }).length;
    var text, tone;
    if (!res.ok) { text = res.msg; tone = 'bad'; }
    else if (!res.hasTarget) {
      text = 'Built from items. Taxable NPR ' + fmt(res.total / 100) +
             '. Total incl. VAT NPR ' + fmt(S.round2(res.total / 100 * (1 + V / 100))) + '.';
      tone = 'ok';
    } else if (res.variance === 0) {
      text = st.typed === 'gross'
        ? 'Exact. Lines + VAT = NPR ' + fmt(num($('gross'))) + '.'
        : 'Exact. Lines = taxable NPR ' + fmt(num($('base'))) + '. Total incl. VAT NPR ' +
          fmt(S.amountsFromBase(num($('base')), V).total) + '.';
      tone = 'ok';
    } else {
      text = 'Off by NPR ' + fmt(Math.abs(res.variance) / 100) + '.';
      tone = 'warn';
    }
    var flagBits = [];
    if (bandFlags) flagBits.push(bandFlags + ' outside the band');
    if (maxFlags) flagBits.push(maxFlags + ' above max rate');
    if (res.ok && flagBits.length) {
      text += ' ' + flagBits.join(', ') + '.';
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
          ' × NPR ' + fmtRate(r.rate, r.rateDp) + ' = NPR ' + fmt(r.sub / 100));
      });
      var baseRu2 = amt ? amt.base : res.total / 100;
      var vatRu2 = amt ? amt.vat : S.round2(baseRu2 * V / 100);
      out.push('Taxable total NPR ' + fmt(res.total / 100));
      out.push('VAT ' + trimNum(V, 2) + '% NPR ' + fmt(vatRu2));
      out.push('Bill total NPR ' + fmt(amt ? amt.total : S.round2(baseRu2 + vatRu2)));
    }
    $('billing').value = out.join('\n');
  }

  // The old absorber stops absorbing (tick moved, switch off, target cleared). Its computed
  // box becomes typed, so the screen and the pricing agree — no value jumps. If that solve
  // errored (other lines already over the total), adopt whatever the boxes show instead,
  // so a displayed weight/rate never vanishes.
  function commitShown(X, V, id) {
    var l = findLine(id);
    if (!l) return;
    var r = S.solveBill(X, V, st.lines, id);
    var row = null;
    r.rows.forEach(function (x) { if (x.id === id) row = x; });
    if (row && !row.error) {
      l.count = row.qty;
      l.rate = row.rate;
    } else {
      var card = cardFor(id);
      if (card) {
        var c = card.querySelector('.f-count').value;
        var rt = card.querySelector('.f-rate').value;
        l.count = c === '' ? NaN : Number(c);
        l.rate = rt === '' ? NaN : Number(rt);
      }
    }
    l.lastField = null;
  }

  function effectiveAbsorber() {
    if (!st.absOn || st.absorber === 'none') return null;
    if (st.absorber && findLine(st.absorber)) return st.absorber;
    return S.defaultAbsorber(st.lines);
  }

  function render() {
    var V = vatVal();
    var amt = amounts();
    var X = amt ? amt.base : null;

    var absId = X ? effectiveAbsorber() : null;
    if (st.lastAbs && st.lastAbs !== absId && st.prev) {
      commitShown(st.prev.X, st.prev.V, st.lastAbs);
    }
    st.lastAbs = absId;
    st.prev = { X: X, V: V };

    $('absOn').checked = st.absOn;

    var res = S.solveBill(X, V, st.lines, absId);
    st.lines.forEach(function (l, i) { renderCard(l, res.rows[i], absId, res); });
    renderSuggest();
    renderModeUI(amt, res, V);
    renderResult(res, amt, V);
  }

  // ---------- events ----------

  // Typing a box makes it the anchor. The other box reconciles. NOTHING is wiped.
  function onInput(e) {
    var t = e.target;
    if (t.id === 'gross') { st.typed = 'gross'; render(); return; }
    if (t.id === 'base') { st.typed = 'base'; render(); return; }
    if (t.id === 'vat') { render(); return; }

    var l = lineOf(t);
    if (!l) return;
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
    else if (t.classList.contains('f-count')) { l.count = num(t); l.lastField = 'count'; }
    else if (t.classList.contains('f-rate')) { l.rate = num(t); l.lastField = 'rate'; }
    else if (t.classList.contains('f-std')) { l.std = num(t); }
    else if (t.classList.contains('f-buy')) { l.buy = num(t); }
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
    if (t.classList && t.classList.contains('f-name')) {
      var l = lineOf(t);
      var id = l ? l.id : null;
      setTimeout(function () {
        if (st.sug.line === id) { st.sug = { line: null, items: [], idx: 0 }; renderSuggest(); }
      }, 200);
      return;
    }
    // Leaving a count/rate box: fill its computed counterpart (the box just left keeps the typing).
    if (t.classList && (t.classList.contains('f-count') || t.classList.contains('f-rate'))) render();
  }

  function onClick(e) {
    var t = e.target.closest('button');
    if (!t) return;
    if (t.id === 'addLine') { addLine(); render(); return; }
    if (t.id === 'resetBtn') { resetAll(); return; }
    if (t.id === 'copyBtn') { copyText(); return; }
    if (t.closest && t.closest('#vatChips')) {
      $('vat').value = t.dataset.vat;
      render();
      return;
    }
    if (t.classList.contains('b-mode')) {
      // Values stay exactly as typed — switching never reinterprets the number.
      st.mode = t.dataset.mode;
      render();
      return;
    }
    if (t.classList.contains('sug')) { pickAt(Number(t.dataset.i)); return; }

    var l = lineOf(t);
    if (!l) return;
    if (t.classList.contains('b-unit')) setUnit(l, t.dataset.unit);
    else if (t.classList.contains('b-absorb')) {
      // Tapping the ticked line unticks it (nobody absorbs); tapping another moves it.
      st.absorber = (effectiveAbsorber() === l.id) ? 'none' : l.id;
    }
    else if (t.classList.contains('step-btn')) bump(l, Number(t.dataset.d));
    else if (t.classList.contains('cand')) {
      l.count = Number(t.dataset.count);
      l.lastField = 'count';
      var card = cardFor(l.id);
      if (card) card.querySelector('.f-count').value = String(l.count);
    }
    else if (t.classList.contains('b-usemax')) {
      l.rate = NaN;                 // back to the max sell rate basis
      l.lastField = 'rate';
      var card2 = cardFor(l.id);
      if (card2) card2.querySelector('.f-rate').value = '';
    }
    else if (t.classList.contains('b-remove')) removeLine(l);
    else return;
    render();
  }

  function onChange(e) {
    var t = e.target;
    if (t.id === 'absOn') { st.absOn = t.checked; render(); }
  }

  function resetAll() {
    $('lines').innerHTML = '';
    st.lines = [];
    st.sug = { line: null, items: [], idx: 0 };
    st.mode = 'nonrev';
    st.typed = null;
    st.absorber = null;
    st.absOn = true;
    st.lastAbs = null;
    st.prev = null;
    addLine();
    $('gross').value = '';
    $('base').value = '';
    $('vat').value = VAT_DEFAULT;
    $('absOn').checked = true;
    render();
    $('base').focus();
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

  // Read by calc.js: which box "Use as ..." should type into.
  window.FanumTax = {
    mode: function () { return st.mode; },
    vat: vatVal,
    useTarget: function (value) {
      if (st.mode === 'rev') { $('gross').value = String(value); st.typed = 'gross'; }
      else { $('base').value = String(value); st.typed = 'base'; }
      render();
    }
  };

  function init() {
    addLine();
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    document.addEventListener('click', onClick);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
