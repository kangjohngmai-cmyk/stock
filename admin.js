import { fb } from './fb.js';
import { ADMIN_EMAIL, GAME_TITLE } from './config.js';
import { Engine } from './engine.js';
import { STOCKS, ITEMS, DEFAULT_CFG, worthOf, won, signed, pct, parseQuizzes } from './shared.js';
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
$('bStart').onclick = () => { if (!E.g.quizzes.length && !confirm('등록된 퀴즈가 없어. 그래도 시작할까?')) return; if (E.start()) toast('게임 시작!', 'good'); };
$('bPause').onclick = () => E.pause();
$('bResume').onclick = () => E.resume();
$('bEnd').onclick = () => { if (confirm('게임을 지금 끝낼까? 되돌릴 수 없어.')) E.end(); };
$('bReset').onclick = async () => {
  if (!confirm('참가자, 거래 기록, 랭킹을 전부 지울까? (설정과 퀴즈는 남아)')) return;
  if (prompt('정말 지우려면 "초기화"라고 입력해줘') !== '초기화') return;
  await E.resetAll(); hist = []; toast('초기화 완료', 'good');
};
$('bNews').onclick = () => {
  const n = E.news($('nStock').value, $('nDir').value, $('nStr').value, $('nText').value);
  $('nText').value = '';
  toast('속보 발동: ' + n.text, n.mag > 0 ? 'good' : 'bad');
};
$('bQuizNext').onclick = () => { const err = E.startQuiz(); if (err) toast(err, 'bad'); };
$('bQuizClose').onclick = () => E.closeQuiz();
$('bQuizSave').onclick = () => {
  const { quizzes, errs } = parseQuizzes($('quizText').value);
  $('quizErr').innerHTML = errs.map(esc).join('<br>');
  if (errs.length && !confirm(`오류가 ${errs.length}개 있어. 오류 난 문제는 빼고 ${quizzes.length}개만 저장할까?`)) return;
  E.setQuizzes(quizzes); toast(`퀴즈 ${quizzes.length}개 저장`, 'good');
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
$('pSearch').oninput = () => renderPlayers();
$('bProj').onclick = () => { projOn = true; $('proj').classList.remove('hidden'); document.documentElement.requestFullscreen?.().catch(() => {}); renderProj(); };
const exitProj = () => { if (!projOn) return; projOn = false; $('proj').classList.add('hidden'); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
$('pjExit').onclick = exitProj;
document.addEventListener('keydown', e => { if (e.key === 'Escape') exitProj(); });
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) exitProj(); });

function initForms() {
  const sel = $('nStock');
  for (const s of STOCKS) { const o = document.createElement('option'); o.value = s.id; o.textContent = s.name; sel.appendChild(o); }
  fillCfg();
  $('quizText').value = quizToText(E.g.quizzes);
}
function fillCfg() {
  for (const k in DEFAULT_CFG) { const el = $('c_' + k); if (el) el.value = k === 'feeRate' ? +(E.g.cfg[k] * 100).toFixed(3) : E.g.cfg[k]; }
}
function quizToText(list) {
  return (list || []).map(q => {
    const lines = ['Q: ' + q.q];
    if (q.opts) { lines.push('O: ' + q.opts.join(' | ')); lines.push('A: ' + (q.ans + 1)); }
    else for (const a of (Array.isArray(q.ans) ? q.ans : [q.ans])) lines.push('A: ' + a);
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
  $('stPlayers').textContent = Object.keys(g.players).length;
  $('stOut').textContent = Object.values(g.players).filter(p => p.status === 'out').length;
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

  // 퀴즈
  const z = g.quiz;
  $('quizInfo').textContent = `${g.quizIdx} / ${g.quizzes.length} 출제됨`;
  $('quizLive').classList.toggle('hidden', !z);
  if (z) $('quizLive').innerHTML = `진행 중: <b>${z.n}번</b> · 답 제출 ${Object.keys(z.answered).length}명 · 정답 ${z.correct.length}명`;
  const qhtml = g.quizzes.map((q, i) => `<div class="qi"><span class="n">${i + 1}</span><span class="t">${esc(q.q)}${q.opts ? `<br><span class="muted small">${q.opts.map((o, j) => (j === q.ans ? '✅' : '') + esc(o)).join(' · ')}</span>` : `<br><span class="muted small">정답: ${esc([].concat(q.ans).join(' / '))}</span>`}</span>
    <span class="small ${i < g.quizIdx ? 'muted' : ''}" style="flex:none">${i < g.quizIdx ? '출제됨' : '대기'}</span><button class="btn tiny" data-q="${i}">출제</button></div>`).join('') || '<div class="muted small">아래 ✏️ 퀴즈 입력에서 문제를 넣어줘</div>';
  if (setHTML($('quizList'), qhtml)) $('quizList').querySelectorAll('[data-q]').forEach(b => b.onclick = () => { const err = E.startQuiz(Number(b.dataset.q)); if (err) toast(err, 'bad'); });

  renderPlayers();

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

function renderPlayers() {
  const g = E.g, pr = g.prices(), q = $('pSearch').value.trim().toLowerCase();
  const rows = Object.values(g.players).map(p => ({ p, w: worthOf(p, pr) })).sort((a, b) => b.w - a.w);
  const itemOpts = Object.entries(ITEMS).map(([k, I]) => `<option value="${k}">${I.icon} ${I.name}</option>`).join('');
  const html = rows.filter(r => !q || r.p.name.toLowerCase().includes(q)).map(({ p, w }) => {
    const rank = rows.findIndex(r => r.p === p) + 1;
    const items = Object.entries(p.items).map(([k, n]) => `${ITEMS[k].icon}${n > 1 ? n : ''}`).join(' ');
    return `<tr><td class="muted">${rank}</td><td>${esc(p.name)}</td><td class="r num ${cls(w - g.cfg.startCash)}">${won(w)}</td><td class="r num ${p.cash < 0 ? 'up' : ''}">${won(p.cash)}</td><td>${items}</td>
      <td>${p.status === 'out' ? '<span class="up">💥 파산</span>' : p.arena === 'duel' ? '⚔️ 결투' : p.arena === 'queue' ? '⏳ 대기' : '🟢'}</td>
      <td style="white-space:nowrap"><select class="tiny" data-gi="${p.uid}" style="width:auto;padding:4px"><option value="">🎁 주기</option>${itemOpts}</select>
      ${p.status === 'out' ? `<button class="btn tiny" data-rv="${p.uid}">부활</button>` : ''}<button class="btn tiny ghost" data-kk="${p.uid}">추방</button></td></tr>`;
  }).join('');
  const tb = $('pTable');
  if (tb._html === html) return; // 드롭다운 조작 중 깨지지 않게
  if (tb.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') return;
  tb._html = html; tb.innerHTML = html;
  tb.querySelectorAll('[data-gi]').forEach(s => s.onchange = () => { if (s.value) { E.grant(s.dataset.gi, s.value); toast('아이템 지급', 'good'); } s.value = ''; });
  tb.querySelectorAll('[data-rv]').forEach(b => b.onclick = () => E.revive(b.dataset.rv));
  tb.querySelectorAll('[data-kk]').forEach(b => b.onclick = () => { const p = E.g.players[b.dataset.kk]; if (p && confirm(`${p.name}을(를) 추방할까?`)) E.kick(b.dataset.kk); });
}

function renderClock() {
  if (!E) return;
  const g = E.g, now = E.now();
  const t = g.game.status === 'running' ? mmss(g.game.endAt - now) : g.game.status === 'paused' ? '⏸ ' + mmss(g.game.endAt - g.game.pausedAt) : g.game.status === 'ended' ? '종료' : '--:--';
  $('stTime').textContent = t; $('pjClock').textContent = t;
  $('nextNews').innerHTML = g.nextNews && g.game.status !== 'lobby' ? `다음 정기 속보: <b>${mmss(g.nextNews.at - now)}</b> 후 — "${esc(g.nextNews.text)}"` : (g.cfg.newsEveryMin > 0 ? '정기 속보는 게임 시작 후 자동으로 나와' : '정기 속보 꺼짐');
  $('nextQuiz').innerHTML = g.quiz ? `진행 중인 퀴즈 남은 시간 <b>${mmss(g.quiz.endsAt - now)}</b>` : g.nextQuizAt && g.game.status === 'running' ? (g.quizIdx < g.quizzes.length ? `다음 자동 퀴즈: <b>${mmss(g.nextQuizAt - now)}</b> 후 (${g.quizIdx + 1}번)` : '남은 퀴즈 없음') : (g.cfg.quizEveryMin > 0 ? '자동 퀴즈는 게임 시작 후 나와' : '자동 퀴즈 꺼짐');
  if (projOn) renderProjOverlay();
}

// ---------------- 프로젝터 ----------------
function renderProj() {
  const g = E.g;
  $('pjCount').textContent = `참가자 ${Object.keys(g.players).length}명`;
  $('pjStocks').innerHTML = STOCKS.map(s => { const m = g.mk[s.id], ch = m.p / m.open - 1; return `<div class="pstock"><span><i class="dot" style="background:${s.color};width:1vw;height:1vw"></i> ${esc(s.name)}</span><canvas data-s="${s.id}"></canvas><span class="num ${cls(ch)}" style="text-align:right">${won(m.p)}</span><span class="badge ${cls(ch)} num" style="font-size:1.4vw">${pct(ch)}</span></div>`; }).join('');
  $('pjStocks').querySelectorAll('canvas').forEach(c => drawLine(c, histSeries(c.dataset.s, 150), { base: g.mk[c.dataset.s].open, width: 2 }));
  const pr = g.prices();
  const rows = Object.values(g.players).map(p => [p.name, worthOf(p, pr), p.status === 'out']).sort((a, b) => (a[2] - b[2]) || (b[1] - a[1])).slice(0, 10);
  $('pjRank').innerHTML = rows.map((r, i) => `<div class="prank"><span>${['🥇', '🥈', '🥉'][i] || i + 1}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r[0])}</span><span class="num ${cls(r[1] - g.cfg.startCash)}">${won(r[1])}</span></div>`).join('') || '<div class="muted">아직 참가자 없음</div>';
  const n = g.newsLog[g.newsLog.length - 1];
  $('pjTicker').innerHTML = n ? `📰 <span class="${n.up ? 'up' : 'down'}">${n.up ? '▲' : '▼'}</span> ${esc(n.text)}` : '📰 속보 대기 중…';
  renderProjOverlay();
}

let qrDone = false, ovKey = '';
function renderProjOverlay() {
  const g = E.g, now = E.now(), ov = $('projOverlay'), box = $('pjOv');
  let key = '', html = '';
  if (g.game.status === 'lobby') {
    const names = Object.values(g.players).map(p => p.name);
    key = 'lobby' + names.length;
    html = `<div class="lobby"><div class="qr" id="qr"></div><div style="text-align:left"><div style="font-size:4vw;font-weight:900">📱 QR 찍고 입장!</div>
      <div style="font-size:1.8vw;margin-top:1vw;word-break:break-all" class="muted">${esc(joinUrl)}</div>
      <div style="font-size:2.6vw;font-weight:900;margin-top:2vw">입장 ${names.length}명</div>
      <div class="names">${names.slice(-60).map(n => `<span>${esc(n)}</span>`).join('')}</div></div></div>`;
  } else if (flashNews && Date.now() < flashUntil) {
    key = 'news' + flashNews.t;
    html = `<div style="border-radius:1.6vw;padding:3vw;background:linear-gradient(160deg,${flashNews.up ? '#ff4d5e,#b5162c' : '#3d8bff,#1846a8'})"><div style="font-size:2vw;font-weight:900;letter-spacing:.3vw">📰 속보 BREAKING</div><div style="font-size:4.4vw;font-weight:900;margin-top:1.4vw;word-break:keep-all">${esc(flashNews.text)}</div></div>`;
  } else if (g.quiz) {
    const z = g.quiz, left = z.endsAt - now;
    key = 'quiz' + z.id + Math.ceil(left / 1000) + Object.keys(z.answered).length;
    html = `<div style="display:flex;justify-content:space-between;font-size:2vw;font-weight:900"><span style="color:var(--gold)">🧠 퀴즈 ${z.n}번 — 폰에서 풀어!</span><span class="num">⏱ ${mmss(left)}</span></div>
      <div style="font-size:4vw;font-weight:900;margin:2.4vw 0;white-space:pre-wrap;word-break:keep-all">${esc(z.q)}</div>
      ${z.opts ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:1vw;text-align:left">${z.opts.map((o, i) => `<div style="background:var(--card);border-radius:1vw;padding:1.2vw;font-size:2.2vw;font-weight:800"><b style="color:var(--accent)">${i + 1}</b> ${esc(o)}</div>`).join('')}</div>` : '<div class="muted" style="font-size:2vw">주관식 · 폰에 정답을 입력해</div>'}
      <div class="muted" style="font-size:1.8vw;margin-top:2vw">답 제출 ${Object.keys(z.answered).length}명</div>`;
  } else if (g.game.status === 'ended') {
    const pr = g.prices();
    const top = Object.values(g.players).filter(p => p.status !== 'out').map(p => [p.name, worthOf(p, pr)]).sort((a, b) => b[1] - a[1]).slice(0, 3);
    key = 'end' + top.map(t => t[0]).join();
    html = `<div style="font-size:5vw">🏁</div><div style="font-size:4vw;font-weight:900">게임 종료!</div>
      <div style="display:flex;justify-content:center;gap:2vw;margin-top:2.4vw;align-items:flex-end">${[1, 0, 2].filter(i => top[i]).map(i => `<div style="background:var(--card);border-radius:1.4vw;padding:2vw;min-width:18vw;${i === 0 ? 'padding-bottom:4vw;border:2px solid var(--gold)' : ''}"><div style="font-size:4vw">${['🥇', '🥈', '🥉'][i]}</div><div style="font-size:2.4vw;font-weight:900">${esc(top[i][0])}</div><div class="num up" style="font-size:1.8vw;font-weight:800">${won(top[i][1])}원</div></div>`).join('')}</div>`;
  }
  ov.classList.toggle('hidden', !html);
  if (key !== ovKey) {
    ovKey = key; box.innerHTML = html;
    if (key.startsWith('lobby') && window.QRCode) { const q = $('qr'); if (q) new QRCode(q, { text: joinUrl, width: Math.round(innerWidth * 0.26), height: Math.round(innerWidth * 0.26) }); }
  }
}
