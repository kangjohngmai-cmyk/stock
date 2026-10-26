import { fb } from './fb.js';
import { GAME_TITLE } from './config.js';
import { STOCKS, ITEMS, DEFAULT_CFG, execBuy, execSell, maxBuyQty, worthOf, won, signed, pct } from './shared.js';
import { $, esc, cls, mmss, toast, drawLine } from './ui.js';

const S = {
  uid: null, me: undefined, cfg: { ...DEFAULT_CFG }, game: { status: 'lobby' }, prices: null, prevP: {},
  hist: [], news: [], lb: null, quiz: null, quizLast: null, arena: { queue: [], duels: {} },
  offset: 0, connected: true, loadT: Date.now(), tab: 'market', sel: null, side: 'buy', range: 150,
  answered: new Set(), quizHidden: null, seenQuizLast: null, busy: false, lastNewsKey: null,
};
const now = () => Date.now() + S.offset;
const P = () => (S.prices && S.prices.p) || Object.fromEntries(STOCKS.map(s => [s.id, s.p0]));
const OPEN = () => (S.prices && S.prices.open) || Object.fromEntries(STOCKS.map(s => [s.id, s.p0]));
document.title = GAME_TITLE; $('joinTitle').textContent = GAME_TITLE;

try { S.answered = new Set(JSON.parse(localStorage.getItem('answered') || '[]')); } catch {}

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
    const first = S.me === undefined;
    S.me = v;
    if (first || !v) showView();
    if (v) { showView(); renderAll(); }
  });
  fb.on('config', v => { if (v) S.cfg = { ...DEFAULT_CFG, ...v }; renderAll(); });
  fb.on('game', v => { S.game = v || { status: 'lobby' }; renderAll(); });
  fb.on('market/prices', v => {
    if (!v) return;
    S.prevP = S.prices ? S.prices.p : {};
    S.prices = v; renderMarket(true); renderTop(); renderMe(); if (S.sel) renderSheet();
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
  fb.on('leaderboard', v => { S.lb = v; renderTop(); if (S.tab === 'rank') renderRank(); });
  fb.on('quiz/current', v => { S.quiz = v; renderQuiz(); });
  fb.on('quiz/last', v => {
    S.quizLast = v;
    if (v && S.seenQuizLast !== null && S.seenQuizLast !== v.id) toast(`🧠 퀴즈 ${v.n} 정답: ${v.ans} (정답자 ${v.correct}명)`, 'item', 6000);
    S.seenQuizLast = v ? v.id : '';
  });
  fb.on('arena', v => { S.arena = { queue: [], duels: {}, ...(v || {}) }; renderArena(); });
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
  if (!name) { $('joinMsg').textContent = '닉네임을 입력해줘'; return; }
  if (S.game.status === 'ended') { $('joinMsg').textContent = '게임이 이미 끝났어'; return; }
  $('joinBtn').disabled = true; $('joinMsg').textContent = '';
  S.loadT = Date.now() - 1000;
  send('join', { name });
  setTimeout(() => { $('joinBtn').disabled = false; if (!S.me) $('joinMsg').textContent = '응답이 없어… 운영자 화면이 켜져 있는지 확인해줘'; }, 6000);
};

function send(type, data = {}) {
  if (!S.uid) return;
  fb.push('requests', { uid: S.uid, type, ...data, t: fb.TS() }).catch(e => toast('전송 실패: ' + e.message, 'bad'));
  if (type === 'join') {
    // 입장 전에는 토스트 대신 입장 화면에 표시
    const unsub = fb.onAdded('inbox/' + S.uid, 1, (k, v) => { if (!S.me && v && v.kind === 'bad' && v.t > S.loadT) $('joinMsg').textContent = v.text; });
    setTimeout(() => unsub && unsub(), 8000);
  }
}

// ---------------- 탭 ----------------
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  S.tab = b.dataset.tab;
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  for (const t of ['market', 'me', 'arena', 'rank']) $('tab-' + t).classList.toggle('hidden', t !== S.tab);
  renderAll(); window.scrollTo(0, 0);
});

// ---------------- 렌더 ----------------
function renderAll() { if (!S.me) return; renderTop(); renderAlerts(); renderNewsbar(); renderMarket(false); renderMe(); renderArena(); renderRank(); renderQuiz(); }

function myWorth() { return S.me ? worthOf(S.me, P()) : 0; }

function renderTop() {
  if (!S.me) return;
  const w = myWorth(), pl = w - S.cfg.startCash;
  $('meName').textContent = S.me.name;
  $('worth').textContent = won(w) + '원';
  $('worth').className = 'worth num ' + (S.me.status === 'out' ? 'down' : '');
  $('worthPl').innerHTML = `<b class="${cls(pl)}">${signed(pl)}원 (${pct(pl / S.cfg.startCash)})</b>`;
  $('cash').textContent = won(S.me.cash); $('cash').style.color = S.me.cash < 0 ? 'var(--up)' : 'var(--text)';
  $('stockVal').textContent = won(w - S.me.cash);
  const st = S.game.status;
  $('statusChip').textContent = { lobby: '⏳ 시작 전', running: '🟢 거래 중', paused: '⏸ 일시정지', ended: '🏁 종료' }[st] || st;
  if (S.lb && S.lb.list) {
    const i = S.lb.list.findIndex(r => r[0] === S.me.name);
    $('rankChip').textContent = i >= 0 ? `🏆 ${i + 1}위 / ${S.lb.list.length}명` : '-위';
  }
}

function renderTimers() {
  const g = S.game;
  if (g.status === 'running') $('timeChip').textContent = '⏱ ' + mmss(g.endAt - now());
  else if (g.status === 'paused') $('timeChip').textContent = '⏸ ' + mmss(g.endAt - g.pausedAt);
  else $('timeChip').textContent = g.status === 'ended' ? '끝' : '--:--';
  if (S.quiz && !$('quizModal').classList.contains('hidden')) {
    const left = S.quiz.endsAt - now();
    $('qTime').textContent = '⏱ ' + mmss(left);
    $('qBar').style.width = Math.max(0, Math.min(100, left / (S.cfg.quizSec * 1000) * 100)) + '%';
    if (left < -1500) $('quizModal').classList.add('hidden');
  }
  if (S.tab === 'arena') updateDuelTimer();
  renderAlerts();
  renderEffects();
}

let lastAlerts = '';
function renderAlerts() {
  if (!S.me) return;
  const a = [];
  if (!S.connected) a.push(['bad', '📡 인터넷 연결이 끊겼어. 다시 연결 중…']);
  else if (S.game.status === 'running' && S.prices && now() - S.prices.t > 12000) a.push(['warn', '⚠️ 운영자 서버가 응답이 없어. 잠깐 기다려줘']);
  if (S.me.status === 'out') a.push(['bad', '💥 파산해서 아웃됐어. 랭킹과 시장은 계속 볼 수 있어.']);
  else if (S.me.cash < 0) a.push(['warn', `⚠️ 빚 ${won(-S.me.cash)}원 · 총자산이 ${won(S.cfg.outLine)}원 이하가 되면 파산`]);
  if (S.game.status === 'lobby') a.push(['info', '⏳ 아직 시작 전이야. 운영자가 시작하면 거래할 수 있어.']);
  if (S.me.preview && S.me.preview.at > now()) a.push(['info', `📰 미리보기: "${S.me.preview.text}" (${mmss(S.me.preview.at - now())} 후)`]);
  const html = a.map(([k, t]) => `<div class="alert ${k}">${esc(t)}</div>`).join('');
  if (html !== lastAlerts) { $('alerts').innerHTML = html; lastAlerts = html; }
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

function renderMarket(flash) {
  if (!S.me) return;
  const pr = P(), op = OPEN();
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
    const h = S.me.hold && S.me.hold[s.id];
    el.querySelector('.hq').textContent = h ? `· ${won(h.q)}주 보유` : '';
    if (flash && S.prevP[s.id] && Math.abs(p / S.prevP[s.id] - 1) > 0.004) {
      el.classList.remove('flash-up', 'flash-down'); void el.offsetWidth; el.classList.add(p > S.prevP[s.id] ? 'flash-up' : 'flash-down');
    }
    if (!flash || !el._drawn) { drawLine(el.querySelector('canvas'), series(s.id, 90), { base: op[s.id], width: 1.6 }); el._drawn = true; }
  }
}

// ---------------- 종목 상세/매매 ----------------
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
function feeNow() { return S.me && S.me.act && S.me.act.feeFreeUntil > now() ? 0 : S.cfg.feeRate; }
function depth(st) { return st.depth * (S.cfg.impactScale || 1); }

function renderSheet() {
  if (!S.sel || !S.me) return;
  const st = stockOf(S.sel), p = P()[S.sel], ch = p / OPEN()[S.sel] - 1;
  $('sName').innerHTML = `<i class="dot" style="background:${st.color}"></i> ${esc(st.name)}`;
  $('sSec').textContent = st.sector + ' · 변동성 ' + (st.vol >= 4 ? '매우 높음' : st.vol >= 2.5 ? '높음' : st.vol >= 1.8 ? '보통' : '낮음');
  $('sPrice').textContent = won(p) + '원'; $('sPrice').className = 'num ' + cls(ch);
  $('sChg').innerHTML = `<span class="${cls(ch)}">${signed(p - OPEN()[S.sel])} (${pct(ch)})</span> <span class="muted">시작가 대비</span>`;
  const h = S.me.hold && S.me.hold[S.sel];
  if (h) {
    const val = Math.round(h.q * p), cost = Math.round(h.q * h.avg), pl = val - cost;
    $('sHold').innerHTML = `<div class="kv"><span>보유</span><b class="num">${won(h.q)}주</b></div><div class="kv"><span>평균 매수가</span><b class="num">${won(h.avg)}원</b></div><div class="kv"><span>평가 손익</span><b class="num ${cls(pl)}">${signed(pl)}원 (${pct(pl / cost)})</b></div>`;
  } else $('sHold').innerHTML = '<div class="muted small">아직 이 종목은 없어</div>';

  const fee = feeNow(), L = depth(st);
  const cashMax = maxBuyQty(p, L, fee, S.me.cash);
  const credMax = maxBuyQty(p, L, fee, S.me.cash + S.cfg.creditLimit);
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
  const st = stockOf(S.sel), p = P()[S.sel], q = Math.floor(Number($('qty').value));
  const fee = feeNow(), L = depth(st), act = S.me.act || {};
  let html = '', ok = q >= 1 && S.me.status === 'active' && S.game.status === 'running';
  if (q >= 1) {
    if (S.side === 'buy') {
      const r = execBuy(p, q, L, fee);
      const after = S.me.cash - r.total;
      html = `<div class="kv"><span>예상 평균 체결가</span><b class="num">${won(r.avgPx)}원</b></div>
        <div class="kv"><span>수수료 ${fee ? (fee * 100).toFixed(1) + '%' : '(면제 💸)'}</span><b class="num">${won(r.fee)}원</b></div>
        <div class="kv"><span>총 결제 금액</span><b class="num">${won(r.total)}원</b></div>
        <div class="kv"><span>매수 후 현금</span><b class="num ${after < 0 ? 'up' : ''}">${won(after)}원</b></div>`;
      if (after < -S.cfg.creditLimit) { html += `<div class="alert bad" style="margin:6px 0 0">빚 한도(${won(S.cfg.creditLimit)}원)를 넘어</div>`; ok = false; }
      else if (after < 0) html += `<div class="alert warn" style="margin:6px 0 0">⚠️ ${won(-after)}원을 빚지고 사는 거야</div>`;
      if (r.x > 0.01) html += `<div class="muted small" style="margin-top:6px">많이 사면 내가 사는 동안 가격이 올라가 (+${(Math.expm1(r.x) * 100).toFixed(1)}%)</div>`;
    } else {
      const h = S.me.hold && S.me.hold[S.sel];
      if (!h || h.q < q) { html = '<div class="alert bad" style="margin:0">갖고 있는 것보다 많이 팔 수 없어</div>'; ok = false; }
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

// ---------------- 내 자산 ----------------
function renderEffects() {
  if (!S.me || S.tab !== 'me') return;
  const a = S.me.act || {}, chips = [];
  if (a.shield) chips.push('🛡️ 손실 방지 대기 중');
  if (a.double) chips.push('✖️2 수익 2배 대기 중');
  if (a.feeFreeUntil > now()) chips.push('💸 수수료 면제 ' + mmss(a.feeFreeUntil - now()));
  const html = chips.map(c => `<span class="chip" style="background:rgba(255,204,77,.15);color:var(--gold)">${c}</span>`).join('');
  if ($('effects').innerHTML !== html) $('effects').innerHTML = html;
}

function renderMe() {
  if (!S.me || S.tab !== 'me') return;
  const pr = P();
  const hs = Object.entries(S.me.hold || {});
  $('holdList').innerHTML = hs.length ? hs.map(([id, h]) => {
    const st = stockOf(id), v = Math.round(h.q * pr[id]), c = Math.round(h.q * h.avg), pl = v - c;
    return `<div class="stock" data-s="${id}"><div><div class="nm"><i class="dot" style="background:${st.color}"></i>${esc(st.name)}</div><div class="sec">${won(h.q)}주 · 평균 ${won(h.avg)}원</div></div><div></div>
      <div class="px num"><div>${won(v)}원</div><div class="small ${cls(pl)}">${signed(pl)} (${pct(pl / c)})</div></div></div>`;
  }).join('') : '<div class="muted small" style="padding:14px 4px">보유한 주식이 없어. 시장 탭에서 사봐!</div>';
  $('holdList').querySelectorAll('.stock').forEach(el => el.onclick = () => openSheet(el.dataset.s));

  const it = S.me.items || {};
  const keys = Object.keys(ITEMS);
  const memo = JSON.stringify([it, S.me.act?.shield, S.me.act?.double, S.me.status]);
  if ($('itemList').dataset.memo === memo) return;
  $('itemList').dataset.memo = memo;
  $('itemList').innerHTML = keys.map(k => {
    const n = it[k] || 0, I = ITEMS[k];
    const on = (k === 'shield' && S.me.act?.shield) || (k === 'double' && S.me.act?.double);
    return `<div class="item" style="${n ? '' : 'opacity:.45'}"><div class="ico">${I.icon}</div>
      <div class="info"><b>${I.name}</b>${n ? `<span class="cnt">${n}</span>` : ''}<div>${I.desc}</div></div>
      <button class="btn ${n ? 'gold' : ''}" data-it="${k}" ${n && !on && S.me.status === 'active' ? '' : 'disabled'}>${on ? '켜짐' : '사용'}</button></div>`;
  }).join('');
  $('itemList').querySelectorAll('button[data-it]').forEach(b => b.onclick = () => {
    const k = b.dataset.it;
    const go = () => { send('use', { item: k }); b.disabled = true; setTimeout(() => { b.disabled = false; }, 1500); };
    if (k === 'swap') confirmBox('🔄 정말 자산 교환할까? 내 현금+주식이 무작위 1명 것과 통째로 바뀌어. 되돌릴 수 없어!', go);
    else go();
  });
}

function confirmBox(text, yes) {
  $('cfText').textContent = text; $('confirmModal').classList.remove('hidden');
  $('cfYes').onclick = () => { $('confirmModal').classList.add('hidden'); yes(); };
  $('cfNo').onclick = () => $('confirmModal').classList.add('hidden');
}

// ---------------- 아레나 ----------------
function myDuel() { return S.me && S.me.duel ? S.arena.duels && S.arena.duels[S.me.duel.id] : null; }

function renderArena() {
  if (!S.me) return;
  const d = myDuel();
  $('arenaPip').classList.toggle('hidden', !(S.me.arena === 'duel' && S.tab !== 'arena'));
  if (S.tab !== 'arena') return;
  const box = $('arenaMain');
  const queue = S.arena.queue || [];
  if (S.me.arena === 'duel' && d) {
    const side = S.me.duel.side, op = side === 'a' ? 'b' : 'a';
    const myName = side === 'a' ? d.an : d.bn, opName = side === 'a' ? d.bn : d.an;
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
      const iWon = d.winner === side;
      if (iWon) {
        const its = Object.entries(d.loserItems || {}).filter(([, n]) => n > 0);
        body = `<div style="text-align:center;margin-top:14px;font-size:22px;font-weight:900">🏆 승리! 보상을 골라</div>
          <div class="timer"><div id="duelBar"></div></div>
          <button class="btn gold big" style="margin-top:12px" id="rwMoney">💰 상대 재산 절반 (약 ${won(d.loserHalf)}원)</button>
          ${its.map(([k, n]) => `<button class="btn big" style="margin-top:8px" data-rw="${k}">${ITEMS[k].icon} ${ITEMS[k].name} 빼앗기 (상대 ${n}개)</button>`).join('')}
          ${its.length ? '' : '<p class="muted small" style="text-align:center">상대가 가진 아이템이 없어</p>'}
          <p class="muted small" style="text-align:center">안 고르면 자동으로 재산 절반을 가져와</p>`;
      } else body = `<div style="text-align:center;margin-top:14px;font-size:22px;font-weight:900">💀 패배…</div><p class="muted" style="text-align:center">상대가 보상을 고르는 중</p><div class="timer"><div id="duelBar"></div></div>`;
    }
    box.innerHTML = `<div class="arena-hero" style="padding:18px 14px">
      <div class="vs"><div><div class="nm">${esc(myName)} (나)</div><div class="sc num">${ms}</div></div><div class="muted" style="font-weight:900">VS</div><div><div class="nm">${esc(opName)}</div><div class="sc num">${os}</div></div></div>
      <div class="rounds">${rounds}</div>${body}</div>`;
    box.querySelectorAll('.cardn').forEach(b => b.onclick = () => { send('duelPlay', { id: d.id, i: Number(b.dataset.i) }); box.querySelectorAll('.cardn').forEach(x => x.classList.add('used')); });
    const rm = $('rwMoney'); if (rm) rm.onclick = () => { send('duelReward', { id: d.id, choice: 'money' }); rm.disabled = true; };
    box.querySelectorAll('[data-rw]').forEach(b => b.onclick = () => { send('duelReward', { id: d.id, choice: 'item', item: b.dataset.rw }); b.disabled = true; });
    updateDuelTimer();
  } else if (S.me.arena === 'queue') {
    box.innerHTML = `<div class="arena-hero"><div class="sw">⏳</div><div style="font-size:20px;font-weight:900;margin-top:6px">상대를 기다리는 중…</div>
      <p class="muted small">누군가 아레나에 들어오면 바로 결투가 시작돼</p>
      <button class="btn ghost" id="arLeave" style="margin-top:8px">아레나에서 나가기</button></div>`;
    $('arLeave').onclick = () => send('arenaLeave');
  } else {
    const can = S.me.status === 'active' && S.game.status === 'running';
    box.innerHTML = `<div class="arena-hero"><div class="sw">⚔️</div><div style="font-size:22px;font-weight:900;margin-top:4px">결투 아레나</div>
      <p class="muted small" style="line-height:1.6;margin:10px 0 14px">서로 1~10 숫자 카드 5장을 받아.<br>5라운드 동안 매번 1장씩 내고, 큰 숫자가 그 라운드 승리!<br>더 많이 이긴 사람이 <b style="color:var(--gold)">상대 재산 절반</b> 또는 <b style="color:var(--gold)">아이템 1개</b>를 가져가.</p>
      <button class="btn gold big" id="arJoin" ${can ? '' : 'disabled'}>⚔️ 아레나 입장</button>
      <p class="small" style="margin-top:10px;color:var(--sub)">${queue.length ? `지금 <b style="color:var(--text)">${esc(queue.join(', '))}</b> 님이 기다리는 중 — 들어가면 바로 결투!` : '지금 기다리는 사람 없음 — 먼저 들어가서 기다릴 수 있어'}</p></div>`;
    const j = $('arJoin'); if (j) j.onclick = () => { send('arenaJoin'); j.disabled = true; };
  }
  const ds = Object.values(S.arena.duels || {});
  $('duelList').innerHTML = ds.length ? ds.map(x => `<div class="kv"><span>${esc(x.an)} <b style="color:var(--text)">${x.sa}:${x.sb}</b> ${esc(x.bn)}</span><b class="small">${x.status === 'play' ? `R${x.round}/5` : x.status === 'reward' ? '보상 선택 중' : esc(x.result || '끝')}</b></div>`).join('') : '<div class="muted small" style="padding:6px 0">없음</div>';
}

function updateDuelTimer() {
  const d = myDuel(), bar = $('duelBar'); if (!d || !bar) return;
  const total = d.status === 'reward' ? S.cfg.rewardSec * 1000 : S.cfg.duelRoundSec * 1000;
  const end = d.status === 'reward' ? d.rewardDeadline : d.deadline;
  bar.style.width = Math.max(0, Math.min(100, (end - now()) / total * 100)) + '%';
}

// ---------------- 랭킹 ----------------
function renderRank() {
  if (!S.me || S.tab !== 'rank') return;
  const list = (S.lb && S.lb.list) || [];
  $('finalBanner').innerHTML = S.game.status === 'ended' ? `<div class="card" style="text-align:center;margin-bottom:12px;background:linear-gradient(160deg,#ffcc4d,#d18a00);color:#2a1e00"><div style="font-size:34px">🏁</div><b style="font-size:20px">게임 종료! 최종 순위</b></div>` : '';
  $('rankList').innerHTML = list.map((r, i) => `<div class="rank ${r[0] === S.me.name ? 'me' : ''}"><div class="no">${i < 3 && !r[2] ? ['🥇', '🥈', '🥉'][i] : i + 1}</div>
    <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r[0])}${r[2] ? ' <span class="chip" style="background:rgba(255,77,94,.15);color:var(--up)">파산</span>' : ''}</div>
    <div class="w num ${cls(r[1] - S.cfg.startCash)}">${won(r[1])}원</div></div>`).join('') || '<div class="muted small" style="padding:14px">아직 없음</div>';
}

// ---------------- 퀴즈 ----------------
function renderQuiz() {
  const z = S.quiz, m = $('quizModal');
  if (!z || !S.me || S.answered.has(z.id) || S.quizHidden === z.id || z.endsAt < now() - 1000) { m.classList.add('hidden'); return; }
  if (!m.classList.contains('hidden') && m.dataset.id === z.id) return;
  m.dataset.id = z.id;
  $('qNo').textContent = z.n + '번';
  $('qText').textContent = z.q;
  const opts = z.opts;
  $('qOpts').innerHTML = opts ? opts.map((o, i) => `<button class="opt" data-i="${i}"><b>${i + 1}</b>${esc(o)}</button>`).join('') : '';
  $('qForm').classList.toggle('hidden', !!opts); $('qInput').value = '';
  $('qOpts').querySelectorAll('.opt').forEach(b => b.onclick = () => answer(z.id, b.dataset.i));
  m.classList.remove('hidden');
  navigator.vibrate && navigator.vibrate([80, 60, 80]);
  if (!opts) setTimeout(() => $('qInput').focus(), 200);
  renderTimers();
}
function answer(id, a) {
  if (S.answered.has(id)) return;
  S.answered.add(id);
  try { localStorage.setItem('answered', JSON.stringify([...S.answered].slice(-50))); } catch {}
  send('quizAnswer', { id, a: String(a) });
  $('quizModal').classList.add('hidden');
  toast('답 제출! 결과를 기다리는 중…', 'info', 1500);
}
$('qForm').onsubmit = (e) => { e.preventDefault(); const v = $('qInput').value.trim(); if (v && S.quiz) answer(S.quiz.id, v); };
$('qSkip').onclick = () => { if (S.quiz) S.quizHidden = S.quiz.id; $('quizModal').classList.add('hidden'); toast('퀴즈는 시간 안에 위쪽 배너를 눌러서 다시 열 수 있어', 'info'); renderAlerts(); };

// 숨긴 퀴즈 다시 열기 배너
setInterval(() => {
  const z = S.quiz;
  let el = document.getElementById('quizReopen');
  const show = z && S.me && S.quizHidden === z.id && !S.answered.has(z.id) && z.endsAt > now();
  if (show && !el) {
    el = document.createElement('div'); el.id = 'quizReopen'; el.className = 'alert info'; el.style.cursor = 'pointer';
    el.textContent = '🧠 퀴즈 진행 중! 눌러서 풀기'; el.onclick = () => { S.quizHidden = null; renderQuiz(); el.remove(); };
    $('alerts').after(el);
  } else if (!show && el) el.remove();
}, 500);

window.addEventListener('resize', () => { renderMarket(false); drawSheetChart(); });
boot();
