import { fb } from './fb.js';
import { ADMIN_EMAIL, GAME_TITLE } from './config.js';
import { Engine } from './engine.js';
import { STOCKS, ITEMS, DEFAULT_CFG, worthOf, won, signed, pct, parseProblems } from './shared.js';
import { roundLabel } from './game-core.js';
import { $, esc, cls, mmss, toast, drawLine } from './ui.js';

let E = null, hist = [], connected = true, projOn = false, flashUntil = 0, flashNews = null, lastNewsCount = 0;
document.title = '운영자 · ' + GAME_TITLE;
$('pjTitle').textContent = '📈 ' + GAME_TITLE;
const joinUrl = (() => { const u = new URL(location.href); u.search = ''; u.hash = ''; u.pathname = u.pathname.replace(/admin\.html$/, '') ; return u.href.replace(/\/$/, '/') ; })();

// ---------------- 로그인 ----------------
try {
  fb.onUser(u => {
    if (u && u.email && u.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) { if (!E) startAdmin(); }
    else {
      show('loginView');
      if (u && !u.anon) $('loginMsg').textContent = `${u.email}은(는) 관리자 계정이 아니야 (config.js의 ADMIN_EMAIL 확인)`;
    }
  });
} catch (e) { $('loginMsg').textContent = e.message; }

$('loginForm').onsubmit = async (e) => {
  e.preventDefault(); $('loginMsg').textContent = '';
  try { await fb.login($('email').value.trim(), $('pw').value); }
  catch (err) { $('loginMsg').textContent = '로그인 실패: ' + (err.code || err.message); }
};

function setHTML(el, html) { if (el._h === html) return false; el._h = html; el.innerHTML = html; return true; }
function show(id) { for (const v of ['loginView', 'lockView', 'mainView']) $(v).classList.toggle('hidden', v !== id); }

async function startAdmin() {
  E = new Engine(scheduleRender);
  fb.connected(v => { connected = v; scheduleRender(); });
  const lock = await E.checkLock().catch(() => null);
  if (lock) { show('lockView'); $('takeLock').onclick = () => boot(); return; }
  boot();
}

async function boot() {
  show('mainView');
  try { await E.boot(); } catch (e) { toast('엔진 시작 실패: ' + e.message, 'bad', 10000); console.error(e); return; }
  fb.onAdded('market/hist', 200, (k, v) => { hist.push(v); if (hist.length > 400) hist.shift(); });
  initForms();
  try { await navigator.wakeLock?.request('screen'); } catch {}
  document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible') { try { await navigator.wakeLock?.request('screen'); } catch {} } });
  setInterval(renderClock, 500);
  render();
}

window.addEventListener('beforeunload', (e) => {
  if (E && E.running && E.g.game.status === 'running') { E.save(); e.preventDefault(); e.returnValue = ''; }
});

// ---------------- 버튼 ----------------
$('bStart').onclick = () => { if (!E.g.problems.length && !confirm('등록된 문제가 없어. 그래도 시작할까?')) return; if (E.start()) toast('게임 시작!', 'good'); };
$('bPause').onclick = () => E.pause();
$('bResume').onclick = () => E.resume();
$('bEnd').onclick = () => { if (confirm('게임을 지금 끝낼까? 되돌릴 수 없어.')) E.end(); };
$('bReset').onclick = async () => {
  if (!confirm('참가자, 거래 기록, 랭킹을 전부 지울까? (설정과 문제는 남아)')) return;
  if (prompt('정말 지우려면 "초기화"라고 입력해줘') !== '초기화') return;
  await E.resetAll(); hist = []; toast('초기화 완료', 'good');
};
$('bNews').onclick = () => {
  const n = E.news($('nStock').value, $('nDir').value, $('nStr').value, $('nText').value);
  $('nText').value = '';
  toast('속보 발동: ' + n.text, n.mag > 0 ? 'good' : 'bad');
};
$('bProbNext').onclick = () => { const err = E.release(); if (err) toast(err, 'bad'); else toast('문제 공개!', 'good'); };
$('bProbSave').onclick = () => {
  const { problems, errs } = parseProblems($('probText').value);
  $('probErr').innerHTML = errs.map(esc).join('<br>');
  if (errs.length && !confirm(`오류가 ${errs.length}개 있어. 오류 난 문제는 빼고 ${problems.length}개만 저장할까?`)) return;
  const lost = E.g.released.filter(id => !problems.some(p => p.id === id)).length;
  if (lost && !confirm(`이미 공개한 문제 ${lost}개가 바뀌거나 빠졌어. 그 문제들은 참가자 화면에서 사라지고 진행 기록도 없어져. 저장할까?`)) return;
  E.setProblems(problems); toast(`문제 ${problems.length}개 저장 (범위 ${problems.reduce((n, p) => n + p.parts.length, 0)}개)`, 'good');
};
$('bCfg').onclick = () => {
  const patch = {};
  for (const k in DEFAULT_CFG) {
    const el = $('c_' + k); if (!el) continue;
    let v = el.value;
    if (typeof DEFAULT_CFG[k] === 'number') { v = Number(v); if (!Number.isFinite(v)) continue; if (k === 'feeRate') v = v / 100; }
    if (v !== E.g.cfg[k]) patch[k] = v;
  }
  if (patch.outLine > 0) { toast('파산 기준은 0 이하로 넣어줘 (예: -500000)', 'bad'); return; }
  E.setCfg(patch); toast('설정 저장', 'good');
};
$('pSearch').oninput = () => renderTeams();
$('bTour').onclick = () => {
  const g = E.g, n = g.activeTeams().length;
  if (!confirm(`지금 있는 ${n}팀으로 토너먼트를 시작할까? 대진은 랜덤이고, 시작 후 새로 생긴 팀은 토너먼트에 못 들어가.`)) return;
  const err = E.startTournament(); if (err) toast(err, 'bad'); else toast('토너먼트 시작!', 'good');
};
$('bRoundEnd').onclick = () => { if (confirm('이번 라운드를 지금 끝내고 결과를 확정할까?')) E.endRoundNow(); };
$('bProj').onclick = () => { projOn = true; $('proj').classList.remove('hidden'); document.documentElement.requestFullscreen?.().catch(() => {}); renderProj(); };
const exitProj = () => { if (!projOn) return; projOn = false; $('proj').classList.add('hidden'); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
$('pjExit').onclick = exitProj;
document.addEventListener('keydown', e => { if (e.key === 'Escape') exitProj(); });
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) exitProj(); });

function initForms() {
  const sel = $('nStock');
  for (const s of STOCKS) { const o = document.createElement('option'); o.value = s.id; o.textContent = s.name; sel.appendChild(o); }
  fillCfg();
  $('probText').value = probToText(E.g.problems);
}
function fillCfg() {
  for (const k in DEFAULT_CFG) { const el = $('c_' + k); if (el) el.value = k === 'feeRate' ? +(E.g.cfg[k] * 100).toFixed(3) : E.g.cfg[k]; }
}
function probToText(list) {
  return (list || []).map(p => {
    const lines = ['T: ' + p.title, 'Q: ' + p.body];
    const single = p.parts.length === 1 && p.parts[0].label === '정답';
    for (const pt of p.parts) {
      if (!single) lines.push('P: ' + pt.label);
      if (pt.opts) { lines.push('O: ' + pt.opts.join(' | ')); lines.push('A: ' + (pt.ans + 1)); }
      else for (const x of [].concat(pt.ans)) lines.push('A: ' + x);
    }
    return lines.join('\n');
  }).join('\n\n');
}

// ---------------- 렌더 ----------------
let rq = false;
function scheduleRender() { if (rq) return; rq = true; requestAnimationFrame(() => { rq = false; render(); }); }

function render() {
  if (!E) return;
  const g = E.g;
  if (E.stopReason) { setHTML($('warnBox'), `<div class="alert bad" style="margin:0 0 12px">${esc(E.stopReason)} 계속 운영하려면 이 창을 새로고침해.</div>`); }
  else {
    const w = [];
    if (!connected) w.push(['bad', '📡 인터넷 연결 끊김 — 참가자 요청을 처리 못 하고 있어']);
    if (E.writeErr) w.push(['bad', '⚠️ 데이터 저장 실패: ' + E.writeErr + ' (보안 규칙 / 관리자 이메일 확인)']);
    if (g.game.status === 'lobby') w.push(['info', '참가자들이 입장하면 아래 목록에 나와. 준비되면 ▶ 게임 시작! 참가 주소: ' + joinUrl]);
    setHTML($('warnBox'), w.map(([k, t]) => `<div class="alert ${k}" style="margin:0 0 12px">${esc(t)}</div>`).join(''));
  }
  const st = g.game.status;
  $('stStatus').textContent = { lobby: '시작 전', running: '진행 중', paused: '일시정지', ended: '종료' }[st];
  $('stPlayers').textContent = `${Object.keys(g.players).length}명 / ${Object.values(g.teams).filter(t => t.members.length).length}팀`;
  $('stOut').textContent = Object.values(g.teams).filter(t => t.status === 'out').length;
  $('stReq').textContent = E.reqCount.toLocaleString();
  $('stConn').innerHTML = connected ? '🟢 연결됨' : '🔴 끊김';
  $('bStart').classList.toggle('hidden', st !== 'lobby');
  $('bPause').classList.toggle('hidden', st !== 'running');
  $('bResume').classList.toggle('hidden', st !== 'paused');
  $('bEnd').classList.toggle('hidden', st === 'ended' || st === 'lobby');

  // 시세
  const pr = g.prices();
  $('mkTable').innerHTML = STOCKS.map(s => { const m = g.mk[s.id], ch = m.p / m.open - 1; return `<tr><td><i class="dot" style="background:${s.color}"></i> ${esc(s.name)}</td><td class="r num">${won(m.p)}</td><td class="r num ${cls(ch)}">${pct(ch)}</td><td style="width:90px"><canvas data-s="${s.id}" style="width:90px;height:26px;display:block"></canvas></td></tr>`; }).join('');
  $('mkTable').querySelectorAll('canvas').forEach(c => drawLine(c, histSeries(c.dataset.s, 120), { base: g.mk[c.dataset.s].open, width: 1.5 }));

  // 문제
  const nParts = g.problems.reduce((n, p) => n + p.parts.length, 0);
  $('probInfo').textContent = `${g.released.length} / ${g.problems.length}개 공개 · 범위 ${nParts}개`;
  $('probTriesTxt').textContent = g.cfg.probTries;
  const nTeams = Object.values(g.teams).filter(t => t.members.length).length;
  const ph = g.problems.map((p, i) => {
    const ri = g.released.indexOf(p.id);
    const parts = p.parts.map((pt, k) => `<span class="chip" style="margin:2px 2px 0 0">${esc(pt.label)}: ${esc(pt.opts ? (pt.ans + 1) + '번' : [].concat(pt.ans)[0])} · ${(p.solvedBy && p.solvedBy[k]) || 0}/${nTeams}팀</span>`).join('');
    return `<div class="qi"><span class="n">${i + 1}</span><span class="t"><b>${esc(p.title)}</b><br><span class="small">${parts}</span></span>
      ${ri >= 0 ? `<span class="small" style="flex:none;color:var(--good)">공개됨 (${ri + 1}번)</span>` : `<button class="btn tiny gold" data-rel="${p.id}">공개</button>`}</div>`;
  }).join('') || '<div class="muted small">아래 ✏️ 문제 입력에서 문제를 넣어줘</div>';
  if (setHTML($('probAdminList'), ph)) $('probAdminList').querySelectorAll('[data-rel]').forEach(b => b.onclick = () => { const err = E.release(b.dataset.rel); if (err) toast(err, 'bad'); });

  renderTeams();
  renderTourAdmin();

  // 아레나
  const ar = g.publicArena();
  setHTML($('arenaInfo'), `<div class="kv"><span>대기 중</span><b>${esc(ar.queue.join(', ') || '없음')}</b></div>` +
    Object.values(ar.duels).map(d => `<div class="kv"><span>${esc(d.an)} <b style="color:var(--text)">${d.sa}:${d.sb}</b> ${esc(d.bn)}</span><b>${d.status === 'play' ? `R${d.round}/5` : d.status === 'reward' ? '보상 선택' : esc(d.result)}</b></div>`).join(''));
  setHTML($('log'), g.log.slice().reverse().map(esc).join('<br>'));

  // 프로젝터 속보 감지
  if (g.newsLog.length !== lastNewsCount) {
    if (lastNewsCount && g.newsLog.length > lastNewsCount) { flashNews = g.newsLog[g.newsLog.length - 1]; flashUntil = Date.now() + 6000; }
    lastNewsCount = g.newsLog.length;
  }
  if (projOn) renderProj();
}

function histSeries(id, n) {
  const a = hist.slice(-n).map(h => h.p && h.p[id]).filter(v => v != null);
  a.push(Math.round(E.g.mk[id].p));
  return a;
}

function teamRows() {
  const g = E.g, pr = g.prices();
  return Object.values(g.teams).filter(t => t.members.length || t.invested).map(t => { const w = worthOf(t, pr); return { t, w, r: g.rate(t, w) }; })
    .sort((x, y) => ((x.t.status === 'out') - (y.t.status === 'out')) || (y.r - x.r) || (y.w - x.w));
}
function renderTeams() {
  const g = E.g, q = $('pSearch').value.trim().toLowerCase();
  const rows = teamRows();
  const itemOpts = Object.entries(ITEMS).map(([k, I]) => `<option value="${k}">${I.icon} ${I.name}</option>`).join('');
  const html = rows.map((row, i) => ({ ...row, rank: i + 1 })).filter(({ t }) => !q || t.name.includes(q) || t.members.some(u => (g.players[u]?.name || '').toLowerCase().includes(q))).map(({ t, w, r, rank }) => {
    const items = Object.entries(t.items).map(([k, n]) => `${ITEMS[k].icon}${n > 1 ? n : ''}`).join(' ');
    const mem = t.members.map(u => { const p = g.players[u]; return `<button class="chip" data-kk="${u}" title="눌러서 추방" style="margin:1px">${esc(p?.name)}${p?.arena === 'duel' ? '⚔️' : p?.arena === 'queue' ? '⏳' : ''}</button>`; }).join('');
    return `<tr><td class="muted">${rank}</td><td><b>${esc(t.name)}</b></td><td style="max-width:360px">${mem}</td><td class="r num ${cls(r)}">${pct(r)}</td><td class="r num">${won(w)}</td><td class="r num ${t.cash < 0 ? 'up' : ''}">${won(t.cash)}</td><td>${items}</td>
      <td>${t.status === 'out' ? '<span class="up">💥 파산</span>' : '🟢'}${t.tourOut ? ' <span class="muted small">토너먼트 탈락</span>' : ''}</td>
      <td style="white-space:nowrap"><select class="tiny" data-gi="${t.id}" style="width:auto;padding:4px"><option value="">🎁 주기</option>${itemOpts}</select>
      ${t.status === 'out' ? `<button class="btn tiny" data-rv="${t.id}">부활</button>` : ''}</td></tr>`;
  }).join('');
  const tb = $('pTable');
  if (tb._html === html) return; // 드롭다운 조작 중 깨지지 않게
  if (tb.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') return;
  tb._html = html; tb.innerHTML = html;
  tb.querySelectorAll('[data-gi]').forEach(s => s.onchange = () => { if (s.value) { E.grant(s.dataset.gi, s.value); toast('팀에 아이템 지급', 'good'); } s.value = ''; });
  tb.querySelectorAll('[data-rv]').forEach(b => b.onclick = () => E.revive(b.dataset.rv));
  tb.querySelectorAll('[data-kk]').forEach(b => b.onclick = () => { const p = E.g.players[b.dataset.kk]; if (p && confirm(`${p.name}을(를) 추방할까? (팀 돈은 그대로 남아)`)) E.kick(b.dataset.kk); });
}

const fr = (x) => Number.isFinite(x) ? pct(x) : '파산';
function renderTourAdmin() {
  const g = E.g, T = g.tour, run = T && T.status === 'running';
  $('bTour').classList.toggle('hidden', !!run || g.game.status !== 'running');
  $('bRoundEnd').classList.toggle('hidden', !run);
  const n = g.activeTeams().length, nR = Math.max(1, Math.ceil(Math.log2(Math.max(2, n))));
  const left = g.game.status === 'running' ? g.game.endAt - E.now() : 0;
  let html = '';
  if (!T) {
    const len = g.cfg.tourRoundMin > 0 ? g.cfg.tourRoundMin * 60e3 : (left - 15000) / nR;
    html = `<div class="muted small" style="line-height:1.7">지금 팀 <b style="color:var(--text)">${n}개</b> → <b style="color:var(--text)">${nR}라운드</b> 필요.<br>${g.game.status === 'running' ? `시작하면 라운드당 약 <b style="color:var(--text)">${Math.max(0, Math.round(len / 6000) / 10)}분</b>${g.cfg.tourRoundMin > 0 ? '' : ' (남은 게임 시간에 맞춰 자동)'}` : '게임을 시작한 뒤에 토너먼트를 시작할 수 있어. 다들 팀에 들어온 다음 시작해줘.'}</div>`;
  } else {
    html = T.status === 'done' ? `<div class="alert info" style="margin:0 0 8px">🏆 ${T.champ ? '우승: ' + esc(g.teams[T.champ]?.name) : '게임 종료로 미완료'}</div>` : `<div class="small muted" style="margin-bottom:6px">라운드 ${T.round + 1}/${T.nRounds} · 라운드당 ${Math.round(T.len / 6000) / 10}분 · 남은 시간 <b style="color:var(--text)" id="tourLeft">-</b></div>`;
    const nm = (id) => id ? esc(g.teams[id]?.name || '?') : '';
    T.rounds.forEach((ms, ri) => {
      html += `<div class="small" style="font-weight:800;margin-top:8px">${roundLabel(ms.reduce((k, m) => k + (m.b ? 2 : 1), 0))}</div>`;
      html += ms.map(m => m.b ? `<div class="kv"><span style="${m.w === 'a' ? 'color:var(--gold);font-weight:800' : ''}">${nm(m.a)} <span class="num ${cls(m.ra)}">${fr(m.ra)}</span></span><span class="muted">vs</span><span style="${m.w === 'b' ? 'color:var(--gold);font-weight:800' : ''}"><span class="num ${cls(m.rb)}">${fr(m.rb)}</span> ${nm(m.b)}</span></div>` : `<div class="kv"><span>${nm(m.a)}</span><span class="muted">부전승</span></div>`).join('');
    });
  }
  setHTML($('tourInfo'), html);
}

function renderClock() {
  if (!E) return;
  const g = E.g, now = E.now();
  const t = g.game.status === 'running' ? mmss(g.game.endAt - now) : g.game.status === 'paused' ? '⏸ ' + mmss(g.game.endAt - g.game.pausedAt) : g.game.status === 'ended' ? '종료' : '--:--';
  $('stTime').textContent = t; $('pjClock').textContent = t;
  const tl = document.getElementById('tourLeft'); if (tl && g.tour && g.tour.status === 'running') tl.textContent = mmss(g.tour.endsAt - (g.game.status === 'paused' ? g.game.pausedAt : now));
  const pl = document.getElementById('pjTourLeft'); if (pl && g.tour && g.tour.status === 'running') pl.textContent = mmss(g.tour.endsAt - (g.game.status === 'paused' ? g.game.pausedAt : now));
  $('nextNews').innerHTML = g.nextNews && g.game.status !== 'lobby' ? `다음 정기 속보: <b>${mmss(g.nextNews.at - now)}</b> 후 — "${esc(g.nextNews.text)}"` : (g.cfg.newsEveryMin > 0 ? '정기 속보는 게임 시작 후 자동으로 나와' : '정기 속보 꺼짐');
  if (projOn) renderProjOverlay();
}

// ---------------- 프로젝터 ----------------
function renderProj() {
  const g = E.g;
  $('pjCount').textContent = `${Object.keys(g.players).length}명 · ${Object.values(g.teams).filter(t => t.members.length).length}팀`;
  $('pjStocks').innerHTML = STOCKS.map(s => { const m = g.mk[s.id], ch = m.p / m.open - 1; return `<div class="pstock"><span><i class="dot" style="background:${s.color};width:1vw;height:1vw"></i> ${esc(s.name)}</span><canvas data-s="${s.id}"></canvas><span class="num ${cls(ch)}" style="text-align:right">${won(m.p)}</span><span class="badge ${cls(ch)} num" style="font-size:1.4vw">${pct(ch)}</span></div>`; }).join('');
  $('pjStocks').querySelectorAll('canvas').forEach(c => drawLine(c, histSeries(c.dataset.s, 150), { base: g.mk[c.dataset.s].open, width: 2 }));
  const rows = teamRows();
  const T = g.tour, run = T && T.status === 'running';
  let side = '';
  if (run) {
    const ms = T.rounds[T.round], nm = (id) => esc(g.teams[id]?.name || '?');
    side += `<h2>🏟 토너먼트 ${roundLabel(ms.reduce((k, m) => k + (m.b ? 2 : 1), 0))} · <span class="num" id="pjTourLeft">-</span></h2>`;
    side += ms.map(m => m.b ? `<div class="prank" style="grid-template-columns:1fr auto 1fr;font-size:1.6vw"><span>${nm(m.a)} <span class="num ${cls(m.ra)}">${fr(m.ra)}</span></span><span class="muted">vs</span><span style="text-align:right"><span class="num ${cls(m.rb)}">${fr(m.rb)}</span> ${nm(m.b)}</span></div>` : `<div class="prank" style="grid-template-columns:1fr auto;font-size:1.6vw"><span>${nm(m.a)}</span><span class="muted">부전승</span></div>`).join('');
    side += `<h2 style="margin-top:1.4vw">🏆 수익률 랭킹</h2>`;
  } else side += `<h2>🏆 팀 수익률 랭킹${T && T.status === 'done' && T.champ ? ` · 토너먼트 우승 ${esc(g.teams[T.champ]?.name)}` : ''}</h2>`;
  side += rows.slice(0, run ? 5 : 10).map(({ t, w, r }, i) => `<div class="prank"><span>${['🥇', '🥈', '🥉'][i] || i + 1}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.name)} <span class="muted" style="font-size:1.2vw">${t.members.length}명${t.status === 'out' ? ' 💥' : ''}</span></span><span class="num ${cls(r)}">${pct(r)}</span></div>`).join('') || '<div class="muted">아직 팀 없음</div>';
  $('pjRank').innerHTML = side;
  const n = g.newsLog[g.newsLog.length - 1];
  $('pjTicker').innerHTML = n ? `📰 <span class="${n.up ? 'up' : 'down'}">${n.up ? '▲' : '▼'}</span> ${esc(n.text)}` : '📰 속보 대기 중…';
  renderProjOverlay();
}

let qrDone = false, ovKey = '';
function renderProjOverlay() {
  const g = E.g, now = E.now(), ov = $('projOverlay'), box = $('pjOv');
  let key = '', html = '';
  if (g.game.status === 'lobby') {
    const n = Object.keys(g.players).length;
    const teams = Object.values(g.teams).filter(t => t.members.length).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
    key = 'lobby' + n;
    html = `<div class="lobby"><div class="qr" id="qr"></div><div style="text-align:left"><div style="font-size:4vw;font-weight:900">📱 QR 찍고 입장!</div>
      <div style="font-size:1.8vw;margin-top:1vw;word-break:break-all" class="muted">${esc(joinUrl)}</div>
      <div style="font-size:2.4vw;font-weight:900;margin-top:1.6vw">닉네임 + 팀 번호 입력 · 입장 ${n}명 / ${teams.length}팀</div>
      <div class="names">${teams.map(t => `<span><b>${esc(t.name)}</b> ${t.members.length}명</span>`).join('')}</div></div></div>`;
  } else if (flashNews && Date.now() < flashUntil) {
    key = 'news' + flashNews.t;
    html = `<div style="border-radius:1.6vw;padding:3vw;background:linear-gradient(160deg,${flashNews.up ? '#ff4d5e,#b5162c' : '#3d8bff,#1846a8'})"><div style="font-size:2vw;font-weight:900;letter-spacing:.3vw">📰 속보 BREAKING</div><div style="font-size:4.4vw;font-weight:900;margin-top:1.4vw;word-break:keep-all">${esc(flashNews.text)}</div></div>`;
  } else if (g.lastRelease && now - g.lastRelease.t < 8000) {
    const r = g.lastRelease;
    key = 'prob' + r.id + r.t;
    html = `<div style="font-size:2.2vw;font-weight:900;color:var(--gold)">📝 새 문제 공개!</div>
      <div style="font-size:4.4vw;font-weight:900;margin:1.6vw 0;word-break:keep-all">${r.n}번 「${esc(r.title)}」</div>
      <div class="muted" style="font-size:2vw">범위 ${r.parts}개 · 범위 하나 풀 때마다 팀 아이템 1개 · 제한시간 없음<br>폰의 📝 문제 페이지에서 풀어!</div>`;
  } else if (g.game.status === 'ended') {
    const top = teamRows().filter(r => r.t.status !== 'out').slice(0, 3);
    const T = g.tour, champ = T && T.champ ? g.teams[T.champ]?.name : '';
    key = 'end' + top.map(r => r.t.id).join() + champ;
    html = `<div style="font-size:4vw;font-weight:900">🏁 게임 종료!</div>
      ${champ ? `<div style="margin-top:1.6vw;padding:1.6vw;border-radius:1.4vw;background:linear-gradient(160deg,#ffcc4d,#d18a00);color:#2a1e00"><div style="font-size:1.8vw;font-weight:900">🏟 토너먼트 우승</div><div style="font-size:4.4vw;font-weight:900">🏆 ${esc(champ)}</div></div>` : ''}
      <div style="font-size:1.8vw;font-weight:800;margin-top:2vw" class="muted">수익률 순위</div>
      <div style="display:flex;justify-content:center;gap:2vw;margin-top:1vw;align-items:flex-end">${[1, 0, 2].filter(i => top[i]).map(i => `<div style="background:var(--card);border-radius:1.4vw;padding:1.6vw;min-width:18vw;${i === 0 ? 'padding-bottom:3vw;border:2px solid var(--gold)' : ''}"><div style="font-size:3.4vw">${['🥇', '🥈', '🥉'][i]}</div><div style="font-size:2.4vw;font-weight:900">${esc(top[i].t.name)}</div><div class="num ${cls(top[i].r)}" style="font-size:1.8vw;font-weight:800">${pct(top[i].r)}</div></div>`).join('')}</div>`;
  }
  ov.classList.toggle('hidden', !html);
  if (key !== ovKey) {
    ovKey = key; box.innerHTML = html;
    if (key.startsWith('lobby') && window.QRCode) { const q = $('qr'); if (q) new QRCode(q, { text: joinUrl, width: Math.round(innerWidth * 0.26), height: Math.round(innerWidth * 0.26) }); }
  }
}
