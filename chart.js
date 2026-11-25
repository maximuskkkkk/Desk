/* Hand-drawn <canvas> charts (STEP 3: no chart library). devicePixelRatio aware. */
(() => {
  const C = {green: '#00ff6a', red: '#ff453a', orange: '#ff9f0a', cyan: '#64d2ff', blue: '#0a84ff', yellow: '#ffd60a',
             sec: 'rgba(235,235,245,0.6)', ter: 'rgba(235,235,245,0.3)', sep: 'rgba(84,84,88,0.55)', card2: '#2c2c2e'};
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FONT = '-apple-system, "SF Pro Text", Inter, system-ui, sans-serif';

  function setup(cv) {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
    return {x, w, h};
  }

  /* Balance line: #00d35a, gradient fill under the line, dashed line at start value, marks above the line that never overlap.
     New point slides in over 250ms, marks fade in over 200ms. */
  const lineState = new Map();
  function line(cv, data, opts = {}) {
    const pts = (data.points || []).slice(), marks = data.marks || [], start = data.start;
    const lk = opts.key || 'line', st = lineState.get(lk) || {n: 0, seen: new Set()}; lineState.set(lk, st);
    const grew = pts.length > st.n && st.n > 0; st.n = pts.length;
    const newMarks = marks.filter(m => !st.seen.has(m.t + m.text)); marks.forEach(m => st.seen.add(m.t + m.text));
    const t0 = performance.now(), slide = grew && !reduce() ? 250 : 0, fade = !reduce() && newMarks.length ? 200 : 0;
    const frame = now => {
      const k = slide ? Math.min(1, (now - t0) / slide) : 1, f = fade ? Math.min(1, (now - t0) / fade) : 1;
      draw(k, f);
      if (k < 1 || f < 1) requestAnimationFrame(frame);
    };
    const draw = (k, f) => {
      const {x, w, h} = setup(cv);
      const top = 58, bot = h - 10;
      const vals = pts.map(p => p.v).concat(start != null ? [start] : []);
      if (!vals.length) return;
      let lo = Math.min(...vals), hi = Math.max(...vals);
      if (hi - lo < Math.max(1e-9, Math.abs(hi) * 0.002)) { const m = Math.abs(hi) * 0.01 || 1; hi += m; lo -= m; }
      const Y = v => bot - (v - lo) / (hi - lo) * (bot - top);
      const ts = pts.map(p => p.t), tmin = Math.min(...ts, opts.tmin ?? Infinity), tmax = Math.max(...ts);
      const span = Math.max(1, tmax - tmin);
      const X = t => 2 + (t - tmin) / span * (w - 4);
      // dashed start line
      if (start != null) { x.setLineDash([4, 4]); x.strokeStyle = C.ter; x.lineWidth = 1; x.beginPath(); x.moveTo(0, Y(start)); x.lineTo(w, Y(start)); x.stroke(); x.setLineDash([]); }
      if (pts.length >= 2) {
        const P = pts.map((p, i) => ({x: X(p.t), y: Y(p.v)}));
        if (k < 1) { const a = P[P.length - 2], b = P[P.length - 1]; P[P.length - 1] = {x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k}; }
        const g = x.createLinearGradient(0, top, 0, bot); g.addColorStop(0, 'rgba(0,255,106,0.28)'); g.addColorStop(1, 'rgba(0,255,106,0)');
        x.beginPath(); P.forEach((p, i) => i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y));
        x.lineTo(P[P.length - 1].x, bot); x.lineTo(P[0].x, bot); x.closePath(); x.fillStyle = g; x.fill();
        x.beginPath(); P.forEach((p, i) => i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y));
        x.strokeStyle = C.green; x.lineWidth = 2; x.lineJoin = 'round'; x.stroke();
        const L = P[P.length - 1]; x.fillStyle = C.green; x.beginPath(); x.arc(L.x, L.y, 3.5, 0, 7); x.fill();
      }
      // marks: pills above the line, later mark moves up a row if it would overlap
      x.font = `600 12px ${FONT}`; x.textBaseline = 'middle';
      const rows = [];
      const vAt = t => { let best = pts[0]; for (const p of pts) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p; return best ? best.v : start; };
      marks.slice().sort((a, b) => a.t - b.t).forEach(m => {
        const tw = x.measureText(m.text).width + 14, cx = Math.min(w - tw / 2 - 2, Math.max(tw / 2 + 2, X(Math.max(tmin, m.t))));
        const x0 = cx - tw / 2, x1 = cx + tw / 2;
        let row = 0; while ((rows[row] || []).some(([a, b]) => !(x1 < a - 4 || x0 > b + 4))) row++;
        (rows[row] = rows[row] || []).push([x0, x1]);
        const base = Math.min(Y(vAt(m.t)) - 14, top - 8);
        const yy = Math.max(10, base - row * 22);
        const col = {blue: C.blue, green: C.green, red: C.red}[m.color] || C.sec;
        x.globalAlpha = newMarks.includes(m) ? f : 1;
        x.fillStyle = col; roundRect(x, x0, yy - 10, tw, 20, 10); x.fill();
        x.fillStyle = m.color === 'blue' || m.color === 'red' ? '#fff' : '#000'; x.textAlign = 'center'; x.fillText(m.text, cx, yy + 0.5);
        x.globalAlpha = 1;
      });
    };
    requestAnimationFrame(frame);
  }

  function roundRect(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }

  /* 1-minute candles + volume bars; orange dashed "Risk trailing stop" line at the current exit line. */
  function candles(cv, cs, lines = {}) {
    const {x, w, h} = setup(cv);
    const volH = 46, top = 10, bot = h - volH - 12;
    if (!cs.length) { x.fillStyle = C.sec; x.font = `15px ${FONT}`; x.textAlign = 'center'; x.fillText('Waiting for the first price', w / 2, h / 2); return; }
    const vals = cs.flatMap(c => [c.h, c.l]).concat([lines.riskLine, lines.entry].filter(Boolean));
    let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * 0.08 || hi * 0.02; lo -= pad; hi += pad;
    const Y = v => top + (hi - v) / (hi - lo) * (bot - top);
    const n = Math.max(cs.length, 30), step = (w - 8) / n, cw = Math.max(1.5, Math.min(9, step * 0.7));
    const vmax = Math.max(1, ...cs.map(c => c.v || 0));
    cs.forEach((c, i) => {
      const cx = 4 + (n - cs.length + i) * step + step / 2, up = c.c >= c.o;
      x.strokeStyle = x.fillStyle = up ? C.green : C.red; x.lineWidth = 1;
      x.beginPath(); x.moveTo(cx, Y(c.h)); x.lineTo(cx, Y(c.l)); x.stroke();
      const y1 = Y(Math.max(c.o, c.c)), y2 = Y(Math.min(c.o, c.c)); x.fillRect(cx - cw / 2, y1, cw, Math.max(1, y2 - y1));
      const vh = (c.v || 0) / vmax * volH; x.globalAlpha = 0.45; x.fillRect(cx - cw / 2, h - vh, cw, vh); x.globalAlpha = 1;
    });
    if (lines.riskLine) {
      const yy = Y(lines.riskLine); x.setLineDash([6, 4]); x.strokeStyle = C.orange; x.lineWidth = 1.5;
      x.beginPath(); x.moveTo(0, yy); x.lineTo(w, yy); x.stroke(); x.setLineDash([]);
      x.fillStyle = C.orange; x.font = `600 12px ${FONT}`; x.textAlign = 'left'; x.fillText('Risk trailing stop', 8, yy - 8);
    }
  }

  /* Analyst score ring 0-100, green from min (70). */
  function ring(cv, score, min, color = C.yellow) {
    const {x, w, h} = setup(cv); const r = Math.min(w, h) / 2 - 9, cx = w / 2, cy = h / 2;
    x.lineWidth = 12; x.strokeStyle = C.card2; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.stroke();
    if (score != null) { x.strokeStyle = score >= min ? C.green : color; x.lineCap = 'round';
      x.beginPath(); x.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.005, score / 100)); x.stroke(); }
    x.fillStyle = '#fff'; x.font = `700 ${Math.round(r * 0.62)}px -apple-system, "SF Pro Display", Inter, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(score == null ? '—' : String(score), cx, cy + 1);
  }

  /* Auditor: the coin as a stack of 8 discs. A cyan beam reads each layer top to bottom (350ms per layer),
     then the disc turns green or red (150ms). It only ever shows results the server sent; it waits on a slow server. */
  const discState = new Map();
  function discs(cv, layers, running, key = '') {
    let st = discState.get(key);
    if (!st) { st = {shown: 0, raf: null, phaseStart: 0, phase: 'idle'}; discState.set(key, st); }
    st.layers = layers; st.running = running;
    if (reduce()) { st.shown = layers.length; drawDiscs(cv, st, null, 1); return; }
    if (st.shown > layers.length) st.shown = layers.length;   // new coin
    cancelAnimationFrame(st.raf);
    const tick = now => {
      if (st.phase === 'idle') {
        if (st.shown < st.layers.length || st.running) { st.phase = 'beam'; st.phaseStart = now; }
      }
      let beamK = null, colorK = 1;
      if (st.phase === 'beam') {
        beamK = Math.min(1, (now - st.phaseStart) / 350);
        if (beamK >= 1 && st.shown < st.layers.length) { st.phase = 'color'; st.phaseStart = now; }
        else if (beamK >= 1) { st.phaseStart = now; beamK = 0; }           // server is slow: keep reading the same layer
      }
      if (st.phase === 'color') {
        colorK = Math.min(1, (now - st.phaseStart) / 150);
        if (colorK >= 1) { st.shown++; st.phase = 'idle'; }
      }
      drawDiscs(cv, st, beamK, colorK);
      const more = st.shown < st.layers.length || st.running;
      const last = st.layers[st.shown - 1];
      if (more && !(last && last.pass === false)) st.raf = requestAnimationFrame(tick);
    };
    st.raf = requestAnimationFrame(tick);
  }
  function drawDiscs(cv, st, beamK, colorK) {
    const {x, w, h} = setup(cv);
    const n = 8, gap = (h - 40) / n, rx = w * 0.36, ry = gap * 0.38, cx = w / 2;
    for (let i = n - 1; i >= 0; i--) {
      const cy = 24 + i * gap + gap / 2, L = st.layers[i];
      let fill = '#2c2c2e', edge = '#3a3a3c';
      const shown = i < st.shown, coloring = i === st.shown && st.phase === 'color';
      if (L && (shown || coloring)) {
        const target = L.pass ? '#00d35a' : '#ff453a';
        fill = coloring ? mix('#2c2c2e', target, colorK) : target; edge = fill;
      }
      x.fillStyle = edge; ellipse(x, cx, cy + 5, rx, ry); x.fill();
      x.fillRect(cx - rx, cy, rx * 2, 5);
      x.fillStyle = fill; ellipse(x, cx, cy, rx, ry); x.fill();
      if (L && shown) {
        x.fillStyle = L.pass ? '#000' : '#fff'; x.font = `700 13px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText(L.pass ? '✓' : '✕', cx, cy);
      }
      if (beamK != null && i === st.shown && st.phase === 'beam') {
        const bx = cx - rx + beamK * rx * 2;
        x.save(); ellipse(x, cx, cy, rx, ry); x.clip();
        const g = x.createLinearGradient(bx - 40, 0, bx + 6, 0); g.addColorStop(0, 'rgba(100,210,255,0)'); g.addColorStop(1, 'rgba(100,210,255,0.9)');
        x.fillStyle = g; x.fillRect(bx - 40, cy - ry, 46, ry * 2); x.restore();
        x.strokeStyle = '#64d2ff'; x.lineWidth = 2; ellipse(x, cx, cy, rx, ry); x.stroke();
      }
    }
  }
  function ellipse(x, cx, cy, rx, ry) { x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); }
  function mix(a, b, k) {
    const p = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16)), A = p(a), B = p(b);
    return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * k).toString(16).padStart(2, '0')).join('');
  }

  window.Charts = {line, candles, ring, discs};
})();
