/* Grok Bot desk, iPhone app (STEP 8). Plain JS, no framework, no build step.
   Plan B: polls the JSON files api.py writes under d/{DATA_PATH}/ every 8s. Opens once as {URL}#d={DATA_PATH},
   then keeps it in localStorage. Never builds a FOMO URL: every link comes from the JSON (links.py on the desk). */
(() => {
  const Q = new URLSearchParams(location.search);
  const POLL_MS = +(Q.get('poll') || 8000), STALE_MS = location.hostname.endsWith('.github.io') ? 480000 : 90000;
  const $ = (s, el = document) => el.querySelector(s);
  const view = $('#view'), nav = $('#nav'), errRow = $('#err');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const money = (n, d = 2) => n == null ? '—' : (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', {minimumFractionDigits: d, maximumFractionDigits: d});
  const smoney = n => n == null ? '—' : (n >= 0 ? '+' : '-') + '$' + Math.abs(n).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const pct = (n, d = 2) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(d) + '%';
  const kfmt = n => n == null ? 'n/a' : n >= 1e9 ? '$' + (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'K' : '$' + n.toFixed(0);
  const sub = '₀₁₂₃₄₅₆₇₈₉';
  const tiny = p => { // $0.0₄3900 for small prices
    if (p == null) return '—'; if (p >= 1) return '$' + p.toLocaleString('en-US', {maximumFractionDigits: 4});
    if (p >= 0.001) return '$' + p.toFixed(6).replace(/0+$/, '');
    const s = p.toFixed(20).slice(2), z = s.match(/^0*/)[0].length;
    return '$0.0' + String(z).split('').map(d => sub[d]).join('') + s.slice(z, z + 4);
  };
  const hm = ts => ts ? new Date(typeof ts === 'number' ? ts * 1000 : ts).toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'}) : '';

  const TZ = 'America/Chicago';
  const hmCST = ts => ts ? new Date(typeof ts === 'number' ? ts * 1000 : ts).toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: TZ}) : '';
  const sessionAge = iso => {
    if (!iso) return '0m in session';
    const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? `${h}h ${m}m in session` : `${m}m in session`;
  };

  // ---- private data path: #d=... once, then localStorage. Removed from the address bar right away.
  const hd = new URLSearchParams(location.hash.slice(1)).get('d');
  // iPhone: a home-screen app gets its own storage and is saved from the address bar, so in Safari the #d= stays
  // in the address bar until the app runs full screen; there it is kept in localStorage and removed.
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  if (hd) { localStorage.setItem('deskData', hd); if (standalone) history.replaceState(null, '', location.pathname + location.search); }
  const DP = hd || localStorage.getItem('deskData');
  const BASE = DP ? `d/${encodeURIComponent(DP)}/` : null;
  // GitHub Pages (plan B): fresh data comes from the repo's 'data' branch via raw.githubusercontent.com (pushed ~every
  // minute, no Pages build); the Pages copy under d/ (refreshed ~every 10 min) is the fallback.
  const gh = location.hostname.endsWith('.github.io') ? [location.hostname.split('.')[0], location.pathname.split('/')[1]] : null;
  const RAW = DP && gh && gh[1] ? `https://raw.githubusercontent.com/${gh[0]}/${gh[1]}/data/${BASE}` : null;

  const S = {state: null, chart: null, activity: null, feed: null, traders: null, coin: {}, audit: {}, err: null, lastOk: 0, nextPoll: Date.now() + POLL_MS,
             tab: Q.get('tab') || 'home', screen: Q.get('coin') ? 'coin' : Q.get('auditor') != null ? 'auditor' : null,
             mint: Q.get('coin') || Q.get('auditor') || null, range: 'LIVE', actPages: 1, loading: true, prevBal: null,
             feedSeen: null};

  async function get1(base, path) {
    const r = await fetch(base + path + '?t=' + Date.now(), {cache: 'no-store'});
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  // Both GitHub copies lag (raw CDN caches ~5 min, Pages is rebuilt ~every 10 min), so each poll reads state.json
  // from both and takes the rest from whichever is newer.
  let SRC = BASE;
  const get = path => get1(SRC, path);
  async function pickSource() {
    if (!RAW) return get1(BASE, 'state.json');
    const [a, b] = await Promise.allSettled([get1(RAW, 'state.json'), get1(BASE, 'state.json')]);
    const ok = [[a, RAW], [b, BASE]].filter(([r]) => r.status === 'fulfilled');
    if (!ok.length) throw a.reason || b.reason;
    ok.sort((x, y) => Date.parse(y[0].value.updatedAt || 0) - Date.parse(x[0].value.updatedAt || 0));
    SRC = ok[0][1];
    return ok[0][0].value;
  }
  async function poll() {
    S.nextPoll = Date.now() + POLL_MS;
    if (!BASE) { S.loading = false; render(); return; }
    try {
      const st = await pickSource();
      const [ch, ac, fd] = await Promise.all([
        get('chart.json'), get('activity.json'), get('feed.json').catch(() => S.feed)
      ]);
      const prevFeed = S.feed;
      Object.assign(S, {state: st, chart: ch, activity: ac, feed: fd || S.feed, err: null, lastOk: Date.now()});
      notifyNewTrades(prevFeed);
      if (S.tab === 'traders' || !S.traders) S.traders = await get('traders.json').catch(() => S.traders);
      if (S.screen === 'coin' && S.mint) S.coin[S.mint] = await get(`coin/${S.mint}.json`).catch(() => S.coin[S.mint] ?? null);
      if (S.screen === 'auditor' && S.mint) S.audit[S.mint] = await get(`audit/${S.mint}.json`).catch(() => S.audit[S.mint] ?? null);
    } catch (e) { S.err = e.message || 'network'; }   // keep last good numbers
    S.loading = false;
    render();
  }

  // ---- error row: "Desk offline · retrying in {n}s · last update {time}"
  function offline() {
    if (!BASE) return false;
    if (S.err) return true;
    return S.state && Date.now() - Date.parse(S.state.updatedAt) > STALE_MS;
  }
  function errTick() {
    if (offline()) {
      const n = Math.max(0, Math.ceil((S.nextPoll - Date.now()) / 1000));
      const last = S.state ? hm(S.state.updatedAt) : 'never';
      errRow.textContent = `Desk offline · retrying in ${n}s · last update ${last}`;
      errRow.classList.remove('hidden');
    } else errRow.classList.add('hidden');
  }
  setInterval(errTick, 1000);

  // ---- odometer: each changed digit rolls 600ms ease-out, 30ms stagger right to left
  function odometer(el, text, prev) {
    const chars = text.split(''), pchars = (prev || '').padStart(text.length).slice(-text.length).split('');
    el.innerHTML = chars.map(c => /\d/.test(c)
      ? `<span class="d"><span class="strip">${'0123456789'.split('').map(d => `<span>${d}</span>`).join('')}</span></span>` : `<span>${esc(c)}</span>`).join('');
    const ds = [...el.querySelectorAll('.strip')];
    let di = 0;
    const idx = [];
    chars.forEach((c, i) => { if (/\d/.test(c)) idx.push(i); });
    ds.forEach((s, k) => { const i = idx[k], from = /\d/.test(pchars[i]) ? +pchars[i] : +chars[i];
      s.style.transition = 'none'; s.style.transform = `translateY(${-from}em)`; });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      ds.forEach((s, k) => { const i = idx[k], fromRight = idx.length - 1 - k;
        s.style.transition = ''; s.style.transitionDelay = `${fromRight * 30}ms`; s.style.transform = `translateY(${-chars[i]}em)`; });
    }));
    void di;
  }

  // ---- nav bar
  function navbar() {
    const st = S.state, paper = st && st.mode === 'PAPER';
    if (S.screen) {
      const title = S.screen === 'coin' ? (S.coin[S.mint]?.symbol || 'Coin') : 'Auditor';
      nav.innerHTML = `<button class="back" data-back>‹ Back</button><div class="title" style="justify-content:center">${esc(title)}
        ${S.screen === 'coin' && paper ? '<span class="paper">PAPER</span>' : ''}</div><div style="width:44px"></div>`;
      return;
    }
    if (S.tab === 'home') {
      const unread = (st?.pushes || []).some(p => Date.parse(p.ts) > +(localStorage.getItem('pushSeen') || 0));
      const live = st && !offline();
      const mode = st?.mode === 'LIVE' ? 'live mode' : st?.mode === 'PAPER' ? 'paper mode' : 'live mode';
      nav.innerHTML = `<div class="title desk-title">Desk <span class="mode-pill">${esc(mode)}</span></div>
        <button class="navbtn" data-search aria-label="Search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg></button>
        <button class="navbtn" data-bell aria-label="Alerts"><svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>${unread ? '<span class="bell-dot"></span>' : ''}</button>
        <span class="live-ind ${live ? 'on' : ''}" title="${live ? 'heartbeats fresh' : 'desk offline'}"><i></i>${live ? 'LIVE' : 'OFFLINE'}</span>`;
      return;
    }
    nav.innerHTML = `<div class="title">${{agents: 'Agents', traders: 'Traders', activity: 'Activity', account: 'Account'}[S.tab]}</div>`;
  }

  // ---- skeletons in final layout
  const sk = (h, extra = '') => `<div class="sk" style="height:${h}px;${extra}"></div>`;
  function skeleton() {
    if (S.screen === 'coin') return sk(34, 'width:60%;margin-top:8px') + sk(66, 'margin-top:14px;width:70%') + sk(260, 'margin-top:14px') + `<div class="grid">${sk(70)}${sk(70)}${sk(70)}${sk(70)}</div>`;
    if (S.screen === 'auditor') return sk(300, 'margin-top:12px') + sk(380, 'margin-top:12px');
    if (S.tab === 'home') return sk(66, 'margin-top:8px;width:75%') + sk(22, 'margin-top:10px;width:40%') + sk(220, 'margin-top:16px') +
      `<div class="section">${sk(24, 'width:50%')}</div>` + sk(334) + `<div class="section">${sk(24, 'width:40%')}</div>` + sk(300);
    if (S.tab === 'agents') return [1, 2, 3, 4, 5].map(() => sk(220, 'margin-bottom:12px;margin-top:12px')).join('');
    if (S.tab === 'activity' || S.tab === 'traders') return sk(600, 'margin-top:12px');
    return sk(120, 'margin-top:12px') + sk(200, 'margin-top:12px') + sk(400, 'margin-top:12px');
  }

  // ---- agent cards
  const LNAMES = ['Mint', 'Freeze', 'Dev', 'Top 10', 'Liquidity', 'Pool age', 'Bundles', 'Delegate'];
  function strips(layers, running) {
    return '<div class="strips">' + LNAMES.map((n, i) => {
      const L = (layers || []).find(l => l.n === i + 1);
      const cls = L && L.pass != null ? (L.pass ? 'ok' : 'bad') : running && i === (layers || []).length ? 'run' : '';
      return `<i class="${cls}">${n}</i>`;
    }).join('') + '</div>';
  }
  function agentCards() {
    const A = S.state.agents, sc = A.scanner, au = A.auditor, an = A.analyst, ex = A.executor, rk = A.risk;
    const card = (color, name, count, meta, body, foot = '') => `<div class="acard"><div class="hd"><span class="dot" style="background:${color}"></span>${name}</div>
      <div class="count">${count}</div>${meta ? `<div class="meta">${meta}</div>` : ''}${body}${foot ? `<div class="foot">${foot}</div>` : ''}</div>`;
    const feed = sc.feed.length ? `<div class="feed">${sc.feed.slice(0, 5).map(f => f.verdict === 'pass'
      ? `<div class="row pass" data-coin="${esc(f.mint)}"><span class="n">${esc(f.name || f.mint.slice(0, 6))} · liq ${kfmt(f.liquidityUsd)}</span><span class="r">→ auditor</span></div>`
      : `<div class="row kill" data-auditor="${esc(f.mint)}"><span class="n">${esc(f.name || f.mint.slice(0, 6))}</span><span class="r">${esc(f.reason)}</span></div>`).join('')}</div>`
      : `<div class="feed"><div class="row"><span class="sec">Listening for graduations</span></div></div>`;
    const auL = au.running ? au.running.layers : au.last?.layers;
    const auStatus = au.running ? '<span class="cyan">taking apart...</span>' : au.last ? (au.last.passed ? '<span class="green">8/8 → Executor</span>' : `<span class="red">${esc(au.last.reason)}</span>`) : '<span class="sec">No coin taken apart yet</span>';
    const exl = ex.last, filled = exl && exl.status === 'bought';
    const exBar = ex.running ? `Executing... ${ex.pct}%` : filled ? '<span class="green">✓ Filled</span>' : exl ? esc(exl.status + (exl.reason ? ' · ' + exl.reason : '')) : '<span class="sec">No trade yet</span>';
    const last = rk.lastExit;
    return [
      card('#64d2ff', 'Scanner', `${sc.pools} pools`, `${sc.waiting} waiting · ${sc.killed} cut`, feed),
      card('#0a84ff', 'Auditor', `${au.takenApart} taken apart`, '', strips(auL, !!au.running), `${auStatus} <span class="sec">· ${au.rejected} rejected</span>`),
      card('#ffd60a', an.mode === 'rules' ? 'Analyst (rules)' : 'Analyst', 'Scoring', an.last ? esc(an.last.passed ? 'passed → Executor' : (an.last.failed || [])[0] || '') : `${an.scored} scored`,
        `<div class="ringwrap"><canvas id="ring"></canvas></div>`),
      card('#00d35a', 'Executor', `${ex.trades} trades`, exl && exl.sizeUsd ? `${money(exl.sizeUsd)} · ${exl.stackPct}% of stack` : `${money(null)} · ${ex.stackPct}% of stack`,
        `<div class="bar"><i style="width:${ex.running ? ex.pct : filled ? 100 : 0}%"></i></div>`, exBar),
      card('#ff6b9a', 'Risk', rk.guarding ? 'Guarding' : 'Idle', last ? `${last.reason === 'trail' ? 'Trailed out' : last.reason === 'stop' ? 'Stopped' : 'Sold'} · ${esc(last.name)} <span class="${last.pnl >= 0 ? 'green' : 'red'}">${smoney(last.pnl)}</span>` : (rk.guarding ? `${rk.guarding} open` : 'No exits yet'),
        `<div class="pills"><span class="pill red">stop -${rk.stopPct}%</span><span class="pill green">trail ${rk.trailPct}%</span></div>`),
    ].join('');
  }

  // ---- activity rows
  const ICON = {bought: 'B', sold: '$', stopped: '!', rejected: '×', copy: '⇉', xsignal: 'X', profit: '%'};
  function actRow(i) {
    const trade = i.kind !== 'rejected' && i.kind !== 'copy' && i.kind !== 'xsignal';
    const subt = i.kind === 'bought' ? `${esc(i.subtitle)} · ${hm(i.ts)}` : esc(i.subtitle);
    const val = i.value || '';
    const cls = /^\+/.test(i.value) ? 'green' : /^-/.test(i.value) ? 'red' : i.kind === 'rejected' ? 'sec' : '';
    const attr = i.mint ? (trade || i.kind === 'xsignal' ? `data-coin="${esc(i.mint)}"` : `data-auditor="${esc(i.mint)}"`) : '';
    return `<div class="it" ${attr}><div class="ic ${i.kind}">${ICON[i.kind] || '·'}</div><div class="m"><div class="t">${esc(i.title)}</div><div class="s">${subt}</div></div>
      <div class="v ${cls}">${esc(val)}${i.value2 ? `<div class="s">${esc(i.value2)}</div>` : ''}</div></div>`;
  }


  // ---- live feed (real events only; synthesized from activity + decisions if feed.json is missing)
  const AGENT_GRID = [
    ['scanner', 'Scanner', '#64d2ff'], ['auditor', 'Auditor', '#0a84ff'],
    ['analyst', 'Analyst', '#ffd60a'], ['executor', 'Executor', '#00ff6a'],
    ['risk', 'Risk', '#ff6b9a'], ['copier', 'Copier', '#bf5af2'],
    ['xwatch', 'X watch', '#bbbbbb'], ['trend', 'Trend', '#ff9f0a']
  ];
  function feedEvents() {
    const out = [];
    for (const i of (S.activity?.items || [])) {
      const kind = i.kind === 'bought' ? 'BUY' : i.kind === 'sold' || i.kind === 'stopped' || i.kind === 'profit' ? 'SELL'
        : i.kind === 'rejected' && i.agent === 'auditor' ? 'REJECT' : i.kind === 'rejected' ? 'SKIP'
        : i.kind === 'copy' || i.kind === 'xsignal' ? 'SIGNAL' : 'SIGNAL';
      const ticker = i.symbol || (i.title || '').replace(/^(Bought|Sold|Stopped|Rejected)\s+/, '').split(' ')[0] || '';
      out.push({id: 'act-' + (i.id || i.ts), ts: i.ts, kind, ticker, name: i.title, mint: i.mint,
                amount: i.value || '', reason: i.subtitle || '', solscan: i.solscan || null, agent: i.agent, pnl: i.kind === 'sold' || i.kind === 'stopped' ? i.value : null});
    }
    const A = S.state?.agents || {};
    for (const [k, kindOf] of [['auditor', d => d.verdict === 'pass' ? 'SIGNAL' : 'REJECT'],
                               ['scanner', d => d.verdict === 'pass' ? 'SIGNAL' : 'SKIP'],
                               ['analyst', d => d.verdict === 'pass' ? 'SIGNAL' : 'SKIP'],
                               ['copier', d => d.verdict === 'bought' ? 'BUY' : 'SIGNAL']]) {
      for (const d of (A[k]?.decisions || []).slice(0, 12)) {
        out.push({id: k + '-' + d.ts + '-' + (d.mint || ''), ts: d.ts, kind: kindOf(d),
                  ticker: d.name || (d.mint || '').slice(0, 6), name: d.name, mint: d.mint,
                  amount: '', reason: (k[0].toUpperCase() + k.slice(1) + ' · ' + (d.reason || d.verdict || '')).trim(),
                  solscan: null, agent: k});
      }
    }
    const fromFile = (S.feed && S.feed.events) || [];
    const seen = new Set();
    const merged = [];
    for (const e of [...fromFile, ...out]) {
      const k = (e.id ? 'id:' + e.id : '') + '|' + e.kind + '|' + (e.mint || '') + '|' + (e.ts || '').slice(0, 19);
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(e);
    }
    return merged.sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
  }
  function sessionOf(st) {
    const sess = st.session || {};
    const startBal = sess.startBalance ?? st.nightStartBalance;
    const pnl = sess.pnl != null ? sess.pnl : (st.balance != null && startBal != null ? Math.round((st.balance - startBal) * 100) / 100 : 0);
    let putIn = sess.putIn, trades = sess.trades, coins = sess.coins;
    if (putIn == null) {
      const buys = (S.activity?.items || []).filter(i => i.kind === 'bought');
      const night = st.nightStart ? Date.parse(st.nightStart) : 0;
      const tonight = buys.filter(i => !night || Date.parse(i.ts) >= night);
      putIn = tonight.reduce((s, i) => s + (parseFloat(String(i.value || '').replace(/[^0-9.]/g, '')) || 0), 0);
      trades = tonight.length;
      coins = new Set(tonight.map(i => i.mint).filter(Boolean)).size;
    }
    return {
      start: sess.start || st.nightStart, startBalance: startBal, putIn: putIn || 0, trades: trades || 0,
      coins: coins ?? sess.coins ?? 0, wins: sess.wins ?? st.wins ?? 0, losses: sess.losses ?? st.losses ?? 0,
      winRate: sess.winRate ?? ( ((sess.wins ?? st.wins ?? 0) + (sess.losses ?? st.losses ?? 0)) ? Math.round(1000 * (sess.wins ?? st.wins ?? 0) / ((sess.wins ?? st.wins ?? 0) + (sess.losses ?? st.losses ?? 0))) / 10 : 0),
      realizedPnl: sess.realizedPnl ?? st.nightPnl ?? 0, pnl, multiplier: sess.multiplier ?? st.multiplier ?? 1,
      best: sess.best || null, worst: sess.worst || null
    };
  }
  function liveAgentCount(st) {
    const beats = (st.health && st.health.heartbeats) || {};
    const names = AGENT_GRID.map(([k]) => k).filter(k => st.agents?.[k] || beats[k]);
    return names.filter(k => { const ts = (st.agents?.[k]?.beat) || beats[k]; return ts && Date.now() - Date.parse(ts) < 180000; }).length;
  }
  function lastLine(key, a) {
    if (!a) return 'No data yet';
    if (a.lastLine) return a.lastLine;
    const d = (a.decisions || [])[0];
    if (key === 'scanner') return d ? `${d.verdict === 'pass' ? 'passed' : 'killed'} ${d.name || (d.mint || '').slice(0, 6)}${d.reason ? ' · ' + d.reason : ''}` : (a.waiting != null ? `${a.waiting} waiting · ${a.killed || 0} cut` : 'Listening');
    if (key === 'auditor') return d ? `${d.verdict} ${d.name || ''} · ${d.reason || ''}`.trim() : (a.takenApart ? `${a.takenApart} taken apart` : 'No coin taken apart yet');
    if (key === 'analyst') return d ? `${d.verdict} ${d.name || ''} · ${d.reason || ''}`.trim() : (a.scored ? `${a.scored} scored` : 'No scores yet tonight');
    if (key === 'executor') return d ? `${d.verdict} ${d.name || ''} · ${d.reason || ''}`.trim() : (a.trades ? `${a.trades} trades` : 'No trade yet');
    if (key === 'risk') return a.lastExit ? `${a.lastExit.reason === 'stop' ? 'Stopped' : 'Sold'} ${a.lastExit.name} ${smoney(a.lastExit.pnl)}` : (a.guarding ? `Guarding ${a.guarding}` : 'No exits yet');
    if (key === 'copier') return d ? `${d.verdict} ${d.name || ''} · ${d.reason || ''}`.trim() : (a.signals ? `${a.signals} copy signals` : `watching ${a.watching || 0} · no copy signals yet`);
    if (key === 'xwatch') return d ? `@${d.name || ''} · ${d.verdict}` : (a.signals ? `${a.signals} signals tonight` : 'No X signals tonight');
    if (key === 'trend') return a.watching ? `${a.watching} trending` : 'No trending list yet';
    return d ? `${d.verdict || ''} ${d.reason || ''}`.trim() : 'Idle';
  }
  function activityWidth(a) {
    if (!a) return 0;
    const stale = !a.beat || Date.now() - Date.parse(a.beat) > 180000;
    if (stale || a.paused) return 8;
    const cutoff = Date.now() - 10 * 60 * 1000;
    const n = (a.decisions || []).filter(d => d.ts && Date.parse(d.ts) >= cutoff).length;
    return Math.max(18, Math.min(100, 18 + n * 14));
  }
  function feedRow(e) {
    const trade = e.kind === 'BUY' || e.kind === 'SELL';
    const attr = e.solscan ? `data-solscan="${esc(e.solscan)}"` : (e.mint ? `data-coin="${esc(e.mint)}"` : '');
    const amt = e.amount || '';
    const amtCls = /^\+/.test(amt) || (e.kind === 'SELL' && /^-/.test(amt) === false && amt.includes('+')) ? 'up'
      : /^-/.test(amt) ? 'down' : (e.kind === 'BUY' ? '' : '');
    const tick = e.ticker ? '$' + String(e.ticker).replace(/^\$/, '') : '';
    return `<div class="frow ${trade ? 'trade' : ''}" ${attr}><span class="ftime">${esc(hmCST(e.ts))}</span>
      <span class="fbadge ${esc(e.kind)}">${esc(e.kind)}</span>
      <span class="ftick">${esc(tick)}</span>
      <span class="famt ${amtCls}">${esc(amt)}</span>
      <span class="freason">${esc(e.reason || '')}</span></div>`;
  }
  function notifyNewTrades(prev) {
    const evs = feedEvents();
    if (S.feedSeen == null) { S.feedSeen = new Set(evs.map(e => e.id)); return; }
    const fresh = evs.filter(e => (e.kind === 'BUY' || e.kind === 'SELL') && e.id && !S.feedSeen.has(e.id));
    evs.forEach(e => S.feedSeen.add(e.id));
    for (const e of fresh) {
      const amt = e.amount || '';
      const text = e.kind === 'BUY' ? `Bought ${amt}`.trim() : `Sold ${e.ticker ? '$' + e.ticker + ' ' : ''}${amt}`.trim();
      const cls = e.kind === 'BUY' ? 'buy' : (/^-/.test(amt) ? 'loss' : 'win');
      dropBanner(text, cls);
    }
  }
  function dropBanner(text, cls) {
    const box = document.getElementById('banners'); if (!box) return;
    const el = document.createElement('div'); el.className = 'banner ' + cls; el.textContent = text;
    box.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 3200);
  }
  function recapHtml(st) {
    const s = sessionOf(st);
    const row = (k, v, cls='') => `<div class="kv"><span class="k">${k}</span><span class="num ${cls}">${v}</span></div>`;
    const best = s.best ? `${esc(s.best.symbol || s.best.name || '')} ${smoney(s.best.pnl)}${s.best.pct != null ? ' · ' + pct(s.best.pct, 1) : ''}` : '—';
    const worst = s.worst ? `${esc(s.worst.symbol || s.worst.name || '')} ${smoney(s.worst.pnl)}${s.worst.pct != null ? ' · ' + pct(s.worst.pct, 1) : ''}` : '—';
    return `<div class="recap"><h2>Night recap</h2>
      ${row('Put in', money(s.putIn))}
      ${row('Current result', money(st.balance))}
      ${row('Multiplier', (s.multiplier != null ? s.multiplier.toFixed(2) : '1.00') + '×', s.multiplier < 1 ? 'red' : 'green')}
      ${row('Trades', String(s.trades))}
      ${row('Coins', String(s.coins))}
      ${row('Win rate', (s.winRate != null ? s.winRate : 0).toFixed(1) + '%')}
      ${row('Best trade', best, 'green')}
      ${row('Worst trade', worst, 'red')}
      ${row('Session P&amp;L', smoney(s.pnl), s.pnl >= 0 ? 'green' : 'red')}
    </div>`;
  }

  // ---- screens
  function home() {
    const st = S.state, sess = sessionOf(st);
    const running = liveAgentCount(st);
    const evs = feedEvents();
    const shown = evs.slice(-5);
    const tick = st.ticker || [];
    const tickerHtml = tick.length
      ? `<div class="ticker"><div class="ticker-track">${(tick.concat(tick)).map(c => {
          const up = c.change >= 0;
          return `<span>$${esc(String(c.symbol||'').replace(/^\$+/, ''))} <span class="ch ${up ? 'green' : 'red'}">${up ? '+' : ''}${Number(c.change).toFixed(2)}% ${esc(c.period || '')}</span></span>`;
        }).join('')}</div></div>`
      : `<div class="ticker empty">No watched coins with a 5m or 1h change yet</div>`;
    const pnlCls = sess.pnl >= 0 ? 'up' : 'down';
    const wlCls = sess.pnl >= 0 ? 'green' : 'red';
    const nightT = st.nightStart ? Date.parse(st.nightStart) / 1000 : 0;
    const nightPts = ((S.chart?.ranges?.['1D'] || S.chart?.ranges?.ALL || {points: []}).points || []).filter(p => !nightT || p.t >= nightT);
    const noPts = nightPts.length < 2;
    const A = st.agents || {}, beats = (st.health && st.health.heartbeats) || {};
    const cells = AGENT_GRID.filter(([k]) => A[k] || beats[k]).map(([k, name, color]) => {
      const a = A[k] || {beat: beats[k]};
      const stale = !a.beat || Date.now() - Date.parse(a.beat) > 180000;
      const dot = a.paused ? '#ff9f0a' : stale ? '#444' : color;
      const w = activityWidth(a);
      return `<div class="ag" style="color:${color}"><div class="ah"><span class="dot" style="background:${dot}"></span>${esc(name)}</div>
        <div class="abar"><i style="width:${w}%"></i></div>
        <div class="alast">${esc(lastLine(k, a))}</div></div>`;
    }).join('');
    const coreDots = AGENT_GRID.filter(([k]) => A[k] || beats[k]).map(([k,, color], i) =>
      `<i class="core-dot" style="--i:${i};--c:${color}"></i>`).join('');
    const sigN = st.signalsToday != null ? st.signalsToday : evs.filter(e => e.kind === 'SIGNAL').length;
    return `${tickerHtml}
      <div class="sess-line">${running} agents · ${esc(sessionAge(st.nightStart))}</div>
      <div class="bal-block">
        <div class="bal"><span class="big odo" id="bal"></span>${st.mode === 'PAPER' ? '<span class="paper">PAPER</span>' : ''}</div>
        <span class="pnl-pill ${pnlCls}">${smoney(sess.pnl)}</span>
        <div class="stats-box">in ${money(sess.putIn)} · ${sess.trades} trades · ${(sess.multiplier != null ? sess.multiplier : 1).toFixed(2)}×</div>
        <div class="wl-line ${wlCls}">${smoney(sess.pnl)} · <span class="w">W ${sess.wins} &nbsp; L ${sess.losses}</span></div>
        <div class="chartwrap"><canvas id="eq"></canvas>${noPts ? '<div class="empty-chart">Waiting for the first trade</div>' : ''}</div>
      </div>
      <section class="live-feed"><div class="feed-hd">LIVE FEED</div>
        <div class="feed-win">${shown.length ? shown.map(feedRow).join('') : '<div class="empty">No events yet tonight</div>'}</div>
      </section>
      <div class="agrid">${cells}</div>
      <div class="core"><div class="core-ring">${coreDots}<div class="core-mid"><b>${sigN}</b><span>signals</span></div></div></div>
      <button class="recap-btn" data-recap>Night recap</button>`;
  }

  function agentsTab() {
    const A = S.state.agents;
    const order = [['scanner', 'Scanner', '#64d2ff', a => `${a.pools || 0} pools today`], ['auditor', 'Auditor', '#0a84ff', a => `${a.takenApart || 0} taken apart today`],
      ['analyst', (A.analyst && A.analyst.mode === 'rules') ? 'Analyst (rules)' : 'Analyst', '#ffd60a', a => `${(A.analyst && A.analyst.scored) || 0} scored today`],
      ['executor', 'Executor', '#00ff6a', a => `${a.trades || 0} trades today`], ['risk', 'Risk', '#ff6b9a', a => `${a.count || 0} exits today · ${a.guarding || 0} open`],
      ['copier', 'Copier', '#bf5af2', a => `${a.signals || 0} copy signals today · ${a.copied || 0} copied · watching ${a.watching || 0}`],
      ['xwatch', 'X watch', '#bbbbbb', a => `${a.signals || 0} X signals tonight`],
      ['trend', 'Trend', '#ff9f0a', a => a.watching ? `${a.watching} trending` : (a.lastLine || 'Trend')]].filter(([k]) => A[k]);
    const groupOf = {scanner: 'Scanner', auditor: 'Auditor', analyst: 'Analyst', executor: 'Executor', risk: 'Risk', copier: 'Copier', xwatch: 'X watch', trend: 'Desk'};
    return order.map(([k, name, color, count]) => {
      const a = A[k], stale = !a.beat || Date.now() - Date.parse(a.beat) > 180000;
      const dot = a.paused ? '#ff9f0a' : stale ? 'rgba(235,235,245,0.3)' : '#00d35a';
      const dec = a.decisions || [];
      return `<div class="agent"><div class="hd"><span class="dot" style="width:10px;height:10px;border-radius:5px;background:${dot}"></span><span class="nm">${name}</span>
        <span class="swwrap" data-pause="${k}"><span class="switch ${a.paused ? '' : 'on'} ${a.pauseLocked ? 'locked' : ''}"></span></span></div>
        <div class="today">${count(a)}${a.paused ? ' · paused' : ''}${a.pauseLocked ? ' · can\'t pause while a position is open' : ''}</div>
        <div class="dec">${dec.length ? dec.slice(0, 20).map(d => `<div class="r"><span class="sec">${hm(d.ts)}</span>
          <a class="c" href="${esc(d.link)}" target="_blank" rel="noopener">${esc(d.name || (d.mint || '').slice(0, 6))}</a>
          <span class="w ${/pass|bought|sent|trail/.test(d.verdict) ? 'pass' : /kill|reject|stop/.test(d.verdict) ? 'bad' : ''}">${esc(d.verdict)}${d.reason ? ' · ' + esc(d.reason) : ''}</span></div>`).join('')
          : '<div class="r"><span></span><span class="sec">No decisions yet tonight</span><span></span></div>'}</div>
        <button class="linkbtn" data-settings="${groupOf[k]}">Settings</button></div>`;
    }).join('');
  }

  // ---- Traders: smart-wallet database, copy signals, X watch (traders.json)
  function tradersTab() {
    const T = S.traders;
    if (!T) return '<div class="list" style="margin-top:12px"><div class="empty">Loading traders…</div></div>';
    const c = T.counts, cp = T.copier || {};
    const pctf = n => n == null ? '—' : Math.round(n * 100) + '%';
    const gcls = g => g === 'A' || g === 'B' ? 'green' : g === 'C' ? 'orange' : 'sec';
    const spark = h => !h || h.length < 2 ? '' : (() => { const w = 44, ht = 14, mx = 100;
      const pts = h.map((v, i) => `${(i / (h.length - 1)) * w},${ht - (v / mx) * ht}`).join(' ');
      return `<svg class="spark" viewBox="0 0 ${w} ${ht}" width="${w}" height="${ht}"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`; })();
    const row = t => `<a class="it" href="${esc(t.profileUrl || t.solscan)}" target="_blank" rel="noopener">
      <div class="ic tr ${gcls(t.grade)}">${esc(t.grade || '?')}</div>
      <div class="m"><div class="t">${t.handle ? '@' + esc(t.handle) : esc(t.short)}${t.copying ? ' <span class="pill green">copying</span>' : ''}</div>
      <div class="s">${esc(t.short)} · ${t.trades ?? 0} trades · win ${pctf(t.winRate)}${t.status === 'candidate' ? ' · found on chain' : ''}</div></div>
      <div class="v ${t.pnlUsd > 0 ? 'green' : t.pnlUsd < 0 ? 'red' : 'sec'}">${t.score != null ? Math.round(t.score) : '—'}<div class="s">${t.pnlUsd != null ? smoney(t.pnlUsd) : 'not graded'} ${spark(t.history)}</div></div></a>`;
    const sig = g => `<div class="it" data-auditor="${esc(g.mint)}"><div class="ic copy">⇉</div><div class="m"><div class="t">${g.handle ? '@' + esc(g.handle) : esc(g.short)} bought ${esc(g.name || g.mint.slice(0, 6))}</div>
      <div class="s">${hm(g.ts)} · ${esc(g.status)}${g.reason ? ' · ' + esc(g.reason) : ''}</div></div><div class="v ${g.status === 'bought' ? 'green' : 'sec'}">${g.size_usd ? money(g.size_usd) : '$' + Math.round(g.usd || 0)}</div></div>`;
    const X = T.xwatch || {};
    const xrow = x => `<a class="it" href="${esc(x.url || '#')}" target="_blank" rel="noopener"><div class="ic xsignal">X</div><div class="m"><div class="t">@${esc(x.account)} · ${esc(x.kind)}</div>
      <div class="s">${esc((x.text || '').slice(0, 90))}</div></div><div class="v sec">${hm(x.ts)}<div class="s">${esc((x.keywords || []).slice(0, 3).join(' '))}</div></div></a>`;
    const unresolved = (T.handles || []).filter(h => h.status !== 'resolved');
    return `<div class="card" style="margin-top:12px"><div class="row44"><span>Copy trading</span><span class="${T.enabled ? 'green' : 'sec'}">${T.enabled ? 'On · PAPER' : 'Off'}</span></div>
        <div class="row44"><span>Wallets</span><span class="sec">${c.total} · ${c.fomo} FOMO · ${c.candidates} found on chain</span></div>
        <div class="row44"><span>Copying</span><span class="sec">${c.copying} with score ${T.minScore}+ · slice ${T.slicePct}% · max ${T.maxOpen} open</span></div>
        <div class="note">Copies go through the Auditor and Risk like every buy: -6% stop, take profit in parts, trailing stop${T.followSells ? ', and sell when the leader sells' : ''}.</div></div>
      <div class="section"><span>Smart traders</span></div>
      <div class="list">${(T.traders || []).length ? T.traders.map(row).join('') : '<div class="empty">Grading wallets…</div>'}</div>
      ${unresolved.length ? `<div class="note">Not found yet: ${unresolved.map(h => esc(h.handle)).join(', ')}</div>` : ''}
      <div class="section"><span>Copy signals</span></div>
      <div class="list">${(T.signals || []).length ? T.signals.slice(0, 20).map(sig).join('') : '<div class="empty">No copy signals yet</div>'}</div>
      <div class="section"><span>X watch · ${(X.accounts || []).length} accounts</span></div>
      <div class="list">${(X.signals || []).length ? X.signals.slice(0, 15).map(xrow).join('') : '<div class="empty">No live X signals</div>'}</div>
      <div class="note">X signals only raise the Analyst score of a coin that already passed the Auditor. Source: ${esc(X.fetcher || '')}.</div>`;
  }

  function activityTab() {
    const items = S.activity?.items || [], n = (S.activity?.pageSize || 30) * S.actPages;
    if (!items.length) return '<div class="list" style="margin-top:12px"><div class="empty">Nothing yet tonight</div></div>';
    return `<div class="list" style="margin-top:12px">${items.slice(0, n).map(actRow).join('')}</div>${items.length > n ? '<button class="more" data-more>Show more</button>' : ''}`;
  }

  function auditorScreen() {
    const st = S.state, au = st.agents.auditor;
    let a = null, name = null, link = null, sentUsd = null, enabled = au.enabled, running = false;
    if (S.mint && S.audit[S.mint] !== undefined) {
      const d = S.audit[S.mint];
      if (d) { a = d.audit; name = d.name || d.symbol; link = d.link; sentUsd = d.sentUsd; }
      if (au.running && au.running.mint === S.mint) { a = {layers: au.running.layers, mint: S.mint}; running = true; }
    } else if (!S.mint) {
      if (au.running) { a = {layers: au.running.layers, mint: au.running.mint}; name = au.running.name; running = true; }
      else if (au.last) { a = au.last; name = au.last.name; }
      const m = a?.mint; link = m ? (st.positions.find(p => p.mint === m)?.link || null) : null;
    } else return skeleton();
    if (!a) return `<div class="card" style="margin-top:12px"><div class="empty">No coin taken apart yet</div></div>${toggle(enabled)}`;
    const layers = a.layers || [];
    const NAMES = ['Mint authority', 'Freeze authority', 'Dev wallet', 'Top 10 holders', 'Liquidity', 'Pool age', 'Bundled wallets', 'Delegations'];
    const red = layers.find(l => l.pass === false);
    const nm = name || (a.mint || '').slice(0, 6);
    const head = running ? `<div class="verdict cyan">Taking apart ${esc(nm)}…</div><div class="verdict-sub">${layers.length}/8 read</div>`
      : red ? `<div class="verdict red">Rejected · ${esc(red.value)}</div><div class="verdict-sub">Grok Bot won't buy ${esc(nm)}</div>`
      : a.off ? `<div class="verdict orange">Not taken apart</div><div class="verdict-sub">Auditor was off for ${esc(nm)}</div>`
      : `<div class="verdict green">Cleared · 8/8 parts</div><div class="verdict-sub">${sentUsd ? `Sent to Executor · ${money(sentUsd)}` : 'Sent to Executor'}</div>`;
    const rows = NAMES.map((n, i) => {
      const L = layers.find(l => l.n === i + 1);
      const cls = L && L.pass != null && !a.off ? (L.pass ? 'ok' : 'bad') : 'grey';
      return `<div class="lrow ${cls}"><span class="b">${L && !a.off ? (L.pass ? '✓' : '✕') : i + 1}</span><span class="nm">${n}</span><span class="val">${L ? esc(L.value) : 'not checked'}</span></div>`;
    }).join('');
    return `<div style="font:700 28px var(--display);margin-top:8px">${esc(nm)}</div>
      <div class="disc"><canvas id="discs"></canvas></div>${head}
      <div class="card">${rows}</div>${toggle(enabled)}
      ${link ? `<a class="cta" href="${esc(link)}" target="_blank" rel="noopener">Open on FOMO</a>` : ''}`;
  }
  const toggle = on => `<div class="card"><div class="toggle" data-ro="Turning it off asks twice. Plan B: send &quot;set auditor off&quot; to your Telegram bot."><span>Take apart before buying</span><span class="switch ${on ? 'on' : ''}"></span></div></div>`;

  function coinScreen() {
    const c = S.coin[S.mint];
    if (c === undefined) return skeleton();
    if (c === null) return `<div class="card" style="margin-top:12px"><div class="empty">This coin isn't on the desk tonight</div></div>`;
    const p = c.position, open = c.openPosition, ex = c.exit;
    const since = c.sinceEntryPct;
    const shield = c.shield ? `<span class="chip ${c.shield === '8/8' ? '' : 'bad'}" data-auditor="${esc(c.mint)}">🛡 ${esc(c.shield)}</span>` : '';
    const st = c.stats || {};
    const tl = ex && ex.timeoutLeftMin != null ? `${Math.floor(ex.timeoutLeftMin / 60)}h ${String(ex.timeoutLeftMin % 60).padStart(2, '0')}m` : '';
    return `<div class="coinhd"><span class="nm">${esc(c.name || c.mint.slice(0, 8))}</span>${shield}</div>
      <div class="sec">${esc(c.symbol || '?')} · ${esc(c.chain)}${c.age ? ' · ' + esc(c.age) : ''}</div>
      <div class="price">${tiny(c.price)}</div>
      ${open && since != null ? `<div class="sub"><span class="${since >= 0 ? 'green' : 'red'}">${since >= 0 ? '▲' : '▼'} ${Math.abs(since).toFixed(2)}% since entry</span></div>` : ''}
      <div class="candles"><canvas id="cc"></canvas></div>
      <div class="grid"><div class="card"><div class="k">Market cap</div><div class="v">${kfmt(st.marketCap)}</div></div>
        <div class="card"><div class="k">Liquidity</div><div class="v">${kfmt(st.liquidity)}</div></div>
        <div class="card"><div class="k">24h volume</div><div class="v">${kfmt(st.volume24h)}</div></div>
        <div class="card"><div class="k">Holders</div><div class="v">${st.holders != null ? st.holders.toLocaleString('en-US') : 'n/a'}</div></div></div>
      ${p ? `<div class="section"><span>Your position · ${money(p.size_usd)} in · Executor</span></div>` : ''}
      ${open && ex ? `<div class="card"><div class="kv"><span class="k">Stop line · -${ex.stopPct}%</span><span>${tiny(ex.stopLine)}</span></div>
        <div class="kv"><span class="k">Trail line</span><span>${ex.trailActive ? tiny(ex.trailLine) : 'starts at ' + tiny(ex.trailStartLine)}</span></div>
        <div class="kv"><span class="k">Time left to timeout</span><span>${tl}</span></div></div>` : ''}
      ${p && !open ? `<div class="card"><div class="kv"><span class="k">Closed · ${esc(p.exit_reason)}</span><span class="${p.pnl_usd >= 0 ? 'green' : 'red'}">${smoney(p.pnl_usd)} · ${pct(p.pct, 1)}</span></div></div>` : ''}
      <a class="cta ${open ? 'sell' : ''}" href="${esc(c.link)}" target="_blank" rel="noopener">${open ? 'Sell on FOMO' : 'Buy on FOMO'}</a>`;
  }

  function accountTab() {
    const st = S.state, ac = st.account;
    const stackVal = st.mode === 'LIVE' ? ac.stack : ac.paperStartStack;
    let h = `<div class="card" style="margin-top:12px"><div class="seg" data-ro="LIVE needs 1 full PAPER night (${ac.fullPaperNights} so far) and you typing LIVE. Plan B: send &quot;live&quot; to your Telegram bot.">
        <button class="${st.mode === 'PAPER' ? 'on' : ''}">PAPER</button><button class="${st.mode === 'LIVE' ? 'on' : ''}">LIVE</button></div>
      <div class="row44" style="margin-top:8px"><span>${st.mode === 'LIVE' ? 'LIVE stack' : 'Paper start stack'}</span><span class="ro num">${money(stackVal)}</span></div>
      ${st.ticketWarning ? `<div class="note orange">${esc(st.ticketWarning)}</div>` : ''}</div>
      <div class="list">
        ${ac.profileUrl ? `<a class="row44" href="${esc(ac.profileUrl)}" target="_blank" rel="noopener"><span>Your FOMO profile</span><span class="sec">@${esc(ac.fomoHandle)} <span class="chev">›</span></span></a>` : ''}
        <button class="row44" style="width:100%" data-invite="${esc(ac.signupUrl)}"><span>Invite a friend</span><span class="chev">›</span></button>
        <div class="row44"><span>Telegram</span><span class="${ac.telegram ? 'green' : 'red'}">${ac.telegram ? 'Connected' : 'Not connected'}</span></div>
        <button class="row44" style="width:100%" data-ro="Plan B: send &quot;test&quot; to your Telegram bot and it answers with a test push."><span>Send test push</span><span class="chev">›</span></button>
        <div class="row44"><span>Home-screen push</span><span class="sec">Off · Telegram only</span></div>
      </div>
      <div class="note">${esc(ac.edit)}</div>`;
    const order = ['Scanner', 'Auditor', 'Analyst', 'Analyst (rules)', 'Executor', 'Risk', 'Copier', 'X watch', 'Live', 'Desk'];
    for (const g of order) {
      const items = st.settings[g]; if (!items) continue;
      h += `<div class="section" id="set-${g.replace(/\W/g, '')}"><span>${esc(g)}</span></div><div class="card">${items.map(setRow).join('')}</div>`;
    }
    return h;
  }
  function setRow(i) {
    const numeric = ['int', 'float', 'float?'].includes(i.type);
    if (numeric && i.min != null) {
      const step = i.type === 'int' ? 1 : (i.max - i.min) <= 1 ? 0.01 : 0.5;
      return `<div class="set"><div class="top"><span class="l">${esc(i.label)}</span><input type="number" readonly value="${i.value ?? ''}" aria-label="${esc(i.key)}"></div>
        <input type="range" disabled min="${i.min}" max="${i.max}" step="${step}" value="${i.value ?? i.min}"></div>`;
    }
    if (i.type === 'bool') return `<div class="set"><div class="top"><span class="l">${esc(i.label)}</span><span class="switch ${i.value ? 'on' : ''}"></span></div></div>`;
    return `<div class="set"><div class="top"><span class="l">${esc(i.label)}</span><span class="ro" style="width:auto;max-width:60%;overflow:hidden;text-overflow:ellipsis">${esc(i.text)}</span></div></div>`;
  }

  // ---- render
  function render() {
    navbar(); errTick();
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab && !S.screen));
    if (!BASE) { view.innerHTML = `<div class="card" style="margin-top:16px"><div class="empty">Open the private link from Grok Bot once.<br>It ends in #d=… and this phone remembers it.</div></div>`; return; }
    if (S.loading || !S.state) { view.innerHTML = skeleton(); return; }
    view.innerHTML = S.screen === 'coin' ? coinScreen() : S.screen === 'auditor' ? auditorScreen()
      : {home, agents: agentsTab, traders: tradersTab, activity: activityTab, account: accountTab}[S.tab]();
    if (!S.screen && S.tab === 'home') {
      const bal = $('#bal'), txt = money(S.state.balance);
      if (bal) { odometer(bal, txt, S.prevBal); S.prevBal = txt; }
      const start = S.state.nightStartBalance ?? S.chart?.start;
      const nightT = S.state.nightStart ? Date.parse(S.state.nightStart) / 1000 : 0;
      const src = (S.chart?.ranges?.['1D'] || S.chart?.ranges?.ALL || {points: []});
      const points = (src.points || []).filter(p => !nightT || p.t >= nightT);
      const eq = $('#eq'); if (eq) Charts.line(eq, {points, marks: [], start}, {key: 'night'});
    }
    if (S.screen === 'coin' && S.coin[S.mint]) Charts.candles($('#cc'), S.coin[S.mint].candles, S.coin[S.mint].lines || {});
    if (S.screen === 'auditor' && $('#discs')) {
      const au = S.state.agents.auditor;
      const running = au.running && (!S.mint || au.running.mint === S.mint);
      const d = S.mint ? (running ? {layers: au.running.layers} : S.audit[S.mint]?.audit) : (au.running || au.last);
      Charts.discs($('#discs'), d?.off ? [] : (d?.layers || []), !!running, S.mint || d?.mint || '');
    }
  }

  // ---- navigation & taps
  function go(screen, mint) {
    S.screen = screen; S.mint = mint; window.scrollTo(0, 0); render();
    if (screen === 'coin' && BASE) get(`coin/${mint}.json`).then(j => { S.coin[mint] = j; }).catch(() => { S.coin[mint] = null; }).then(render);
    if (screen === 'auditor' && mint && BASE) get(`audit/${mint}.json`).then(j => { S.audit[mint] = j; }).catch(() => { S.audit[mint] = null; }).then(render);
  }
  function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.add('hidden'), 2200); }
  function sheet(html) { const el = $('#sheet'); el.innerHTML = `<div class="panel">${html}</div>`; el.classList.remove('hidden'); }
  $('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') e.currentTarget.classList.add('hidden'); });

  document.addEventListener('click', async e => {
    const t = e.target.closest('[data-tab],[data-coin],[data-auditor],[data-back],[data-range],[data-more],[data-invite],[data-ro],[data-pause],[data-settings],[data-search],[data-bell],[data-pick],[data-solscan],[data-recap]');
    if (!t) return;
    if (t.dataset.solscan) { window.open(t.dataset.solscan, '_blank', 'noopener'); return; }
    if (t.hasAttribute('data-recap') && S.state) { sheet(recapHtml(S.state)); return; }
    if (t.dataset.tab) { S.tab = t.dataset.tab; S.screen = null; S.mint = null; window.scrollTo(0, 0); render();
      if (S.tab === 'traders' && BASE) get('traders.json').then(j => { S.traders = j; render(); }).catch(() => {}); }
    else if (t.hasAttribute('data-back')) { S.screen = null; S.mint = null; render(); }
    else if (t.dataset.coin) { e.preventDefault(); go('coin', t.dataset.coin); }
    else if (t.dataset.auditor) { e.preventDefault(); go('auditor', t.dataset.auditor); }
    else if (t.dataset.range) { S.range = t.dataset.range; render(); }
    else if (t.hasAttribute('data-more')) { S.actPages++; render(); }
    else if (t.dataset.invite) {
      const url = t.dataset.invite;
      try { if (navigator.share) { await navigator.share({title: 'FOMO', url}); return; } } catch (_) { return; }
      try { await navigator.clipboard.writeText(url); } catch (_) { const i = document.createElement('input'); i.value = url; document.body.appendChild(i); i.select(); document.execCommand('copy'); i.remove(); }
      toast('Link copied');
    }
    else if (t.dataset.pause) {
      const a = S.state.agents[t.dataset.pause];
      toast(a.pauseLocked ? "Risk can't be paused while a position is open" : `Plan B: send "${a.paused ? 'resume' : 'pause'} ${t.dataset.pause}" to your Telegram bot`);
    }
    else if (t.dataset.settings) { S.tab = 'account'; S.screen = null; render(); const el = document.getElementById('set-' + t.dataset.settings.replace(/\W/g, '')); if (el) el.scrollIntoView(); }
    else if (t.dataset.ro) toast(t.dataset.ro);
    else if (t.hasAttribute('data-bell')) {
      localStorage.setItem('pushSeen', Date.now()); navbar();
      const ps = S.state?.pushes || [];
      sheet(`<div class="section" style="margin-top:0"><span>Alerts</span></div>` + (ps.length ? `<div class="list">${ps.map(p => `<div class="it"><div class="m"><div class="t">${esc(p.text.split('\n')[0])}</div><div class="s">Grok Bot · ${hm(p.ts)}</div></div></div>`).join('')}</div>` : '<div class="empty">No alerts yet tonight</div>'));
    }
    else if (t.hasAttribute('data-search')) {
      sheet(`<input id="q" placeholder="Name, symbol or mint" autocomplete="off" autocapitalize="off"><div id="qr" class="list" style="margin-top:12px"></div>`);
      const q = $('#q'), qr = $('#qr');
      const run = () => { const s = q.value.trim().toLowerCase(); const hits = !s ? [] : (S.state?.search || []).filter(c => (c.name || '').toLowerCase().includes(s) || (c.symbol || '').toLowerCase().includes(s) || c.mint.toLowerCase() === s).slice(0, 20);
        qr.innerHTML = hits.map(c => `<div class="it" data-pick="${esc(c.mint)}"><div class="m"><div class="t">${esc(c.name || c.mint.slice(0, 8))}</div><div class="s">${esc(c.symbol || '')} · ${esc(c.mint.slice(0, 4))}…${esc(c.mint.slice(-4))}</div></div></div>`).join('') || (s ? '<div class="empty">No coin tonight matches</div>' : ''); };
      q.addEventListener('input', run); q.focus();
    }
    else if (t.dataset.pick) { $('#sheet').classList.add('hidden'); go('coin', t.dataset.pick); }
  });

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  render();
  poll().then(() => { if (S.screen === 'coin' && S.mint && S.coin[S.mint] === undefined) go('coin', S.mint); if (S.screen === 'auditor' && S.mint) go('auditor', S.mint); });
  setInterval(poll, POLL_MS);
  let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(render, 150); });
})();
