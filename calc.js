/* FanumTaxxed — side calculator (FNT-991ES PLUS style).
 * Instant keys (pointerdown, no debounce, no click delay), live preview before "=",
 * cursor editing with four separate replay buttons, VAT keys that remember which VAT
 * space the shown number is in, persistent per-device history with per-record delete,
 * distinct key sounds (ON by default) and spoken narration (OFF by default).
 */
(function () {
  'use strict';

  var S = window.Solver;
  var panel, exprEl, prevEl, spaceEl, histEl;

  // ---------- state ----------
  var C = {
    expr: '', pos: 0, fresh: false, err: false,
    space: null,      // 'gross' | 'base' | null — VAT space of the shown number
    origin: null,     // the number it was converted from (+VAT: the base; −VAT/SPLIT: the gross)
    lastResult: null,
    hist: [], hIdx: null
  };
  var sndOn = true, voiceOn = false;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function prettyExpr(e) { return e.replace(/\*/g, '×').replace(/\//g, '÷'); }
  var nfCalc = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 4 });
  var nfFull = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ---------- sounds: distinct per operation, never blocking ----------
  var AC = null;
  function audioCtx() {
    if (!AC) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      AC = new Ctx();
    }
    if (AC.state === 'suspended') { try { AC.resume(); } catch (e) {} }
    return AC;
  }
  function tone(freq, dur, type, gain, at, slideTo) {
    var ctx = audioCtx();
    if (!ctx) return;
    try {
      var t0 = ctx.currentTime + (at || 0);
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t0);
      if (slideTo) o.frequency.linearRampToValueAtTime(slideTo, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain || 0.14, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    } catch (e) {}
  }
  var TONES = {
    digit:  function () { tone(1500, 0.03, 'sine', 0.10); },
    dot:    function () { tone(1050, 0.03, 'sine', 0.10); },
    'op+':  function () { tone(523, 0.07, 'square', 0.13); },
    'op-':  function () { tone(370, 0.07, 'square', 0.13); },
    'op*':  function () { tone(660, 0.07, 'triangle', 0.16); },
    'op/':  function () { tone(294, 0.07, 'triangle', 0.16); },
    paren:  function () { tone(760, 0.04, 'sine', 0.10); },
    eq:     function () { tone(880, 0.06, 'sine', 0.15); tone(659, 0.08, 'sine', 0.15, 0.07); },
    addvat: function () { tone(587, 0.05, 'triangle', 0.16); tone(880, 0.07, 'triangle', 0.16, 0.05); },
    remvat: function () { tone(880, 0.05, 'triangle', 0.16); tone(587, 0.07, 'triangle', 0.16, 0.05); },
    vatamt: function () { tone(660, 0.04, 'sine', 0.14); tone(880, 0.04, 'sine', 0.14, 0.045); tone(1175, 0.05, 'sine', 0.14, 0.09); },
    split:  function () { tone(523, 0.04, 'sine', 0.14); tone(659, 0.04, 'sine', 0.14, 0.045); tone(784, 0.06, 'sine', 0.14, 0.09); },
    use:    function () { tone(700, 0.04, 'sine', 0.15); tone(940, 0.06, 'sine', 0.15, 0.05); },
    clear:  function () { tone(160, 0.06, 'sawtooth', 0.16); },
    del:    function () { tone(320, 0.025, 'sine', 0.10); },
    left:   function () { tone(1200, 0.02, 'sine', 0.08); },
    right:  function () { tone(1350, 0.02, 'sine', 0.08); },
    up:     function () { tone(900, 0.045, 'sine', 0.12, 0, 1400); },
    down:   function () { tone(1400, 0.045, 'sine', 0.12, 0, 900); },
    err:    function () { tone(130, 0.14, 'square', 0.18); },
    chime:  function () { tone(880, 0.05, 'sine', 0.14); tone(1320, 0.08, 'sine', 0.12, 0.06); }
  };
  function snd(name) { if (sndOn && TONES[name]) TONES[name](); }

  // ---------- narration: OFF by default, queued, never blocks a keystroke ----------
  var ONES = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
  var TENS = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
  var SCALES = ['',' thousand',' million',' billion'];
  function intWords(n) {
    if (n === 0) return 'zero';
    var out = '', g = 0;
    while (n > 0 && g < 4) {
      var grp = n % 1000;
      if (grp) {
        var s = '', h = Math.floor(grp / 100), t = Math.floor((grp % 100) / 10), o = grp % 10;
        if (h) s += ONES[h] + ' hundred';
        if (t >= 2) { s += (s ? ' ' : '') + TENS[t]; if (o) s += '-' + ONES[o]; }
        else if (t * 10 + o > 0) s += (s ? ' ' : '') + ONES[t * 10 + o];
        out = s + SCALES[g] + (out ? ' ' + out : '');
      }
      n = Math.floor(n / 1000); g++;
    }
    return out;
  }
  function numToWords(v) {
    if (!isFinite(v)) return ' error';
    var neg = v < 0; v = Math.abs(v);
    if (v >= 1e12) return ' number too large';
    var i = Math.floor(v), fs = '', fr = v - i;
    if (fr > 1e-9) {
      var d = fr.toFixed(4).slice(2).replace(/0+$/, '');
      fs = ' point ' + d.split('').map(function (c) { return ONES[+c]; }).join(' ');
    }
    return (neg ? 'minus ' : '') + intWords(i) + fs;
  }
  var Voice = {
    q: [], speaking: false,
    say: function (text) {
      if (!voiceOn || !('speechSynthesis' in window)) return;
      if (this.q.length > 40) this.q.shift();
      this.q.push(text);
      this.pump();
    },
    pump: function () {
      var self = this;
      if (self.speaking || !self.q.length) return;
      self.speaking = true;
      var text = self.q.shift();
      // Speak off the input critical path, one phrase at a time, never cancelled mid-way.
      setTimeout(function () {
        try {
          var u = new SpeechSynthesisUtterance(text);
          u.lang = 'en-US'; u.rate = 1.55; u.pitch = 1;
          u.onend = u.onerror = function () { self.speaking = false; self.pump(); };
          speechSynthesis.speak(u);
        } catch (e) { self.speaking = false; }
      }, 0);
    },
    digit: function (d) { this.say(d === '.' ? 'point' : ONES[+d] != null ? ONES[+d] : d); },
    op: function (o) {
      this.say({ '+': 'plus', '-': 'minus', '*': 'times', '/': 'divided by' }[o] || o);
    }
  };

  // ---------- persistence ----------
  function store(k, d) {
    try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
  }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function saveHist() { save('ftx_calc_hist', C.hist.slice(0, 100)); }
  function loadPrefs() {
    sndOn = store('ftx_snd', true);       // sound ON by default
    voiceOn = store('ftx_voice', false);  // narration OFF by default
    C.hist = store('ftx_calc_hist', []).filter(function (h) {
      return h && typeof h.e === 'string' && isFinite(h.r);
    }).slice(0, 100);
  }

  // ---------- toast (shared with app.js) ----------
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  // ---------- rendering ----------
  function renderCalc() {
    if (!exprEl) return;
    if (C.err) {
      exprEl.textContent = 'Error';
      prevEl.textContent = '';
      spaceEl.textContent = '';
      return;
    }
    var raw = C.expr === '' ? '0' : prettyExpr(C.expr);
    var pos = Math.min(C.pos, raw.length);
    // caret between characters
    exprEl.innerHTML = esc(raw.slice(0, pos)) + '<span class="caret"></span>' + esc(raw.slice(pos));
    exprEl.classList.toggle('long', raw.length > 14);

    if (C.fresh && C.lastResult != null) {
      prevEl.textContent = '= ' + nfCalc.format(C.lastResult);
    } else if (C.expr !== '') {
      var v = S.evalExpr(C.expr);
      prevEl.textContent = isNaN(v) ? '' : '= ' + nfCalc.format(v);
    } else {
      prevEl.textContent = '';
    }
    spaceEl.textContent = C.space === 'base' ? 'BASE' : (C.space === 'gross' ? 'INCL' : '');
    $('indHist') && ($('indHist').textContent = C.hIdx == null ? '' : 'HIST');
  }

  function renderHist() {
    if (!histEl) return;
    if (!C.hist.length) {
      histEl.innerHTML = '<p class="hint" style="margin:8px 10px">No calculations yet — every = lands here. Kept on this device only.</p>';
      return;
    }
    var html = '';
    C.hist.forEach(function (h, i) {
      html += '<div class="hist-row" data-i="' + i + '">' +
        '<button type="button" class="hist-pick" data-i="' + i + '">' +
          '<span class="he">' + esc(prettyExpr(h.e)) + '</span>' +
          '<b>= ' + nfCalc.format(h.r) + '</b>' +
        '</button>' +
        '<button type="button" class="hist-del" data-i="' + i + '" title="Delete this entry">✕</button>' +
      '</div>';
    });
    histEl.innerHTML = html;
  }

  function pushHist(exprStr, v) {
    C.hist.unshift({ e: String(exprStr), r: v, t: Date.now() });
    if (C.hist.length > 100) C.hist.length = 100;
    saveHist();
    renderHist();
  }

  // ---------- key engine (synchronous, instant) ----------
  function curVal() { return S.evalExpr(C.expr); }
  function setResult(v, opts) {
    opts = opts || {};
    var s = String(S.roundTo(v, 8));
    C.expr = s;
    C.pos = s.length;
    C.fresh = true;
    C.err = false;
    C.lastResult = v;
    C.space = opts.space || null;
    C.origin = opts.origin != null ? opts.origin : null;
  }

  function recallAt(i) {
    if (!C.hist.length) return;
    var idx = Math.max(0, Math.min(C.hist.length - 1, i));
    var h = C.hist[idx];
    C.hIdx = idx;
    C.expr = h.e;
    C.pos = h.e.length;
    C.fresh = false;
    C.err = false;
    C.lastResult = h.r;
    C.space = null;
    C.origin = null;
  }

  function vatPct() {
    if (window.FanumTax) { var v = window.FanumTax.vat(); return v >= 0 ? v : 0; }
    return 13;
  }

  function handleKey(k) {
    var c = C;

    if (k === 'C') {
      c.expr = ''; c.pos = 0; c.fresh = false; c.err = false;
      c.space = null; c.origin = null; c.lastResult = null; c.hIdx = null;
      snd('clear'); Voice.say('clear');
    }
    else if (k === 'DEL') {
      if (c.fresh) { c.expr = ''; c.pos = 0; c.fresh = false; c.lastResult = null; c.space = null; c.origin = null; }
      else if (c.pos > 0) { c.expr = c.expr.slice(0, c.pos - 1) + c.expr.slice(c.pos); c.pos--; }
      c.err = false;
      snd('del');
    }
    else if (k === 'LEFT') { c.pos = Math.max(0, c.pos - 1); snd('left'); }
    else if (k === 'RIGHT') { c.pos = Math.min(c.expr.length, c.pos + 1); snd('right'); }
    else if (k === 'UP') { recallAt((c.hIdx == null ? -1 : c.hIdx) + 1); snd('up'); Voice.say('previous'); }
    else if (k === 'DOWN') {
      if (c.hIdx == null) recallAt(0);
      else if (c.hIdx > 0) recallAt(c.hIdx - 1);
      else { c.hIdx = null; }
      snd('down'); Voice.say('next');
    }
    else if (k === '=') {
      var v = curVal();
      if (isNaN(v) || c.expr === '') { c.err = true; snd('err'); Voice.say('error'); }
      else {
        var shown = c.expr;
        setResult(v);
        pushHist(shown, v);
        snd('eq'); Voice.say('equals ' + numToWords(v));
      }
    }
    else if (k === 'ADDVAT' || k === 'REMVAT') {
      if (c.expr === '') { toast('Enter a value first.'); snd('err'); return; }
      var base = curVal();
      if (isNaN(base)) { c.err = true; snd('err'); return; }
      var p = vatPct();
      if (k === 'ADDVAT') {
        setResult(base * (1 + p / 100), { space: 'gross', origin: base });
        snd('addvat'); Voice.say('plus V A T gives ' + numToWords(base * (1 + p / 100)));
      } else {
        setResult(base / (1 + p / 100), { space: 'base', origin: base });
        snd('remvat'); Voice.say('V A T removed gives ' + numToWords(base / (1 + p / 100)));
      }
    }
    else if (k === 'VATAMT') {
      if (c.expr === '') { toast('Enter a value first.'); snd('err'); return; }
      var inc = curVal();
      if (isNaN(inc)) { c.err = true; snd('err'); return; }
      var p2 = vatPct();
      var vat = inc * p2 / (100 + p2);
      pushHist('VAT@' + p2 + '% in ' + c.expr, vat);
      setResult(vat, { space: null, origin: null });
      snd('vatamt'); Voice.say('V A T amount is ' + numToWords(vat));
    }
    else if (k === 'SPLIT') {
      if (c.expr === '') { toast('Enter a value first.'); snd('err'); return; }
      var inc2 = curVal();
      if (isNaN(inc2)) { c.err = true; snd('err'); return; }
      var p3 = vatPct();
      var b = S.round2(inc2 / (1 + p3 / 100));
      var vat2 = S.round2(inc2 - b);
      pushHist(inc2 + ' split @' + p3 + '%', b);
      setResult(b, { space: 'base', origin: inc2 });
      toast('Split @ ' + S.roundTo(p3, 2) + '% — base ' + nfFull.format(b) + ' + VAT ' + nfFull.format(vat2) + ' = ' + nfFull.format(inc2));
      snd('split'); Voice.say('base ' + numToWords(b) + ', V A T ' + numToWords(vat2));
    }
    else if (k === 'USE') {
      var u = curVal();
      if (!(u > 0)) { toast('Enter a value first.'); snd('err'); return; }
      var p4 = vatPct();
      var mode = window.FanumTax ? window.FanumTax.mode() : 'nonrev';
      var r = S.useValue(u, p4, mode, C.space, C.origin);
      if (window.FanumTax) window.FanumTax.useTarget(r.value);
      toast(r.converted
        ? 'Converted first: sent ' + nfFull.format(r.value) + ' as the ' +
          (mode === 'rev' ? 'VAT-inclusive total' : 'taxable amount') + ' — never taxed twice.'
        : 'Set as ' + (mode === 'rev' ? 'bill total' : 'taxable amount') + ': ' + nfFull.format(r.value) + '.');
      snd('use'); Voice.say('used as bill ' + numToWords(r.value));
    }
    else {
      // digits, operators, parens, dot — inserted at the cursor
      if (c.err) { c.err = false; c.expr = ''; c.pos = 0; }
      if (c.fresh && /[0-9.(]/.test(k)) { c.expr = ''; c.pos = 0; }
      c.fresh = false;
      c.hIdx = null;
      if (c.space && /[0-9.]/.test(k)) { c.space = null; c.origin = null; }
      c.expr = c.expr.slice(0, c.pos) + k + c.expr.slice(c.pos);
      c.pos++;
      if (/[0-9]/.test(k)) { snd('digit'); Voice.digit(k); }
      else if (k === '.') { snd('dot'); Voice.digit('.'); }
      else if (k === '(' || k === ')') { snd('paren'); Voice.say(k === '(' ? 'open bracket' : 'close bracket'); }
      else { snd('op' + k); Voice.op(k); }
    }
    renderCalc();
  }

  // ---------- fast input path: pointerdown first, click only as keyboard fallback ----------
  var lastPtr = null;
  function padKeyFromEvent(e) {
    var b = e.target.closest ? e.target.closest('[data-calc]') : null;
    return b ? b.dataset.calc : null;
  }
  function onPadPointerDown(e) {
    var k = padKeyFromEvent(e);
    if (!k) return;
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();               // no focus scroll, no double-tap zoom, no 300 ms wait
    audioCtx();                       // unlock audio inside the user gesture
    handleKey(k);
    lastPtr = { k: k, t: Date.now() };
  }
  function onPadClick(e) {
    var k = padKeyFromEvent(e);
    if (!k) return;
    if (lastPtr && lastPtr.k === k && Date.now() - lastPtr.t < 600) return; // already ran on pointerdown
    handleKey(k);
  }

  function onKeyDoc(e) {
    if (!panel || panel.hidden) return;
    if (e.target.closest && (e.target.closest('input, textarea, select, .suggest, .b-absorb'))) return;
    var k = null;
    if (/^[0-9]$/.test(e.key)) k = e.key;
    else if (e.key === '.') k = '.';
    else if (e.key === '+') k = '+';
    else if (e.key === '-') k = '-';
    else if (e.key === '*') k = '*';
    else if (e.key === '/') k = '/';
    else if (e.key === '(' || e.key === ')') k = e.key;
    else if (e.key === 'Enter' || e.key === '=') k = '=';
    else if (e.key === 'Backspace') k = 'DEL';
    else if (e.key === 'Delete') k = 'C';
    else if (e.key === 'ArrowLeft') k = 'LEFT';
    else if (e.key === 'ArrowRight') k = 'RIGHT';
    else if (e.key === 'ArrowUp') k = 'UP';
    else if (e.key === 'ArrowDown') k = 'DOWN';
    else if (e.key === 'Escape') { toggleCalc(false); return; }
    if (k) {
      e.preventDefault();
      handleKey(k);
      var b = document.querySelector('[data-calc="' + k + '"]');
      if (b) { b.classList.add('pressed'); setTimeout(function () { b.classList.remove('pressed'); }, 90); }
    }
  }

  // ---------- toggles ----------
  function setSnd(on) {
    sndOn = on;
    save('ftx_snd', on);
    var b = $('sndBtn');
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) snd('chime');
  }
  function setVoice(on) {
    voiceOn = on;
    save('ftx_voice', on);
    var b = $('voiceBtn');
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) { snd('chime'); Voice.say('Voice on. I will read back what you press.'); }
    else { try { speechSynthesis && speechSynthesis.cancel(); } catch (e) {} Voice.q = []; Voice.speaking = false; }
  }

  function toggleHist(force) {
    var open = typeof force === 'boolean' ? force : histEl.hidden;
    histEl.hidden = !open;
    $('histBtn').classList.toggle('on', open);
    if (open) renderHist();
  }

  function toggleCalc(force) {
    var open = typeof force === 'boolean' ? force : panel.hidden;
    panel.hidden = !open;
    $('calcBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) { renderCalc(); renderHist(); }
  }

  function onHistClick(e) {
    var del = e.target.closest('.hist-del');
    if (del) {
      C.hist.splice(Number(del.dataset.i), 1);
      saveHist(); renderHist(); renderCalc();
      snd('del');
      return;
    }
    var pick = e.target.closest('.hist-pick');
    if (pick) {
      recallAt(Number(pick.dataset.i));
      renderCalc();
      snd('up');
    }
  }

  // ---------- init ----------
  function init() {
    panel = $('calcPanel');
    exprEl = $('calcNow');
    prevEl = $('calcPrev');
    spaceEl = $('indSpace');
    histEl = $('calcHist');
    if (!panel) return;

    loadPrefs();
    $('sndBtn').classList.toggle('on', sndOn);
    $('sndBtn').setAttribute('aria-pressed', sndOn ? 'true' : 'false');
    $('voiceBtn').classList.toggle('on', voiceOn);
    $('voiceBtn').setAttribute('aria-pressed', voiceOn ? 'true' : 'false');

    // The instant path. pointerdown fires with the touch — no click delay, ever.
    panel.addEventListener('pointerdown', onPadPointerDown);
    panel.addEventListener('click', onPadClick);

    $('calcBtn').addEventListener('click', function () { toggleCalc(); });
    $('calcClose').addEventListener('click', function () { toggleCalc(false); });
    $('sndBtn').addEventListener('click', function () { setSnd(!sndOn); });
    $('voiceBtn').addEventListener('click', function () { setVoice(!voiceOn); });
    $('histBtn').addEventListener('click', function () { toggleHist(); });
    histEl.addEventListener('click', onHistClick);

    document.addEventListener('keydown', onKeyDoc);
    renderCalc();
    renderHist();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
