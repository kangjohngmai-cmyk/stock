import { fb } from './fb.js';
import { GAME_TITLE } from './config.js';
import { STOCKS, ITEMS, DEFAULT_CFG, execBuy, execSell, maxBuyQty, worthOf, won, signed, pct } from './shared.js';
import { $, esc, cls, mmss, toast, drawLine } from './ui.js';

const S = {
  uid: null, me: undefined, cfg: { ...DEFAULT_CFG }, game: { status: 'lobby' }, prices: null, prevP: {},
  hist: [], news: [], lb: null, arena: { queue: [], qteams: [], duels: {} }, tour: null, probs: { list: [], tries: 3 },
  offset: 0, connected: true, loadT: Date.now(), page: 0, sel: null, side: 'buy', range: 150, busy: false,
  seenProbs: 0,
};
const PAGES = 5;
const now = () => Date.now() + S.offset;
const P = () => (S.prices && S.prices.p) || Object.fromEntries(STOCKS.map(s => [s.id, s.p0]));
const OPEN = () => (S.prices && S.prices.open) || Object.fromEntries(STOCKS.map(s => [s.id, s.p0]));
const EMPTY_T = { name: '', cash: 0, hold: {}, items: {}, act: {}, status: 'active', invested: 1, log: [], members: [], solved: {}, tries: {} };
const T = () => { const t = (S.me && S.me.t) || {}; return { ...EMPTY_T, ...t, hold: t.hold || {}, items: t.items || {}, act: t.act || {}, log: t.log || [], members: t.members || [], solved: t.solved || {}, tries: t.tries || {} }; };
const units = () => Math.max(1, (T().invested || S.cfg.startCash) / S.cfg.startCash);
const credit = () => Math.round(S.cfg.creditLimit * units());
const outLine = () => Math.round(S.cfg.outLine * units());
document.title = GAME_TITLE; $('joinTitle').textContent = GAME_TITLE;

try { const tn = localStorage.getItem('teamNo'); if (tn) $('joinTeam').value = tn; } catch {}
try { S.seenProbs = Number(localStorage.getItem('seenProbs') || 0); } catch {}

// ---------------- 시작 ----------------
async function boot() {
  try {
    fb.onUser(async u => {
      if (!u) { try { await fb.anon(); } catch (e) { $('loadMsg').textContent = '접속 실패: ' + e.message; } return; }
      if (S.uid === u.uid) return;
      S.uid = u.uid;
      subscribe();
    });
  } catch (e) { $('loadMsg').textContent = e.message; }
}

function subscribe() {
  fb.offset(v => S.offset = v);
  fb.connected(v => { S.connected = v; renderAlerts(); });
  fb.on('players/' + S.uid, v => {
    const wasIn = !!S.me;
    S.me = v;
    showView();
    if (v) { renderAll(); if (!wasIn) restorePage(); }
  });
  fb.on('config', v => { if (v) S.cfg = { ...DEFAULT_CFG, ...v }; $('teamHint').textContent = `팀 번호 (1~${S.cfg.maxTeams})`; renderAll(); });
  fb.on('game', v => { S.game = v || { status: 'lobby' }; renderAll(); });
  fb.on('market/prices', v => {
    if (!v) return;
    S.prevP = S.prices ? S.prices.p : {};
    S.prices = v; renderMarket(true); renderTop(); if (S.page === 1) renderTeam(); if (S.sel) renderSheet();
  });
  fb.onAdded('market/hist', 900, (k, v) => {
    S.hist.push(v); if (S.hist.length > 2000) S.hist.shift();
    histDirty = true;
  });
  fb.onAdded('news', 8, (k, v) => {
    S.news.push(v); if (S.news.length > 8) S.news.shift();
    renderNewsbar();
    if (v.t > S.loadT - 3000 && S.me) flashNews(v);
  });
  fb.on('leaderboard', v => { S.lb = v; renderTop(); if (S.page === 4) renderRank(); });
  fb.on('problems', v => { S.probs = { list: [], tries: 3, ...(v || {}) }; S.probs.list = S.probs.list || []; renderProblems(); renderPips(); });
  fb.on('arena', v => { S.arena = { queue: [], qteams: [], duels: {}, ...(v || {}) }; renderArena(); });
  fb.on('tour', v => { S.tour = v; renderTop(); renderTourBox(); if (S.page === 4) renderTour(); });
  fb.onAdded('inbox/' + S.uid, 6, (k, v) => { if (v && v.t > S.loadT - 4000) toast(v.text, v.kind); });
  setInterval(tick, 500);
}

let histDirty = false;
function tick() {
  renderTimers();
  if (histDirty) { histDirty = false; renderMarket(false); if (S.sel) drawSheetChart(); }
}

function showView() {
  $('loading').classList.add('hidden');
  $('joinView').classList.toggle('hidden', !!S.me);
  $('appView').classList.toggle('hidden', !S.me);
}

// ---------------- 입장 ----------------
$('joinForm').onsubmit = (e) => {
  e.preventDefault();
  const name = $('joinName').value.trim();
  const team = Number($('joinTeam').value);
  if (!name) { $('joinMsg').textContent = '닉네임을 입력해줘'; return; }
  if (!Number.isInteger(team) || team < 1 || team > S.cfg.maxTeams) { $('joinMsg').textContent = `팀 번호는 1~${S.cfg.maxTeams} 사이 숫자로 써줘`; return; }
  if (S.game.status === 'ended') { $('joinMsg').textContent = '게임이 이미 끝났어'; return; }
  $('joinBtn').disabled = true; $('joinMsg').textContent = '';
  try { localStorage.setItem('teamNo', String(team)); } catch {}
  S.loadT = Date.now() - 1000;
  send('join', { name, team });
  setTimeout(() => { $('joinBtn').disabled = false; if (!S.me && !$('joinMsg').textContent) $('joinMsg').textContent = '응답이 없어… 운영자 화면이 켜져 있는지 확인해줘'; }, 6000);
};

function send(type, data = {}) {
  if (!S.uid) return;
  fb.push('requests', { uid: S.uid, type, ...data, t: fb.TS() }).catch(e => toast('전송 실패: ' + e.message, 'bad'));
  if (type === 'join') {
    const unsub = fb.onAdded('inbox/' + S.uid, 1, (k, v) => { if (!S.me && v && v.kind === 'bad' && v.t > S.loadT) { $('joinMsg').textContent = v.text; $('joinBtn').disabled = false; } });
    setTimeout(() => unsub && unsub(), 8000);
  }
}

// ---------------- 페이지 넘기기 (시트 탭 + 스와이프) ----------------
const pager = $('pager');
function goPage(i, smooth = true) {
  i = Math.max(0, Math.min(PAGES - 1, i));
  progScroll = Date.now();
  pager.scrollTo({ left: i * pager.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
  setPage(i);
}
function setPage(i) {
  if (S.page === i && pageInit) return;
  pageInit = true;
  S.page = i;
  document.querySelectorAll('#sheettabs button').forEach(b => b.classList.toggle('on', Number(b.dataset.p) === i));
  const tab = document.querySelector(`#sheettabs button[data-p="${i}"]`); tab && tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  try { localStorage.setItem('page', String(i)); } catch {}
  if (i === 3 && S.probs.list.length) { S.seenProbs = S.probs.list.length; try { localStorage.setItem('seenProbs', String(S.seenProbs)); } catch {} }
  renderPage(i); renderPips();
}
let pageInit = false, scrollT = null, progScroll = 0;
pager.addEventListener('scroll', () => {
  clearTimeout(scrollT);
  // 탭을 눌러서 이동하는 중에는 중간 위치를 무시
  scrollT = setTimeout(() => { if (Date.now() - progScroll < 700) return; const i = Math.round(pager.scrollLeft / Math.max(1, pager.clientWidth)); if (i !== S.page) setPage(i); }, 80);
}, { passive: true });
document.querySelectorAll('#sheettabs button').forEach(b => b.onclick = () => goPage(Number(b.dataset.p)));
window.addEventListener('resize', () => { pager.scrollTo({ left: S.page * pager.clientWidth, behavior: 'auto' }); renderMarket(false); drawSheetChart(); });
function restorePage() { let i = 0; try { i = Number(localStorage.getItem('page') || 0); } catch {} requestAnimationFrame(() => goPage(i, false)); }

function renderPage(i) { if (!S.me) return; [renderMarket, renderTeam, renderArena, renderProblems, () => { renderTourBox(); renderTour(); renderRank(); }][i](false); }
function renderAll() { if (!S.me) return; renderTop(); renderAlerts(); renderNewsbar(); renderMarket(false); renderTeam(); renderArena(); renderProblems(); renderTourBox(); renderTour(); renderRank(); renderPips(); }
function renderPips() {
  if (!S.me) return;
  $('arenaPip').classList.toggle('hidden', !(S.me.arena === 'duel' && S.page !== 2));
  $('probPip').classList.toggle('hidden', !(S.probs.list.length > S.seenProbs && S.page !== 3));
}

// ---------------- 위쪽 요약 ----------------
function teamWorth() { return S.me ? worthOf(T(), P()) : 0; }

function renderTop() {
  if (!S.me) return;
  const t = T(), w = teamWorth(), inv = t.invested || S.cfg.startCash, r = (w - inv) / inv;
  $('teamName').textContent = t.name;
  $('meName').textContent = `· ${S.me.name} · ${t.members.length}명`;
  $('worth').textContent = won(w) + '원';
  $('worth').className = 'tb-worth num ' + (t.status === 'out' ? 'down' : '');
  $('worthPl').textContent = pct(r); $('worthPl').className = 'num ' + cls(r);
  if (S.lb && S.lb.list) {
    const i = S.lb.list.findIndex(x => x[5] === S.me.team);
    $('rankChip').textContent = i >= 0 ? `🏆 ${i + 1}위/${S.lb.list.length}팀` : '-위';
  }
}

function renderTimers() {
  const g = S.game;
  if (g.status === 'running') $('timeChip').textContent = '⏱ ' + mmss(g.endAt - now());
  else if (g.status === 'paused') $('timeChip').textContent = '⏸ ' + mmss(g.endAt - g.pausedAt);
  else $('timeChip').textContent = g.status === 'ended' ? '🏁 끝' : '⏳ 시작 전';
  if (S.page === 2) updateDuelTimer();
  if (S.tour && S.tour.status === 'running') { const left = mmss(S.tour.endsAt - (S.game.status === 'paused' ? S.game.pausedAt : now())); document.querySelectorAll('.tourTime').forEach(el => { el.textContent = left; }); }
  renderAlerts();
  if (S.page === 1) renderEffects();
}

let lastAlerts = '', lastTrade = '';
function renderAlerts() {
  if (!S.me) return;
  const t = T(), a = [], b = [];
  if (!S.connected) a.push(['bad', '📡 인터넷 연결이 끊겼어. 다시 연결 중…']);
  else if (S.game.status === 'running' && S.prices && now() - S.prices.t > 12000) a.push(['warn', '⚠️ 운영자 서버가 응답이 없어. 잠깐 기다려줘']);
  if (t.status === 'out') a.push(['bad', '💥 팀이 파산해서 아웃됐어. 구경은 계속 할 수 있어.']);
  if (S.game.status === 'lobby') a.push(['info', '⏳ 아직 시작 전이야. 운영자가 시작하면 거래할 수 있어.']);
  // 주식 페이지 전용 알림
  if (t.status !== 'out' && t.cash < 0) b.push(['warn', `⚠️ 팀 빚 ${won(-t.cash)}원 · 팀 총자산이 ${won(outLine())}원 이하가 되면 파산`]);
  if (t.preview && t.preview.at > now()) b.push(['info', `📰 미리보기: "${t.preview.text}" (${mmss(t.preview.at - now())} 후)`]);
  const h1 = a.map(([k, x]) => `<div class="alert ${k}">${esc(x)}</div>`).join('');
  if (h1 !== lastAlerts) { $('alerts').innerHTML = h1; lastAlerts = h1; }
  const h2 = b.map(([k, x]) => `<div class="alert ${k}">${esc(x)}</div>`).join('');
  if (h2 !== lastTrade) { $('tradeAlerts').innerHTML = h2; lastTrade = h2; }
}

function renderNewsbar() {
  const n = S.news[S.news.length - 1];
  if (!n) return;
  $('newsText').innerHTML = `<b class="${n.up ? 'up' : 'down'}">${n.up ? '▲' : '▼'}</b> ${esc(n.text)}`;
  $('newsText').className = '';
}

function flashNews(n) {
  $('nfText').textContent = n.text;
  const nm = n.s === 'ALL' ? '시장 전체' : (STOCKS.find(s => s.id === n.s) || {}).name;
  $('nfSub').textContent = `${nm} ${n.up ? '호재 ▲' : '악재 ▼'}`;
  $('newsFlash').querySelector('.box').className = 'box ' + (n.up ? 'up' : 'down');
  $('newsFlash').classList.remove('hidden');
  navigator.vibrate && navigator.vibrate(150);
  clearTimeout(flashNews.t); flashNews.t = setTimeout(() => $('newsFlash').classList.add('hidden'), 3500);
}
$('newsFlash').onclick = () => $('newsFlash').classList.add('hidden');

function series(id, n) {
  const h = n ? S.hist.slice(-n) : S.hist;
  const arr = h.map(x => x.p && x.p[id]).filter(v => v != null);
  const cur = P()[id]; if (cur != null) arr.push(cur);
  return arr;
}

// ---------------- 1. 주식 ----------------
function renderMarket(flash) {
  if (!S.me) return;
  const pr = P(), op = OPEN(), hold = T().hold;
  const box = $('stockList');
  if (!box.children.length) {
    box.innerHTML = STOCKS.map(s => `<div class="stock" data-s="${s.id}">
      <div><div class="nm"><i class="dot" style="background:${s.color}"></i>${esc(s.name)}</div><div class="sec">${esc(s.sector)} <span class="hq"></span></div></div>
      <canvas class="spark" style="width:70px;height:34px"></canvas>
      <div class="px num"><div class="v"></div><span class="badge"></span></div></div>`).join('');
    box.querySelectorAll('.stock').forEach(el => el.onclick = () => openSheet(el.dataset.s));
  }
  for (const s of STOCKS) {
    const el = box.querySelector(`[data-s="${s.id}"]`);
    const p = pr[s.id], ch = p / op[s.id] - 1;
    el.querySelector('.v').textContent = won(p);
    const b = el.querySelector('.badge'); b.textContent = pct(ch); b.className = 'badge ' + cls(ch);
    el.querySelector('.v').className = 'v ' + cls(ch);
    const h = hold[s.id];
    el.querySelector('.hq').textContent = h ? `· 팀 ${won(h.q)}주` : '';
    if (flash && S.prevP[s.id] && Math.abs(p / S.prevP[s.id] - 1) > 0.004) {
      el.classList.remove('flash-up', 'flash-down'); void el.offsetWidth; el.classList.add(p > S.prevP[s.id] ? 'flash-up' : 'flash-down');
    }
    if (!flash || !el._drawn) { drawLine(el.querySelector('canvas'), series(s.id, 90), { base: op[s.id], width: 1.6 }); el._drawn = !!el.querySelector('canvas').clientWidth; }
  }
}

function openSheet(id) {
  S.sel = id; S.side = 'buy'; $('qty').value = '';
  $('sheet').classList.remove('hidden'); $('sheetBg').classList.remove('hidden');
  setSide('buy'); renderSheet(); drawSheetChart();
}
function closeSheet() { S.sel = null; $('sheet').classList.add('hidden'); $('sheetBg').classList.add('hidden'); }
$('closeSheet').onclick = closeSheet; $('sheetBg').onclick = closeSheet;
document.querySelectorAll('#rangeSeg button').forEach(b => b.onclick = () => {
  S.range = Number(b.dataset.r);
  document.querySelectorAll('#rangeSeg button').forEach(x => x.classList.toggle('on', x === b));
  drawSheetChart();
});
document.querySelectorAll('#sideSeg button').forEach(b => b.onclick = () => setSide(b.dataset.side));
function setSide(side) {
  S.side = side;
  document.querySelectorAll('#sideSeg button').forEach(x => { x.classList.toggle('on', x.dataset.side === side); x.classList.toggle('buy', x.dataset.side === 'buy' && side === 'buy'); x.classList.toggle('sell', x.dataset.side === 'sell' && side === 'sell'); });
  $('tradeBtn').className = 'btn big ' + side;
  $('tradeBtn').textContent = side === 'buy' ? '매수하기' : '매도하기';
  renderSheet();
}
function drawSheetChart() {
  if (!S.sel) return;
  drawLine($('sChart'), series(S.sel, S.range), { base: OPEN()[S.sel], axis: true, fill: true });
}

function stockOf(id) { return STOCKS.find(s => s.id === id); }
function feeNow() { return T().act.feeFreeUntil > now() ? 0 : S.cfg.feeRate; }
function depth(st) { return st.depth * (S.cfg.impactScale || 1); }

function renderSheet() {
  if (!S.sel || !S.me) return;
  const t = T(), st = stockOf(S.sel), p = P()[S.sel], ch = p / OPEN()[S.sel] - 1;
  $('sName').innerHTML = `<i class="dot" style="background:${st.color}"></i> ${esc(st.name)}`;
  $('sSec').textContent = st.sector + ' · 변동성 ' + (st.vol >= 4 ? '매우 높음' : st.vol >= 2.5 ? '높음' : st.vol >= 1.8 ? '보통' : '낮음');
  $('sPrice').textContent = won(p) + '원'; $('sPrice').className = 'num ' + cls(ch);
  $('sChg').innerHTML = `<span class="${cls(ch)}">${signed(p - OPEN()[S.sel])} (${pct(ch)})</span> <span class="muted">시작가 대비</span>`;
  const h = t.hold[S.sel];
  if (h) {
    const val = Math.round(h.q * p), cost = Math.round(h.q * h.avg), pl = val - cost;
    $('sHold').innerHTML = `<div class="kv"><span>팀 보유</span><b class="num">${won(h.q)}주</b></div><div class="kv"><span>평균 매수가</span><b class="num">${won(h.avg)}원</b></div><div class="kv"><span>평가 손익</span><b class="num ${cls(pl)}">${signed(pl)}원 (${pct(pl / cost)})</b></div>`;
  } else $('sHold').innerHTML = '<div class="muted small">우리 팀은 아직 이 종목이 없어</div>';

  const fee = feeNow(), L = depth(st);
  const cashMax = maxBuyQty(p, L, fee, t.cash);
  const credMax = maxBuyQty(p, L, fee, t.cash + credit());
  const btns = S.side === 'buy'
    ? [['1', 1], ['10', 10], ['100', 100], ['현금 최대', cashMax], ['빚까지', credMax]]
    : [['1', 1], ['10', 10], ['절반', h ? Math.floor(h.q / 2) : 0], ['전부', h ? h.q : 0]];
  const qb = $('qBtns'); qb.innerHTML = '';
  for (const [lab, v] of btns) {
    const b = document.createElement('button'); b.textContent = lab;
    b.onclick = () => { $('qty').value = Math.max(0, v) || ''; renderEst(); };
    qb.appendChild(b);
  }
  renderEst();
}
$('qty').oninput = renderEst;

function renderEst() {
  if (!S.sel || !S.me) return;
  const t = T(), st = stockOf(S.sel), p = P()[S.sel], q = Math.floor(Number($('qty').value));
  const fee = feeNow(), L = depth(st), act = t.act;
  let html = '', ok = q >= 1 && t.status === 'active' && S.game.status === 'running';
  if (q >= 1) {
    if (S.side === 'buy') {
      const r = execBuy(p, q, L, fee);
      const after = t.cash - r.total;
      html = `<div class="kv"><span>예상 평균 체결가</span><b class="num">${won(r.avgPx)}원</b></div>
        <div class="kv"><span>수수료 ${fee ? (fee * 100).toFixed(1) + '%' : '(면제 💸)'}</span><b class="num">${won(r.fee)}원</b></div>
        <div class="kv"><span>총 결제 금액</span><b class="num">${won(r.total)}원</b></div>
        <div class="kv"><span>매수 후 팀 현금</span><b class="num ${after < 0 ? 'up' : ''}">${won(after)}원</b></div>`;
      if (after < -credit()) { html += `<div class="alert bad" style="margin:6px 0 0">팀 빚 한도(${won(credit())}원)를 넘어</div>`; ok = false; }
      else if (after < 0) html += `<div class="alert warn" style="margin:6px 0 0">⚠️ 팀이 ${won(-after)}원을 빚지고 사는 거야</div>`;
      if (r.x > 0.01) html += `<div class="muted small" style="margin-top:6px">많이 사면 사는 동안 가격이 올라가 (+${(Math.expm1(r.x) * 100).toFixed(1)}%)</div>`;
    } else {
      const h = t.hold[S.sel];
      if (!h || h.q < q) { html = '<div class="alert bad" style="margin:0">팀이 갖고 있는 것보다 많이 팔 수 없어</div>'; ok = false; }
      else {
        const r = execSell(p, q, L, fee), cost = Math.round(h.avg * q);
        let get = r.net, note = '';
        if (act.shield && get < cost) { note = '🛡️ 손실 방지 적용 → 본전'; get = cost; }
        if (act.double && get > cost) { note = '✖️2 수익 2배 적용'; get += get - cost; }
        html = `<div class="kv"><span>예상 평균 체결가</span><b class="num">${won(r.avgPx)}원</b></div>
          <div class="kv"><span>수수료 ${fee ? (fee * 100).toFixed(1) + '%' : '(면제 💸)'}</span><b class="num">${won(r.fee)}원</b></div>
          <div class="kv"><span>받는 금액</span><b class="num">${won(get)}원</b></div>
          <div class="kv"><span>손익</span><b class="num ${cls(get - cost)}">${signed(get - cost)}원</b></div>
          ${note ? `<div class="alert info" style="margin:6px 0 0">${note}</div>` : ''}`;
        if (r.x > 0.01) html += `<div class="muted small" style="margin-top:6px">많이 팔면 파는 동안 가격이 내려가 (-${(-Math.expm1(-r.x) * 100).toFixed(1)}%)</div>`;
      }
    }
  } else html = '<div class="muted small">수량을 입력하거나 버튼을 눌러줘</div>';
  if (S.game.status !== 'running') html += `<div class="alert warn" style="margin:6px 0 0">지금은 거래할 수 없어 (${S.game.status === 'paused' ? '일시정지' : S.game.status === 'ended' ? '종료' : '시작 전'})</div>`;
  $('est').innerHTML = html;
  $('tradeBtn').disabled = !ok || S.busy;
}

$('tradeBtn').onclick = () => {
  const q = Math.floor(Number($('qty').value));
  if (!(q >= 1) || !S.sel) return;
  send(S.side, { s: S.sel, q });
  S.busy = true; $('tradeBtn').disabled = true;
  setTimeout(() => { S.busy = false; $('qty').value = ''; renderEst(); }, 700);
};

// ---------------- 2. 우리 팀 ----------------
function renderEffects() {
  if (!S.me) return;
  const a = T().act, chips = [];
  if (a.shield) chips.push('🛡️ 손실 방지 대기 중');
  if (a.double) chips.push('✖️2 수익 2배 대기 중');
  if (a.feeFreeUntil > now()) chips.push('💸 수수료 면제 ' + mmss(a.feeFreeUntil - now()));
  const html = chips.map(c => `<span class="chip" style="background:rgba(255,204,77,.15);color:var(--gold)">${c}</span>`).join('');
  if ($('effects').innerHTML !== html) $('effects').innerHTML = html;
}

function renderTeam() {
  if (!S.me) return;
  const t = T(), pr = P(), w = teamWorth(), inv = t.invested || S.cfg.startCash;
  const solvedN = Object.keys(t.solved).length;
  const sh = `<div class="kv" style="padding:0"><b style="font-size:17px">${esc(t.name)}</b>${t.status === 'out' ? '<span class="chip" style="background:rgba(255,77,94,.15);color:var(--up)">💥 파산</span>' : t.tourOut ? '<span class="chip">토너먼트 탈락</span>' : ''}</div>
    <div class="sumgrid num">
      <div><span>팀 총자산</span><b>${won(w)}원</b></div>
      <div><span>수익률</span><b class="${cls(w - inv)}">${pct((w - inv) / inv)}</b></div>
      <div><span>팀 현금</span><b class="${t.cash < 0 ? 'up' : ''}">${won(t.cash)}원</b></div>
      <div><span>주식 평가액</span><b>${won(w - t.cash)}원</b></div>
      <div><span>투자금 (${t.members.length}명)</span><b>${won(inv)}원</b></div>
      <div><span>푼 문제 범위</span><b>${solvedN}개</b></div>
    </div>`;
  if ($('teamSummary')._h !== sh) { $('teamSummary')._h = sh; $('teamSummary').innerHTML = sh; }
  renderEffects();

  const mh = `<div class="small" style="line-height:1.9">${t.members.map(n => `<span class="chip" style="margin:2px 2px 0 0;${n === S.me.name ? 'background:var(--accent)' : ''}">${esc(n)}</span>`).join('')}</div>`;
  if ($('memberBox')._h !== mh) { $('memberBox')._h = mh; $('memberBox').innerHTML = mh; }
  const hs = Object.entries(t.hold);
  const hh = hs.length ? hs.map(([id, h]) => {
    const st = stockOf(id), v = Math.round(h.q * pr[id]), c = Math.round(h.q * h.avg), pl = v - c;
    return `<div class="stock" data-s="${id}"><div><div class="nm"><i class="dot" style="background:${st.color}"></i>${esc(st.name)}</div><div class="sec">${won(h.q)}주 · 평균 ${won(h.avg)}원</div></div><div></div>
      <div class="px num"><div>${won(v)}원</div><div class="small ${cls(pl)}">${signed(pl)} (${pct(pl / c)})</div></div></div>`;
  }).join('') : '<div class="muted small" style="padding:14px 4px">팀이 보유한 주식이 없어. 주식 페이지에서 사봐!</div>';
  if ($('holdList')._h !== hh) { $('holdList')._h = hh; $('holdList').innerHTML = hh; $('holdList').querySelectorAll('.stock').forEach(el => el.onclick = () => openSheet(el.dataset.s)); }

  const lh = t.log.slice().reverse().map(l => `<div style="padding:5px 0;border-bottom:1px solid var(--line)">${esc(l)}</div>`).join('') || '<div class="muted">아직 기록 없음</div>';
  if ($('teamLog')._h !== lh) { $('teamLog')._h = lh; $('teamLog').innerHTML = lh; }

  const it = t.items;
  const memo = JSON.stringify([it, t.act.shield, t.act.double, t.status]);
  if ($('itemList').dataset.memo === memo) return;
  $('itemList').dataset.memo = memo;
  $('itemList').innerHTML = Object.keys(ITEMS).map(k => {
    const n = it[k] || 0, I = ITEMS[k];
    const on = (k === 'shield' && t.act.shield) || (k === 'double' && t.act.double);
    return `<div class="item" style="${n ? '' : 'opacity:.45'}"><div class="ico">${I.icon}</div>
      <div class="info"><b>${I.name}</b>${n ? `<span class="cnt">${n}</span>` : ''}<div>${I.desc}</div></div>
      <button class="btn ${n ? 'gold' : ''}" data-it="${k}" ${n && !on && t.status === 'active' ? '' : 'disabled'}>${on ? '켜짐' : '사용'}</button></div>`;
  }).join('');
  $('itemList').querySelectorAll('button[data-it]').forEach(b => b.onclick = () => {
    const k = b.dataset.it;
    const go = () => { send('use', { item: k }); b.disabled = true; setTimeout(() => { b.disabled = false; }, 1500); };
    if (k === 'swap') confirmBox('🔄 정말 수익률 교환할까? 무작위 다른 팀과 수익률이 맞바뀌어. 되돌릴 수 없어! (팀원들 동의 받았지?)', go);
    else go();
  });
}

function confirmBox(text, yes) {
  $('cfText').textContent = text; $('confirmModal').classList.remove('hidden');
  $('cfYes').onclick = () => { $('confirmModal').classList.add('hidden'); yes(); };
  $('cfNo').onclick = () => $('confirmModal').classList.add('hidden');
}

// ---------------- 3. 결투 ----------------
function myDuel() { return S.me && S.me.duel ? S.arena.duels && S.arena.duels[S.me.duel.id] : null; }

let arenaKey = '';
function renderArena() {
  if (!S.me) return;
  renderPips();
  const d = myDuel();
  const box = $('arenaMain');
  const queue = S.arena.queue || [], qteams = S.arena.qteams || [];
  const key = JSON.stringify([S.me.arena, S.me.duel, d, queue, T().status, S.game.status, S.cfg.duelStealPct]);
  if (key !== arenaKey) {
    arenaKey = key;
    if (S.me.arena === 'duel' && d) {
      const side = S.me.duel.side, op = side === 'a' ? 'b' : 'a';
      const myName = side === 'a' ? d.an : d.bn, opName = side === 'a' ? d.bn : d.an, opTeam = side === 'a' ? d.bt : d.at;
      const ms = d['s' + side], os = d['s' + op];
      const rounds = (d.rounds || []).map((r, i) => { const m = side === 'a' ? r[0] : r[1], o = side === 'a' ? r[1] : r[0]; return `<div class="rd">R${i + 1}<br><span class="${m > o ? 'w' : m < o ? 'l' : ''}">${m}</span> : ${o}</div>`; }).join('');
      let body = '';
      if (d.status === 'play') {
        const iPlayed = d['p' + side], oPlayed = d['p' + op];
        body = `<div class="muted small" style="text-align:center;margin-top:12px">라운드 ${d.round} / 5 · ${iPlayed ? '✅ 냈어! 상대 기다리는 중' : '카드 1장을 골라서 내!'} · 상대 ${oPlayed ? '✅ 냄' : '🤔 고민 중'}</div>
          <div class="timer"><div id="duelBar"></div></div>
          <div class="hand">${S.me.duel.hand.map((v, i) => `<button class="cardn ${S.me.duel.used[i] || iPlayed ? 'used' : ''}" data-i="${i}">${v}</button>`).join('')}</div>
          <p class="muted small" style="text-align:center">시간 안에 안 내면 아무 카드나 자동으로 나가</p>`;
      } else if (d.status === 'reward') {
        if (d.winner === side) {
          const its = Object.entries(d.loserItems || {}).filter(([, n]) => n > 0);
          body = `<div style="text-align:center;margin-top:14px;font-size:22px;font-weight:900">🏆 승리! 보상을 골라</div>
            <div class="timer"><div id="duelBar"></div></div>
            <button class="btn gold big" style="margin-top:12px" id="rwMoney">💰 ${esc(opName)} 몫의 ${S.cfg.duelStealPct}% (약 ${won(d.loserHalf)}원)</button>
            ${its.map(([k, n]) => `<button class="btn big" style="margin-top:8px" data-rw="${k}">${ITEMS[k].icon} ${ITEMS[k].name} 빼앗기 (상대 팀 ${n}개)</button>`).join('')}
            ${its.length ? '' : '<p class="muted small" style="text-align:center">상대 팀이 가진 아이템이 없어</p>'}
            <p class="muted small" style="text-align:center">안 고르면 자동으로 돈을 가져와. 보상은 우리 팀 거야!</p>`;
        } else body = `<div style="text-align:center;margin-top:14px;font-size:22px;font-weight:900">💀 패배…</div><p class="muted" style="text-align:center">상대가 보상을 고르는 중</p><div class="timer"><div id="duelBar"></div></div>`;
      }
      box.innerHTML = `<div class="arena-hero" style="padding:18px 14px">
        <div class="vs"><div><div class="nm">${esc(myName)} (나)</div><div class="small muted">${esc(T().name)}</div><div class="sc num">${ms}</div></div><div class="muted" style="font-weight:900">VS</div><div><div class="nm">${esc(opName)}</div><div class="small muted">${esc(opTeam)}</div><div class="sc num">${os}</div></div></div>
        <div class="rounds">${rounds}</div>${body}</div>`;
      box.querySelectorAll('.cardn').forEach(b => b.onclick = () => { send('duelPlay', { id: d.id, i: Number(b.dataset.i) }); box.querySelectorAll('.cardn').forEach(x => x.classList.add('used')); });
      const rm = $('rwMoney'); if (rm) rm.onclick = () => { send('duelReward', { id: d.id, choice: 'money' }); rm.disabled = true; };
      box.querySelectorAll('[data-rw]').forEach(b => b.onclick = () => { send('duelReward', { id: d.id, choice: 'item', item: b.dataset.rw }); b.disabled = true; });
    } else if (S.me.arena === 'queue') {
      box.innerHTML = `<div class="arena-hero"><div class="sw">⏳</div><div style="font-size:20px;font-weight:900;margin-top:6px">상대를 기다리는 중…</div>
        <p class="muted small">다른 팀 사람이 아레나에 들어오면 바로 결투가 시작돼</p>
        <button class="btn ghost" id="arLeave" style="margin-top:8px">아레나에서 나가기</button></div>`;
      $('arLeave').onclick = () => send('arenaLeave');
    } else {
      const can = T().status === 'active' && S.game.status === 'running';
      const others = queue.filter((_, i) => qteams[i] !== S.me.team);
      box.innerHTML = `<div class="arena-hero"><div class="sw">⚔️</div><div style="font-size:22px;font-weight:900;margin-top:4px">결투 아레나</div>
        <p class="muted small" style="line-height:1.6;margin:10px 0 14px">다른 팀 사람과 1:1! 서로 1~10 숫자 카드 5장을 받아.<br>5라운드 동안 1장씩 내고, 큰 숫자가 그 라운드 승리.<br>이긴 사람은 <b style="color:var(--gold)">상대 몫(팀 재산÷팀원 수)의 ${S.cfg.duelStealPct}%</b> 또는 <b style="color:var(--gold)">아이템 1개</b>를 우리 팀으로 가져와.</p>
        <button class="btn gold big" id="arJoin" ${can ? '' : 'disabled'}>⚔️ 아레나 입장</button>
        <p class="small" style="margin-top:10px;color:var(--sub)">${others.length ? `지금 <b style="color:var(--text)">${esc(others.join(', '))}</b> 님이 기다리는 중 — 들어가면 바로 결투!` : queue.length ? '우리 팀원만 기다리는 중 — 들어가면 다른 팀을 같이 기다려' : '지금 기다리는 사람 없음 — 먼저 들어가서 기다릴 수 있어'}</p></div>`;
      const j = $('arJoin'); if (j) j.onclick = () => { send('arenaJoin'); j.disabled = true; };
    }
  }
  updateDuelTimer();
  const ds = Object.values(S.arena.duels || {});
  const dl = ds.length ? ds.map(x => `<div class="kv"><span>${esc(x.an)}<span class="muted small">(${esc(x.at)})</span> <b style="color:var(--text)">${x.sa}:${x.sb}</b> ${esc(x.bn)}<span class="muted small">(${esc(x.bt)})</span></span><b class="small">${x.status === 'play' ? `R${x.round}/5` : x.status === 'reward' ? '보상 선택 중' : esc(x.result || '끝')}</b></div>`).join('') : '<div class="muted small" style="padding:6px 0">없음</div>';
  if ($('duelList')._h !== dl) { $('duelList')._h = dl; $('duelList').innerHTML = dl; }
}

function updateDuelTimer() {
  const d = myDuel(), bar = $('duelBar'); if (!d || !bar) return;
  const total = d.status === 'reward' ? S.cfg.rewardSec * 1000 : S.cfg.duelRoundSec * 1000;
  const end = d.status === 'reward' ? d.rewardDeadline : d.deadline;
  bar.style.width = Math.max(0, Math.min(100, (end - now()) / total * 100)) + '%';
}

// ---------------- 4. 문제 ----------------
// 카드는 한 번만 만들고 상태만 바꿔서, 답 입력 중에 칸이 지워지지 않게 함
function renderProblems() {
  if (!S.me) return;
  const list = S.probs.list || [], tries = S.probs.tries || 3, t = T();
  const totalParts = list.reduce((n, p) => n + p.parts.length, 0);
  const mySolved = list.reduce((n, p) => n + p.parts.filter((_, k) => t.solved[p.id + '_' + k]).length, 0);
  const head = list.length
    ? `공개된 문제 <b style="color:var(--text)">${list.length}개</b> · 우리 팀 <b style="color:var(--good)">${mySolved}/${totalParts}</b> 범위 해결<br>범위 하나 풀 때마다 <b style="color:var(--gold)">팀 아이템 1개</b> · 제한시간 없음 · 범위마다 팀 전체 <b style="color:var(--text)">${tries}번</b>까지`
    : '아직 공개된 문제가 없어. 운영자가 문제를 공개하면 여기 나와!<br>범위 하나 풀 때마다 팀 아이템 1개 · 제한시간 없음';
  if ($('probHead')._h !== head) { $('probHead')._h = head; $('probHead').innerHTML = head; }
  const box = $('probList');
  for (const p of list) {
    let card = box.querySelector(`.prob[data-id="${p.id}"]`);
    if (!card) {
      card = document.createElement('div'); card.className = 'prob'; card.dataset.id = p.id;
      card.innerHTML = `<div class="prob-h"><b>${p.n}. ${esc(p.title)}</b><span class="chip ps"></span></div>
        <div class="prob-body">${esc(p.body)}</div>
        ${p.parts.map((pt, k) => `<div class="part" data-k="${k}">
          <div class="part-h"><span class="lab">${p.parts.length > 1 ? esc(pt.label) : '정답'}</span><span class="st small"></span></div>
          ${pt.opts ? `<div class="opts">${pt.opts.map((o, i) => `<button data-i="${i}"><b style="color:var(--accent)">${i + 1}</b> ${esc(o)}</button>`).join('')}</div>`
          : `<form><input placeholder="답 입력" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="btn primary" style="flex:none">제출</button></form>`}
          <div class="muted small others" style="margin-top:4px"></div></div>`).join('')}`;
      card.querySelectorAll('.part').forEach(row => {
        const k = Number(row.dataset.k);
        const submit = (a) => {
          if (S.game.status === 'ended') return toast('게임이 끝났어', 'bad');
          send('answer', { pid: p.id, part: k, a: String(a) });
          row.querySelectorAll('button, input').forEach(x => x.disabled = true);
          setTimeout(() => row.querySelectorAll('button, input').forEach(x => { x.disabled = false; }), 1500);
        };
        const f = row.querySelector('form');
        if (f) f.onsubmit = (e) => { e.preventDefault(); const inp = f.querySelector('input'); const v = inp.value.trim(); if (!v) return; submit(v); inp.value = ''; inp.blur(); };
        row.querySelectorAll('.opts button').forEach(b => b.onclick = () => submit(b.dataset.i));
      });
      // 새 문제는 위에 (최신 문제가 먼저)
      box.insertBefore(card, box.firstChild);
    }
    // 상태 갱신
    let done = 0;
    p.parts.forEach((pt, k) => {
      const row = card.querySelector(`.part[data-k="${k}"]`), key = p.id + '_' + k;
      const solved = !!t.solved[key], used = t.tries[key] || 0, dead = !solved && used >= tries;
      if (solved) done++;
      row.classList.toggle('done', solved); row.classList.toggle('dead', dead);
      const st = solved ? '<span class="st-ok">✅ 해결! 🎁</span>' : dead ? '<span class="st-dead">❌ 기회 다 씀</span>' : `남은 기회 <b>${tries - used}</b>/${tries}`;
      const stEl = row.querySelector('.st'); if (stEl._h !== st) { stEl._h = st; stEl.innerHTML = st; }
      const oth = pt.solved ? `🏁 ${pt.solved}팀 해결` : '아직 아무도 못 풂';
      const oEl = row.querySelector('.others'); if (oEl.textContent !== oth) oEl.textContent = oth;
    });
    const ps = card.querySelector('.ps');
    const pst = `${done}/${p.parts.length}`;
    if (ps.textContent !== pst) { ps.textContent = pst; ps.style.background = done === p.parts.length ? 'rgba(47,213,138,.2)' : ''; ps.style.color = done === p.parts.length ? 'var(--good)' : ''; }
  }
  // 운영자가 문제를 지우거나 초기화한 경우
  box.querySelectorAll('.prob').forEach(c => { if (!list.some(p => p.id === c.dataset.id)) c.remove(); });
}

// ---------------- 5. 순위 ----------------
const fr = (x) => x <= -900 ? '파산' : pct(x);
function myMatch() {
  const tr = S.tour; if (!tr || !S.me || tr.status !== 'running') return null;
  const r = tr.rounds[tr.round]; if (!r) return null;
  const m = r.ms.find(m => m.ta === S.me.team || m.tb === S.me.team);
  return m ? { m, label: r.label, side: m.ta === S.me.team ? 'a' : 'b' } : null;
}
function renderTourBox() {
  const el = $('tourBox'); if (!S.me) return;
  const tr = S.tour, mm = myMatch();
  let html = '';
  if (mm) {
    const { m, label, side } = mm;
    if (!m.tb) html = `<div class="alert info" style="margin:0">🏟 ${esc(label)}: 부전승! 이번 라운드는 쉬어</div>`;
    else {
      const my = side === 'a' ? m.ra : m.rb, op = side === 'a' ? m.rb : m.ra, opN = side === 'a' ? m.b : m.a;
      const lead = my > op ? '앞서는 중 🔥' : my < op ? '뒤지는 중 😰' : '동점';
      html = `<div class="card" style="padding:12px 14px;border:1px solid ${my >= op ? 'rgba(47,213,138,.4)' : 'rgba(255,77,94,.4)'}">
        <div class="kv" style="padding:0"><span>🏟 ${esc(label)} vs <b style="color:var(--text)">${esc(opN)}</b></span><b class="num">⏱ <span class="tourTime">-</span></b></div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;font-weight:900">
          <span class="num ${cls(my)}" style="font-size:20px">${fr(my)}</span><span class="small" style="color:${my >= op ? 'var(--good)' : 'var(--up)'}">${lead}</span><span class="num ${cls(op)}" style="font-size:20px">${fr(op)}</span></div>
        <div class="muted small" style="margin-top:2px">이번 라운드 수익률 (우리 vs 상대)</div></div>`;
    }
  } else if (tr && tr.status === 'running' && T().tourOut) html = `<div class="alert warn" style="margin:0">🏟 토너먼트에선 탈락했지만 순위(수익률)는 계속 올릴 수 있어!</div>`;
  else if (tr && tr.status === 'done' && tr.champ) html = `<div class="alert info" style="margin:0">🏆 토너먼트 우승: ${esc(tr.champ)}${tr.champId === S.me.team ? ' — 우리 팀이야!! 🎉' : ''}</div>`;
  if (el._h !== html) { el._h = html; el.innerHTML = html; renderTimers(); }
}

function renderTour() {
  if (!S.me) return;
  const tr = S.tour, box = $('tourMain');
  let html = '';
  if (!tr) html = `<div class="card muted small" style="line-height:1.6">운영자가 토너먼트를 시작하면 랜덤으로 대진이 짜여.<br>라운드마다 두 팀씩 붙어서 <b style="color:var(--gold)">그 라운드 동안 수익률</b>이 높은 팀이 올라가!</div>`;
  else {
    if (tr.status === 'done') html += `<div class="card" style="text-align:center;margin-bottom:12px;background:linear-gradient(160deg,#ffcc4d,#d18a00);color:#2a1e00"><div style="font-size:30px">🏆</div><b style="font-size:19px">${tr.champ ? '우승: ' + esc(tr.champ) : '토너먼트 미완료'}</b></div>`;
    else html += `<div class="muted small" style="margin-bottom:6px">라운드당 약 ${Math.round(tr.len / 6000) / 10}분 · 이번 라운드 남은 시간 <b style="color:var(--text)" class="tourTime">-</b></div>`;
    tr.rounds.slice().reverse().forEach((r, ri) => {
      const idx = tr.rounds.length - 1 - ri, cur = tr.status === 'running' && idx === tr.round;
      html += `<div class="small" style="font-weight:800;margin:12px 0 6px">${esc(r.label)} ${cur ? '<span class="chip" style="background:var(--good);color:#002814">진행 중</span>' : ''}</div><div class="card" style="padding:4px 12px">`;
      html += r.ms.map(m => {
        const mine = m.ta === S.me.team || m.tb === S.me.team;
        const hl = mine ? 'background:rgba(124,108,255,.15);margin:0 -12px;padding:10px 12px;' : '';
        const nameA = `<span style="${m.w === 'a' ? 'color:var(--gold);font-weight:900' : m.w === 'b' ? 'opacity:.45;text-decoration:line-through' : ''}">${esc(m.a)}</span>`;
        if (!m.tb) return `<div class="kv" style="padding:10px 0;${hl}"><span>${nameA}</span><span class="muted small">부전승</span></div>`;
        const nameB = `<span style="${m.w === 'b' ? 'color:var(--gold);font-weight:900' : m.w === 'a' ? 'opacity:.45;text-decoration:line-through' : ''}">${esc(m.b)}</span>`;
        return `<div style="display:grid;grid-template-columns:1fr auto 1fr;gap:6px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line);${hl}">
          <div>${nameA}<div class="small num ${cls(m.ra)}">${fr(m.ra)}</div></div><b class="muted small">VS</b><div style="text-align:right">${nameB}<div class="small num ${cls(m.rb)}">${fr(m.rb)}</div></div></div>`;
      }).join('') + '</div>';
    });
    if (tr.status === 'running') html += '<p class="muted small" style="text-align:center;margin-top:8px">다음 라운드 대진은 이번 라운드가 끝나면 정해져</p>';
  }
  if (box._h !== html) { box._h = html; box.innerHTML = html; renderTimers(); }
}

function renderRank() {
  if (!S.me) return;
  const list = (S.lb && S.lb.list) || [];
  const fb2 = S.game.status === 'ended' ? `<div class="card" style="text-align:center;margin-bottom:12px;background:linear-gradient(160deg,#ffcc4d,#d18a00);color:#2a1e00"><b style="font-size:18px">🏁 게임 종료! 최종 팀 순위</b></div>` : '';
  if ($('finalBanner')._h !== fb2) { $('finalBanner')._h = fb2; $('finalBanner').innerHTML = fb2; }
  const rl = list.map((r, i) => `<div class="rank ${r[5] === S.me.team ? 'me' : ''}"><div class="no">${i < 3 && !r[2] ? ['🥇', '🥈', '🥉'][i] : i + 1}</div>
    <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r[0])} <span class="muted small">${r[4]}명</span>${r[2] ? ' <span class="chip" style="background:rgba(255,77,94,.15);color:var(--up)">파산</span>' : ''}</div>
    <div class="w num"><span class="${cls(r[3])}">${pct(r[3])}</span><div class="small muted">${won(r[1])}원</div></div></div>`).join('') || '<div class="muted small" style="padding:14px">아직 없음</div>';
  if ($('rankList')._h !== rl) { $('rankList')._h = rl; $('rankList').innerHTML = rl; }
}

boot();
