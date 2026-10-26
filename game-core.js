// =====================================================
// 모의 주식 게임 엔진 (관리자 브라우저에서만 실행됨) — 팀전 + 수익률 토너먼트
// Firebase와 무관한 순수 로직. 상태 변경 결과는 out(dirty)에 모아 둔다.
// 자산(현금/주식/아이템/효과)은 팀 단위, 결투·퀴즈 답안은 개인 단위.
// =====================================================
import { STOCKS, ITEMS, ITEM_WEIGHTS, DEFAULT_CFG, TICK_MS, execBuy, execSell, worthOf, checkAnswer } from './shared.js';

const rnd = Math.random;
function gauss() { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const pick = (a) => a[Math.floor(rnd() * a.length)];
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const R = Math.round;
const W = (n) => R(n).toLocaleString();

// ---------------- 속보 문구 ----------------
const NEWS_UP = {
  DAL: ['달빛전자, 차세대 AI 칩 양산 성공', '달빛전자, 해외 대형 수주 계약 체결', '달빛전자 분기 실적 \'역대 최대\''],
  QRK: ['쿼크바이오 신약 임상 3상 통과!', '쿼크바이오, 글로벌 제약사에 기술 수출', '쿼크바이오 치료제 긴급 승인'],
  BUN: ['번개물류, 드론 배송 전국 확대', '번개물류 택배 물량 폭증', '번개물류, 대기업과 독점 배송 계약'],
  NYM: ['냠냠푸드 신제품 라면 품절 대란', '냠냠푸드 해외 수출 2배 증가', '냠냠푸드 과자, SNS에서 대유행'],
  PXL: ['픽셀게임즈 신작 동시접속 100만 돌파', '픽셀게임즈 게임, 올해의 게임상 수상', '픽셀게임즈 해외 퍼블리싱 대박'],
  SUN: ['햇살에너지, 효율 40% 태양전지 개발', '정부, 햇살에너지 보조금 대폭 확대', '햇살에너지 대규모 발전소 수주'],
  SKY: ['하늘항공 여행 수요 폭발, 전 노선 매진', '국제 유가 급락, 하늘항공 수혜', '하늘항공 신규 해외 노선 취항'],
  CAT: ['유명 인플루언서 "냥냥코인 산다"', '냥냥코인, 대형 거래소 상장 확정', '고양이 밈 대유행, 냥냥코인 들썩'],
  ALL: ['한국은행 기준금리 전격 인하', '외국인 투자자 대규모 순매수', '경기 회복 신호, 증시 전반 상승'],
};
const NEWS_DOWN = {
  DAL: ['달빛전자 공장 화재로 생산 중단', '달빛전자 핵심 기술 유출 의혹', '반도체 수요 급감, 달빛전자 실적 쇼크'],
  QRK: ['쿼크바이오 임상 실패 발표', '쿼크바이오 연구 데이터 조작 의혹', '쿼크바이오 신약 부작용 보고'],
  BUN: ['번개물류 택배 노조 파업', '번개물류 물류센터 정전 사태', '번개물류 개인정보 유출 사고'],
  NYM: ['냠냠푸드 제품에서 이물질 발견', '원재료 가격 폭등, 냠냠푸드 비상', '냠냠푸드 대규모 리콜'],
  PXL: ['픽셀게임즈 신작 서버 폭파, 환불 요구 빗발', '픽셀게임즈 핵심 개발자 대거 퇴사', '픽셀게임즈 확률 조작 논란'],
  SUN: ['햇살에너지 보조금 중단 발표', '햇살에너지 발전소 사고', '햇살에너지 회계 부정 의혹'],
  SKY: ['국제 유가 폭등, 하늘항공 직격탄', '하늘항공 조종사 파업', '태풍으로 하늘항공 전 노선 결항'],
  CAT: ['냥냥코인 거래소 해킹 사고', '정부, 냥냥코인 거래 규제 검토', '냥냥코인 개발자 잠적설'],
  ALL: ['기준금리 깜짝 인상, 증시 출렁', '글로벌 경기 침체 우려 확산', '외국인 대규모 매도, 증시 급락'],
};
const STRENGTH = { S: [0.05, 0.08], M: [0.10, 0.15], L: [0.20, 0.30] };

export function roundLabel(n) {
  if (n <= 2) return '결승';
  const size = 2 ** Math.ceil(Math.log2(n));
  return size === 4 ? '준결승(4강)' : size + '강';
}

export class Game {
  constructor() { this.problems = []; this.reset(); }

  reset(cfg) {
    this.cfg = { ...DEFAULT_CFG, ...(cfg || this.cfg || {}) };
    this.game = { status: 'lobby', startAt: 0, endAt: 0, pausedAt: 0 };
    this.mk = {};
    for (const s of STOCKS) this.mk[s.id] = { p: s.p0, f: s.p0, open: s.p0 };
    this.players = {};
    this.teams = {};
    this.queue = [];
    this.duels = {};
    this.seq = 0;
    this.nextNews = null;
    this.released = [];   // 공개된 문제 id (공개 순서)
    this.problems = this.problems || [];
    this.tour = null;
    this.newsLog = [];
    this.lastLb = 0;
    this.log = [];
    this.out = this.freshOut();
    this.out.all = true;
  }

  freshOut() {
    return { players: new Set(), teams: new Set(), inbox: [], prices: false, hist: [], news: [], lb: null, probs: false, arena: false, game: false, cfg: false, tour: false, all: false };
  }
  drain() { const o = this.out; this.out = this.freshOut(); return o; }

  // ---------- 저장/복구 ----------
  serialize() {
    return JSON.stringify({ cfg: this.cfg, game: this.game, mk: this.mk, queue: this.queue, duels: this.duels, seq: this.seq, nextNews: this.nextNews, problems: this.problems, released: this.released, tour: this.tour, newsLog: this.newsLog.slice(-30), log: this.log.slice(-30) });
  }
  // players: /players 노드, teams: /admin/teams 노드 (둘 다 변경 즉시 저장됨)
  restore(json, players, teams) {
    const s = JSON.parse(json);
    Object.assign(this, s);
    this.cfg = { ...DEFAULT_CFG, ...(this.cfg || {}) };
    this.log = this.log || [];
    this.problems = this.problems || []; this.released = (this.released || []).filter(id => this.problems.some(p => p.id === id));
    for (const st of STOCKS) if (!this.mk[st.id]) this.mk[st.id] = { p: st.p0, f: st.p0, open: st.p0 };
    this.teams = {};
    for (const [tid, t] of Object.entries(teams || {})) this.teams[tid] = normTeam(tid, t);
    this.players = {};
    for (const [uid, p] of Object.entries(players || {})) {
      if (!p || !p.team) continue;
      this.players[uid] = normPlayer(uid, p);
      if (!this.teams[p.team]) this.teams[p.team] = normTeam(p.team, { name: p.teamName });
    }
    for (const t of Object.values(this.teams)) t.members = Object.values(this.players).filter(p => p.team === t.id).map(p => p.uid);
    this.recountSolved();
    // 저장 시점 차이로 어긋난 아레나 상태 정리
    this.queue = (this.queue || []).filter(u => this.players[u]?.arena === 'queue');
    this.duels = this.duels || {};
    for (const p of Object.values(this.players)) {
      if (p.arena === 'queue' && !this.queue.includes(p.uid)) p.arena = 'none';
      if (p.duel && !this.duels[p.duel.id]) { p.duel = null; p.arena = 'none'; }
      if (p.duel) p.duel.used = Array.from({ length: 5 }, (_, i) => !!(p.duel.used || [])[i]);
    }
    this.out = this.freshOut();
    this.out.all = true;
  }

  // ---------- 유틸 ----------
  msg(uid, text, kind = 'info') { this.out.inbox.push({ uid, m: { text, kind } }); }
  msgTeam(tid, text, kind = 'info', except = null) { const t = this.teams[tid]; if (t) for (const u of t.members) if (u !== except) this.msg(u, text, kind); }
  dirty(uid) { this.out.players.add(uid); }
  dirtyTeam(tid) { const t = this.teams[tid]; if (!t) return; this.out.teams.add(tid); for (const u of t.members) this.out.players.add(u); }
  teamLog(t, text) { t.log.push(text); if (t.log.length > 12) t.log.shift(); }
  addLog(t) { this.log.push(t); if (this.log.length > 60) this.log.shift(); }
  prices() { const o = {}; for (const k in this.mk) o[k] = this.mk[k].p; return o; }
  worth(t) { return worthOf(t, this.prices()); }
  units(t) { return Math.max(1, t.invested / this.cfg.startCash); }
  credit(t) { return R(this.cfg.creditLimit * this.units(t)); }
  outLine(t) { return R(this.cfg.outLine * this.units(t)); }
  rate(t, w) { return ((w ?? this.worth(t)) - t.invested) / Math.max(1, t.invested); }
  active() { return this.game.status === 'running'; }
  teamOf(p) { return this.teams[p.team]; }
  activeTeams() { return Object.values(this.teams).filter(t => t.status === 'active' && t.members.length); }

  // ---------- 관리자 조작 ----------
  setCfg(patch, now = Date.now()) {
    if ('durationMin' in patch && (this.game.status === 'running' || this.game.status === 'paused')) {
      this.game.endAt += (Number(patch.durationMin) - this.cfg.durationMin) * 60e3; this.out.game = true;
    }
    for (const k in patch) if (k in DEFAULT_CFG) {
      const v = patch[k];
      this.cfg[k] = typeof DEFAULT_CFG[k] === 'number' ? Number(v) : v;
    }
    this.out.cfg = true;
    if (this.active() && 'newsEveryMin' in patch) this.scheduleNews(now);
    if ('probTries' in patch) this.out.probs = true;
  }

  start(now) {
    if (this.game.status !== 'lobby') return false;
    this.game = { status: 'running', startAt: now, endAt: now + this.cfg.durationMin * 60e3, pausedAt: 0 };
    for (const k in this.mk) this.mk[k].open = this.mk[k].p;
    this.scheduleNews(now);
    this.out.game = true;
    this.addLog('게임 시작');
    for (const p of Object.values(this.players)) this.msg(p.uid, '🔔 게임이 시작됐어! 거래 가능', 'good');
    return true;
  }

  pause(now) {
    if (this.game.status !== 'running') return false;
    this.game.status = 'paused'; this.game.pausedAt = now; this.out.game = true; this.addLog('일시정지');
    return true;
  }

  resume(now) {
    if (this.game.status !== 'paused') return false;
    const d = now - this.game.pausedAt;
    this.game.endAt += d; this.game.status = 'running';
    if (this.nextNews) this.nextNews.at += d;
    if (this.tour && this.tour.status === 'running') { this.tour.endsAt += d; this.out.tour = true; }
    for (const du of Object.values(this.duels)) { if (du.deadline) du.deadline += d; if (du.rewardDeadline) du.rewardDeadline += d; if (du.doneAt) du.doneAt += d; }
    for (const t of Object.values(this.teams)) {
      if (t.act.feeFreeUntil > this.game.pausedAt) { t.act.feeFreeUntil += d; this.dirtyTeam(t.id); }
      if (t.preview) { t.preview.at += d; this.dirtyTeam(t.id); }
    }
    this.game.pausedAt = 0;
    this.out.game = true; this.out.arena = true; this.addLog('재개');
    return true;
  }

  end(now) {
    if (this.game.status === 'ended') return false;
    if (this.tour && this.tour.status === 'running') this.endRound(now, true);
    this.game.status = 'ended'; this.game.endAt = now; this.out.game = true;
    this.queue = [];
    for (const p of Object.values(this.players)) { if (p.arena !== 'none' || p.duel) { p.arena = 'none'; p.duel = null; this.dirty(p.uid); } }
    this.duels = {}; this.out.arena = true;
    this.updateLeaderboard(now, true);
    this.addLog('게임 종료');
    return true;
  }

  // ---------- 참가자 요청 처리 ----------
  handle(req, now) {
    const uid = req.uid;
    if (!uid || typeof req.type !== 'string') return;
    if (req.type === 'join') return this.join(uid, req.name, req.team, now);
    const p = this.players[uid];
    if (!p || !this.teams[p.team]) return;
    try {
      switch (req.type) {
        case 'buy': return this.buy(p, req.s, req.q, now);
        case 'sell': return this.sell(p, req.s, req.q, now);
        case 'use': return this.useItem(p, req.item, now);
        case 'arenaJoin': return this.arenaJoin(p, now);
        case 'arenaLeave': return this.arenaLeave(p);
        case 'duelPlay': return this.duelPlay(p, req.id, req.i, now);
        case 'duelReward': return this.duelReward(p, req.id, req.choice, req.item, now);
        case 'answer': return this.answer(p, req.pid, req.part, req.a, now);
      }
    } catch (e) { console.error(e); }
  }

  join(uid, rawName, rawTeam, now) {
    const name = String(rawName || '').trim().replace(/\s+/g, ' ').slice(0, 12);
    if (this.players[uid]) { this.dirty(uid); return; }
    if (this.game.status === 'ended') return this.msg(uid, '게임이 이미 끝났어', 'bad');
    if (!name) return this.msg(uid, '닉네임을 입력해줘', 'bad');
    const n = Number(rawTeam);
    if (!Number.isInteger(n) || n < 1 || n > this.cfg.maxTeams) return this.msg(uid, `팀 번호는 1~${this.cfg.maxTeams} 사이로 써줘`, 'bad');
    const low = name.toLowerCase();
    if (Object.values(this.players).some(p => p.name.toLowerCase() === low)) return this.msg(uid, `"${name}"은(는) 이미 있는 닉네임이야`, 'bad');
    const tid = 't' + n;
    let t = this.teams[tid];
    if (!t) t = this.teams[tid] = normTeam(tid, { name: n + '팀' });
    t.cash += this.cfg.startCash; t.invested += this.cfg.startCash;
    // 토너먼트 라운드 중에 들어오면 그만큼 기준 자산도 올려서 수익률에 영향 없게
    if (this.tour && this.tour.status === 'running' && this.tour.start[tid] != null) { this.tour.start[tid] += this.cfg.startCash; }
    const p = normPlayer(uid, { name, team: tid, joinedAt: now });
    this.players[uid] = p;
    t.members.push(uid);
    this.teamLog(t, `👋 ${name} 합류 (+${W(this.cfg.startCash)}원)`);
    this.dirtyTeam(tid);
    this.addLog(`${name} → ${t.name} 입장`);
    this.msg(uid, `환영해, ${name}! ${t.name} 합류 (팀 자금 +${W(this.cfg.startCash)}원)`, 'good');
    this.msgTeam(tid, `👋 ${name}님이 우리 팀에 들어왔어`, 'info', uid);
    if (t.status === 'out') this.msg(uid, '⚠️ 이 팀은 이미 파산했어…', 'warn');
  }

  canTrade(p) {
    const t = this.teamOf(p);
    if (!this.active()) { this.msg(p.uid, this.game.status === 'paused' ? '지금은 일시정지 중이야' : '지금은 거래 시간이 아니야', 'bad'); return false; }
    if (t.status !== 'active') { this.msg(p.uid, '팀이 파산해서 거래할 수 없어', 'bad'); return false; }
    return true;
  }

  buy(p, s, q, now) {
    q = Math.floor(Number(q));
    const st = STOCKS.find(x => x.id === s);
    if (!st || !(q >= 1) || q > 1e7) return this.msg(p.uid, '수량이 이상해', 'bad');
    if (!this.canTrade(p)) return;
    const t = this.teamOf(p), m = this.mk[s];
    const feeFree = t.act.feeFreeUntil > now;
    const r = execBuy(m.p, q, st.depth * this.cfg.impactScale, feeFree ? 0 : this.cfg.feeRate);
    if (t.cash - r.total < -this.credit(t)) return this.msg(p.uid, `돈이 부족해 (팀 빚 한도 ${W(this.credit(t))}원)`, 'bad');
    t.cash -= r.total;
    const h = t.hold[s] || { q: 0, avg: 0 };
    h.avg = (h.q * h.avg + r.value) / (h.q + q); h.q += q; t.hold[s] = h;
    m.p = Math.max(st.min, m.p * Math.exp(r.x));
    m.f = Math.max(st.min, m.f * Math.exp(0.3 * r.x));
    this.out.prices = true;
    this.teamLog(t, `🔴 ${p.name}: ${st.name} ${W(q)}주 매수 (${W(r.total)}원)`);
    this.dirtyTeam(t.id);
    this.msg(p.uid, `✅ ${st.name} ${W(q)}주 매수 (평균 ${W(r.avgPx)}원${r.fee ? `, 수수료 ${W(r.fee)}원` : ', 수수료 면제'})`, 'good');
    if (t.cash < 0) this.msg(p.uid, `⚠️ 팀 현금이 마이너스야 (${W(t.cash)}원). 팀 총자산이 ${W(this.outLine(t))}원 이하가 되면 파산!`, 'warn');
  }

  sell(p, s, q, now) {
    q = Math.floor(Number(q));
    const st = STOCKS.find(x => x.id === s);
    const t = this.teamOf(p), h = t.hold[s];
    if (!st || !(q >= 1)) return this.msg(p.uid, '수량이 이상해', 'bad');
    if (!h || h.q < q) return this.msg(p.uid, '팀이 갖고 있는 주식보다 많이 팔 수 없어', 'bad');
    if (!this.canTrade(p)) return;
    const m = this.mk[s];
    const feeFree = t.act.feeFreeUntil > now;
    const r = execSell(m.p, q, st.depth * this.cfg.impactScale, feeFree ? 0 : this.cfg.feeRate);
    let proceeds = r.net;
    const cost = R(h.avg * q);
    const notes = [];
    if (t.act.shield && proceeds < cost) { notes.push(`🛡️ 손실 방지 발동! (${W(cost - proceeds)}원 손실 막음)`); proceeds = cost; t.act.shield = false; }
    if (t.act.double && proceeds > cost) { const bonus = proceeds - cost; notes.push(`✖️2 수익 2배 발동! (+${W(bonus)}원 보너스)`); proceeds += bonus; t.act.double = false; }
    t.cash += proceeds;
    h.q -= q; if (h.q <= 0) delete t.hold[s];
    m.p = Math.max(st.min, m.p * Math.exp(-r.x));
    m.f = Math.max(st.min, m.f * Math.exp(-0.3 * r.x));
    this.out.prices = true;
    const pl = proceeds - cost;
    this.teamLog(t, `🔵 ${p.name}: ${st.name} ${W(q)}주 매도 (${pl >= 0 ? '+' : ''}${W(pl)}원)`);
    this.dirtyTeam(t.id);
    this.msg(p.uid, `✅ ${st.name} ${W(q)}주 매도 → ${W(proceeds)}원 (${pl >= 0 ? '+' : ''}${W(pl)}원)`, pl >= 0 ? 'good' : 'bad');
    for (const n of notes) { this.msgTeam(t.id, `${p.name}: ${n}`, 'good'); this.teamLog(t, n); }
  }

  // ---------- 아이템 (팀 공유) ----------
  grantItem(t, why) {
    let tot = 0; for (const k in ITEM_WEIGHTS) tot += ITEM_WEIGHTS[k];
    let r = rnd() * tot, item = 'shield';
    for (const k in ITEM_WEIGHTS) { r -= ITEM_WEIGHTS[k]; if (r <= 0) { item = k; break; } }
    t.items[item] = (t.items[item] || 0) + 1;
    this.teamLog(t, `🎁 ${why} ${ITEMS[item].icon} ${ITEMS[item].name}`);
    this.dirtyTeam(t.id);
    this.msgTeam(t.id, `🎁 ${why} 팀 아이템 획득: ${ITEMS[item].icon} ${ITEMS[item].name}`, 'item');
    return item;
  }

  useItem(p, item, now) {
    const it = ITEMS[item];
    if (!it) return;
    const t = this.teamOf(p);
    if (!(t.items[item] > 0)) return this.msg(p.uid, '팀에 그 아이템이 없어', 'bad');
    if (!this.canTrade(p)) return;
    let note;
    if (item === 'shield') {
      if (t.act.shield) return this.msg(p.uid, '손실 방지가 이미 켜져 있어', 'bad');
      t.act.shield = true; note = '🛡️ 손실 방지 ON — 다음에 손해 보는 매도 1번은 본전';
    } else if (item === 'double') {
      if (t.act.double) return this.msg(p.uid, '수익 2배가 이미 켜져 있어', 'bad');
      t.act.double = true; note = '✖️2 수익 2배 ON — 다음에 이익 보는 매도 1번은 수익 2배';
    } else if (item === 'feefree') {
      t.act.feeFreeUntil = Math.max(now, t.act.feeFreeUntil) + this.cfg.feeFreeSec * 1000;
      note = `💸 수수료 면제 ON (${Math.round(this.cfg.feeFreeSec / 60 * 10) / 10}분)`;
    } else if (item === 'preview') {
      if (!this.nextNews) return this.msg(p.uid, '예정된 속보가 없어서 쓸 수 없어 (아이템은 그대로)', 'bad');
      t.preview = { at: this.nextNews.at, text: this.nextNews.text, s: this.nextNews.s, up: this.nextNews.mag > 0 };
      const sec = Math.max(0, Math.round((this.nextNews.at - now) / 1000));
      note = `📰 미리보기: "${this.nextNews.text}" — 약 ${Math.floor(sec / 60)}분 ${sec % 60}초 후 발표`;
    } else if (item === 'swap') {
      const cands = this.activeTeams().filter(o => o.id !== t.id);
      if (!cands.length) return this.msg(p.uid, '바꿀 상대 팀이 없어 (아이템은 그대로)', 'bad');
      const o = pick(cands);
      // 팀 규모가 달라도 공평하게: 상대 포트폴리오를 우리 팀 규모(투자금 비율)로 맞춰서 맞바꿈 → 수익률이 서로 바뀜
      const rt0 = this.rate(t), ro0 = this.rate(o);
      const k = t.invested / Math.max(1, o.invested);
      const pr = this.prices();
      // 주식 수는 정수로 반올림하고, 반올림으로 생긴 차이는 현금으로 정산
      const scale = (cash, hold, f) => { const h = {}; let c = cash * f; for (const [sid, x] of Object.entries(hold)) { const exact = x.q * f, q = Math.round(exact); c += (exact - q) * pr[sid]; if (q > 0) h[sid] = { q, avg: x.avg }; } return { cash: R(c), hold: h }; };
      const nt = scale(o.cash, o.hold, k), no = scale(t.cash, t.hold, 1 / k);
      t.cash = nt.cash; t.hold = nt.hold; o.cash = no.cash; o.hold = no.hold;
      const fmt = (x) => (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%';
      this.dirtyTeam(o.id);
      note = `🔄 수익률 교환! ${o.name}과(와) 수익률이 바뀜 (${fmt(rt0)} → ${fmt(this.rate(t))})`;
      this.teamLog(o, `🔄 ${t.name}이(가) 수익률 교환 사용 (${fmt(ro0)} → ${fmt(this.rate(o))})`);
      this.msgTeam(o.id, `🔄 ${t.name}이(가) 수익률 교환 아이템을 썼어! 우리 팀 수익률이 ${fmt(ro0)} → ${fmt(this.rate(o))}로 바뀌었어`, this.rate(o) >= ro0 ? 'good' : 'bad');
      this.addLog(`${t.name} ↔ ${o.name} 자산 교환`);
    }
    t.items[item]--; if (t.items[item] <= 0) delete t.items[item];
    this.teamLog(t, `${p.name}: ${note}`);
    this.dirtyTeam(t.id);
    this.msgTeam(t.id, `${p.name}: ${note}`, 'item');
  }

  // ---------- 속보 ----------
  genNews(s, dir, strength, text) {
    if (!s) s = rnd() < 0.15 ? 'ALL' : pick(STOCKS).id;
    if (!dir) dir = rnd() < 0.5 ? 'up' : 'down';
    if (!strength) { const r = rnd(); strength = r < 0.5 ? 'S' : r < 0.85 ? 'M' : 'L'; }
    const [lo, hi] = STRENGTH[strength] || STRENGTH.M;
    let mag = lo + rnd() * (hi - lo);
    if (dir === 'down') mag = -mag;
    if (!text) text = pick((dir === 'up' ? NEWS_UP : NEWS_DOWN)[s]);
    return { s, mag, text };
  }

  scheduleNews(now) {
    if (this.cfg.newsEveryMin > 0) {
      const n = this.genNews();
      n.at = now + this.cfg.newsEveryMin * 60e3 * (0.75 + 0.5 * rnd());
      this.nextNews = n;
    } else this.nextNews = null;
  }

  fireNews(n, now) {
    const ids = n.s === 'ALL' ? STOCKS.map(x => x.id) : [n.s];
    for (const id of ids) {
      const st = STOCKS.find(x => x.id === id);
      const m = this.mk[id];
      const mag = n.s === 'ALL' ? n.mag * (0.5 + rnd() * 0.7) : n.mag;
      const lg = Math.log(1 + mag);
      m.f = Math.max(st.min, m.f * Math.exp(lg));
      m.p = Math.max(st.min, m.p * Math.exp(lg * 0.55));
    }
    const item = { t: now, text: n.text, s: n.s, up: n.mag > 0 };
    this.newsLog.push(item); if (this.newsLog.length > 30) this.newsLog.shift();
    this.out.news.push(item);
    this.out.prices = true;
    for (const t of Object.values(this.teams)) if (t.preview) { t.preview = null; this.dirtyTeam(t.id); }
    this.addLog(`속보: ${n.text}`);
  }

  manualNews(s, dir, strength, text, now) {
    const n = this.genNews(s || null, dir || null, strength || null, (text || '').trim() || null);
    this.fireNews(n, now);
    return n;
  }

  // ---------- 문제 (제한시간 없음, 범위마다 팀당 probTries번, 범위 하나 해결 = 팀 아이템 1개) ----------
  recountSolved() {
    for (const p of this.problems) {
      p.solvedBy = {};
      for (const t of Object.values(this.teams)) for (let k = 0; k < p.parts.length; k++) if (t.solved && t.solved[p.id + '_' + k]) p.solvedBy[k] = (p.solvedBy[k] || 0) + 1;
    }
  }

  setProblems(list) {
    this.problems = list || [];
    this.recountSolved();
    this.released = this.released.filter(id => this.problems.some(p => p.id === id));
    this.out.probs = true;
  }

  releaseProblem(id, now) {
    if (id == null) { const next = this.problems.find(p => !this.released.includes(p.id)); if (!next) return '공개할 문제가 없어'; id = next.id; }
    const p = this.problems.find(x => x.id === id);
    if (!p) return '그런 문제가 없어';
    if (this.released.includes(id)) return '이미 공개된 문제야';
    this.released.push(id);
    this.out.probs = true;
    const n = this.released.length;
    for (const u of Object.keys(this.players)) this.msg(u, `📝 새 문제 공개! ${n}번 「${p.title}」 — 범위 ${p.parts.length}개, 범위 하나 풀 때마다 팀 아이템 1개`, 'item');
    this.addLog(`📝 문제 공개: ${p.title}`);
    this.lastRelease = { id, t: now, title: p.title, n, parts: p.parts.length };
    return null;
  }

  answer(pl, pid, partIdx, a, now) {
    const t = this.teamOf(pl);
    if (this.game.status === 'ended') return this.msg(pl.uid, '게임이 끝났어', 'bad');
    if (!this.released.includes(pid)) return this.msg(pl.uid, '아직 공개 안 된 문제야', 'bad');
    const prob = this.problems.find(x => x.id === pid);
    const k = Number(partIdx), part = prob && prob.parts[k];
    if (!part) return;
    const key = pid + '_' + k;
    if (t.solved[key]) return this.msg(pl.uid, '이미 팀이 해결한 범위야', 'info');
    const used = t.tries[key] || 0;
    if (used >= this.cfg.probTries) return this.msg(pl.uid, '이 범위는 기회를 다 썼어', 'bad');
    const label = prob.parts.length > 1 ? ` [${part.label}]` : '';
    if (!checkAnswer(part, a)) {
      t.tries[key] = used + 1;
      const left = this.cfg.probTries - used - 1;
      this.teamLog(t, `❌ ${pl.name}: 「${prob.title}」${label} 오답 (남은 기회 ${left})`);
      this.dirtyTeam(t.id);
      this.msg(pl.uid, `❌ 틀렸어! 「${prob.title}」${label} 팀 남은 기회 ${left}번`, 'bad');
      this.msgTeam(t.id, `❌ ${pl.name}이(가) 「${prob.title}」${label} 틀림 (팀 남은 기회 ${left}번)`, 'warn', pl.uid);
      return;
    }
    t.solved[key] = now;
    t.tries[key] = used + 1;
    prob.solvedBy = prob.solvedBy || {}; prob.solvedBy[k] = (prob.solvedBy[k] || 0) + 1;
    this.out.probs = true;
    this.dirtyTeam(t.id);
    this.addLog(`✅ ${t.name} ${pl.name}: ${prob.title}${label}`);
    if (t.status !== 'active') { this.msgTeam(t.id, `⭕ ${pl.name}이(가) 「${prob.title}」${label} 해결! (파산한 팀이라 아이템은 없어)`, 'warn'); return; }
    this.grantItem(t, `⭕ ${pl.name}이(가) 「${prob.title}」${label} 해결!`);
  }

  // ---------- 결투 (개인 vs 다른 팀 개인, 보상은 팀으로) ----------
  arenaJoin(p, now) {
    if (!this.canTrade(p)) return;
    if (p.arena !== 'none') return this.msg(p.uid, '이미 아레나에 있어', 'bad');
    this.queue = this.queue.filter(u => this.players[u] && this.players[u].arena === 'queue' && this.teams[this.players[u].team]?.status === 'active');
    const oppUid = this.queue.find(u => this.players[u].team !== p.team);
    if (oppUid) {
      this.queue = this.queue.filter(u => u !== oppUid);
      this.createDuel(this.players[oppUid], p, now);
    } else {
      this.queue.push(p.uid); p.arena = 'queue'; this.dirty(p.uid); this.out.arena = true;
      this.msg(p.uid, '⚔️ 아레나 입장! 다른 팀 상대를 기다리는 중…', 'info');
    }
  }

  arenaLeave(p) {
    if (p.arena !== 'queue') return;
    this.queue = this.queue.filter(u => u !== p.uid); p.arena = 'none'; this.dirty(p.uid); this.out.arena = true;
    this.msg(p.uid, '아레나에서 나왔어', 'info');
  }

  createDuel(a, b, now) {
    const id = 'd' + (++this.seq);
    const hand = () => Array.from({ length: 5 }, () => 1 + Math.floor(rnd() * 10));
    const ta = this.teamOf(a), tb = this.teamOf(b);
    this.duels[id] = { id, a: a.uid, b: b.uid, an: a.name, bn: b.name, at: ta.name, bt: tb.name, ta: ta.id, tb: tb.id, round: 1, sa: 0, sb: 0, rounds: [], status: 'play', deadline: now + this.cfg.duelRoundSec * 1000, pa: null, pb: null, winner: null };
    a.arena = 'duel'; a.duel = { id, side: 'a', hand: hand(), used: [false, false, false, false, false] };
    b.arena = 'duel'; b.duel = { id, side: 'b', hand: hand(), used: [false, false, false, false, false] };
    this.dirty(a.uid); this.dirty(b.uid); this.out.arena = true;
    this.msg(a.uid, `⚔️ 결투 시작! 상대: ${b.name} (${tb.name})`, 'item');
    this.msg(b.uid, `⚔️ 결투 시작! 상대: ${a.name} (${ta.name})`, 'item');
    this.msgTeam(ta.id, `⚔️ ${a.name}이(가) ${tb.name}의 ${b.name}과(와) 결투 시작!`, 'info', a.uid);
    this.msgTeam(tb.id, `⚔️ ${b.name}이(가) ${ta.name}의 ${a.name}과(와) 결투 시작!`, 'info', b.uid);
    this.addLog(`결투: ${a.name}(${ta.name}) vs ${b.name}(${tb.name})`);
  }

  duelPlay(p, id, i, now) {
    const d = this.duels[id];
    if (!d || d.status !== 'play' || !p.duel || p.duel.id !== id) return;
    i = Number(i);
    if (!(i >= 0 && i < 5) || p.duel.used[i]) return;
    const side = p.duel.side;
    if (d['p' + side] != null) return this.msg(p.uid, '이번 라운드엔 이미 냈어', 'bad');
    d['p' + side] = p.duel.hand[i]; p.duel.used[i] = true; this.dirty(p.uid); this.out.arena = true;
    if (d.pa != null && d.pb != null) this.resolveRound(d, now);
  }

  autoPlay(d) {
    for (const side of ['a', 'b']) {
      if (d['p' + side] != null) continue;
      const p = this.players[d[side]];
      if (!p || !p.duel) { d['p' + side] = 0; continue; }
      const free = p.duel.used.map((u, i) => u ? -1 : i).filter(i => i >= 0);
      const i = pick(free);
      d['p' + side] = p.duel.hand[i]; p.duel.used[i] = true; this.dirty(p.uid);
    }
  }

  resolveRound(d, now) {
    const ca = d.pa, cb = d.pb;
    d.rounds.push([ca, cb]);
    if (ca > cb) d.sa++; else if (cb > ca) d.sb++;
    d.pa = d.pb = null;
    d.round++;
    this.out.arena = true;
    if (d.round > 5) this.finishDuel(d, now);
    else d.deadline = now + this.cfg.duelRoundSec * 1000;
  }

  finishDuel(d, now) {
    const A = this.players[d.a], B = this.players[d.b];
    if (d.sa === d.sb) {
      d.status = 'done'; d.result = '무승부'; d.doneAt = now + 15000;
      for (const p of [A, B]) if (p) { p.arena = 'none'; p.duel = null; this.dirty(p.uid); this.msg(p.uid, `🤝 무승부! (${d.sa}:${d.sb})`, 'info'); }
      this.addLog(`결투 무승부: ${d.an} vs ${d.bn}`);
      return;
    }
    d.winner = d.sa > d.sb ? 'a' : 'b';
    const Wp = d.winner === 'a' ? A : B, Lp = d.winner === 'a' ? B : A;
    const LT = this.teams[d.winner === 'a' ? d.tb : d.ta];
    d.status = 'reward'; d.rewardDeadline = now + this.cfg.rewardSec * 1000; d.deadline = 0;
    d.loserHalf = this.duelSteal(LT);
    d.loserItems = LT ? { ...LT.items } : {};
    const hi = Math.max(d.sa, d.sb), lo = Math.min(d.sa, d.sb);
    if (Wp) this.msg(Wp.uid, `🏆 결투 승리! (${hi}:${lo}) 보상을 골라줘`, 'good');
    if (Lp) this.msg(Lp.uid, `💀 결투 패배… (${lo}:${hi}) 상대가 보상을 고르는 중`, 'bad');
  }

  duelReward(p, id, choice, item, now) {
    const d = this.duels[id];
    if (!d || d.status !== 'reward' || d[d.winner] !== p.uid) return;
    const WT = this.teams[d.winner === 'a' ? d.ta : d.tb];
    const LT = this.teams[d.winner === 'a' ? d.tb : d.ta];
    if (!WT) return this.endDuel(d, now);
    if (choice === 'item') {
      if (!LT || !(LT.items[item] > 0)) return this.msg(p.uid, '상대 팀이 그 아이템을 안 갖고 있어', 'bad');
      LT.items[item]--; if (LT.items[item] <= 0) delete LT.items[item];
      WT.items[item] = (WT.items[item] || 0) + 1;
      d.result = `${ITEMS[item].icon} ${ITEMS[item].name} 강탈`;
      this.teamLog(WT, `⚔️ ${p.name} 결투 승리 → ${LT.name}의 ${ITEMS[item].icon} ${ITEMS[item].name} 강탈`);
      this.teamLog(LT, `⚔️ 결투 패배 → ${ITEMS[item].icon} ${ITEMS[item].name} 빼앗김`);
      this.msgTeam(WT.id, `🎁 ${p.name}이(가) 결투로 ${ITEMS[item].icon} ${ITEMS[item].name}을(를) 빼앗았어!`, 'item');
      this.msgTeam(LT.id, `😭 결투에서 져서 ${ITEMS[item].icon} ${ITEMS[item].name}을(를) 빼앗겼어`, 'bad');
    } else {
      const amt = this.duelSteal(LT);
      if (LT) LT.cash -= amt;
      WT.cash += amt;
      d.result = `${W(amt)}원 획득`;
      this.teamLog(WT, `⚔️ ${p.name} 결투 승리 → ${LT ? LT.name : '?'}에게서 ${W(amt)}원`);
      if (LT) this.teamLog(LT, `⚔️ 결투 패배 → ${W(amt)}원 빼앗김`);
      this.msgTeam(WT.id, `💰 ${p.name}이(가) 결투로 ${W(amt)}원을 가져왔어!`, 'good');
      if (LT) this.msgTeam(LT.id, `💸 결투에서 져서 팀 재산 ${W(amt)}원을 빼앗겼어`, 'bad');
    }
    this.dirtyTeam(WT.id); if (LT) this.dirtyTeam(LT.id);
    this.addLog(`결투 결과: ${p.name}(${WT.name}) 승 — ${d.result}`);
    this.endDuel(d, now);
  }

  // 진 사람 몫(팀 재산 ÷ 팀원 수)의 duelStealPct%
  duelSteal(LT) {
    if (!LT) return 0;
    const share = this.worth(LT) / Math.max(1, LT.members.length);
    return Math.max(0, Math.floor(share * this.cfg.duelStealPct / 100));
  }

  endDuel(d, now) {
    d.status = 'done'; d.doneAt = now + 15000; this.out.arena = true;
    for (const u of [d.a, d.b]) { const p = this.players[u]; if (p) { p.arena = 'none'; p.duel = null; this.dirty(u); } }
  }

  // ---------- 토너먼트 (라운드 수익률 1:1) ----------
  startTournament(now) {
    if (!this.active()) return '게임이 진행 중일 때만 시작할 수 있어';
    if (this.tour && this.tour.status === 'running') return '이미 토너먼트 진행 중';
    const teams = shuffle(this.activeTeams().map(t => t.id));
    if (teams.length < 2) return '팀이 2개 이상 있어야 해';
    const nRounds = Math.ceil(Math.log2(teams.length));
    let len;
    if (this.cfg.tourRoundMin > 0) len = this.cfg.tourRoundMin * 60e3;
    else len = Math.floor((this.game.endAt - now - 15000) / nRounds);
    if (len < 60e3) return `시간이 부족해 (${nRounds}라운드가 필요해, 라운드당 최소 1분)`;
    this.tour = { status: 'running', round: 0, rounds: [this.pairUp(teams)], len, endsAt: 0, start: {}, champ: null, nRounds };
    this.beginRound(now);
    this.addLog(`🏟 토너먼트 시작: ${teams.length}팀, ${nRounds}라운드, 라운드당 ${Math.round(len / 6000) / 10}분`);
    return null;
  }

  pairUp(ids) {
    const ms = [];
    for (let i = 0; i < ids.length; i += 2) ms.push({ a: ids[i], b: ids[i + 1] || null, w: null, ra: 0, rb: 0 });
    // 부전승 팀이 항상 마지막이 되지 않게 섞기
    if (ids.length % 2) { const k = Math.floor(rnd() * ms.length); [ms[k], ms[ms.length - 1]] = [ms[ms.length - 1], ms[k]]; }
    return ms;
  }

  beginRound(now) {
    const T = this.tour, ms = T.rounds[T.round];
    T.start = {};
    for (const m of ms) for (const tid of [m.a, m.b]) if (tid && this.teams[tid]) T.start[tid] = this.worth(this.teams[tid]);
    T.endsAt = now + T.len;
    this.out.tour = true;
    const label = roundLabel(ms.reduce((n, m) => n + (m.b ? 2 : 1), 0));
    for (const m of ms) {
      const A = this.teams[m.a], B = m.b ? this.teams[m.b] : null;
      if (!B) { this.msgTeam(m.a, `🏟 토너먼트 ${label}: 부전승! 다음 라운드로 바로 올라가`, 'good'); continue; }
      this.msgTeam(m.a, `🏟 토너먼트 ${label} 시작! 상대: ${B.name} — 지금부터 수익률이 높은 팀이 이겨`, 'item');
      this.msgTeam(m.b, `🏟 토너먼트 ${label} 시작! 상대: ${A.name} — 지금부터 수익률이 높은 팀이 이겨`, 'item');
    }
  }

  roundRate(tid) {
    const t = this.teams[tid], T = this.tour;
    if (!t || T.start[tid] == null) return -Infinity;
    if (t.status === 'out') return -Infinity;
    return (this.worth(t) - T.start[tid]) / Math.max(1, t.invested);
  }

  liveRates() {
    const T = this.tour; if (!T || T.status !== 'running') return;
    for (const m of T.rounds[T.round]) { m.ra = this.roundRate(m.a); m.rb = m.b ? this.roundRate(m.b) : 0; }
  }

  endRound(now, final = false) {
    const T = this.tour; if (!T || T.status !== 'running') return;
    const ms = T.rounds[T.round];
    this.liveRates();
    const winners = [];
    const label = roundLabel(ms.reduce((n, m) => n + (m.b ? 2 : 1), 0));
    for (const m of ms) {
      if (!m.b) { m.w = 'a'; winners.push(m.a); continue; }
      let w;
      if (m.ra !== m.rb) w = m.ra > m.rb ? 'a' : 'b';
      else { const wa = this.teams[m.a] ? this.worth(this.teams[m.a]) : -Infinity, wb = this.teams[m.b] ? this.worth(this.teams[m.b]) : -Infinity; w = wa !== wb ? (wa > wb ? 'a' : 'b') : (rnd() < 0.5 ? 'a' : 'b'); }
      m.w = w;
      const win = w === 'a' ? m.a : m.b, lose = w === 'a' ? m.b : m.a;
      winners.push(win);
      const WT = this.teams[win], LT = this.teams[lose];
      const fmt = (x) => Number.isFinite(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%' : '파산';
      const rw = w === 'a' ? m.ra : m.rb, rl = w === 'a' ? m.rb : m.ra;
      if (WT) { this.msgTeam(win, `🏟 ${label} 승리! ${fmt(rw)} vs ${fmt(rl)} — 다음 라운드 진출`, 'good'); this.teamLog(WT, `🏟 ${label} 승리 vs ${LT ? LT.name : '?'} (${fmt(rw)} : ${fmt(rl)})`); }
      if (LT) { LT.tourOut = true; this.msgTeam(lose, `🏟 ${label} 탈락… ${fmt(rl)} vs ${fmt(rw)} (주식은 계속할 수 있어)`, 'bad'); this.teamLog(LT, `🏟 ${label} 탈락 vs ${WT ? WT.name : '?'}`); this.dirtyTeam(lose); }
      this.addLog(`🏟 ${label}: ${WT?.name} 승 vs ${LT?.name}`);
    }
    if (winners.length === 1) {
      T.status = 'done'; T.champ = winners[0]; T.endsAt = 0;
      const C = this.teams[winners[0]];
      if (C) { this.msgTeam(C.id, '🏆🏆 토너먼트 우승!! 🏆🏆', 'item'); this.teamLog(C, '🏆 토너먼트 우승!'); }
      this.addLog(`🏆 토너먼트 우승: ${C?.name}`);
    } else if (final) {
      T.status = 'done'; T.champ = null; T.unfinished = winners; T.endsAt = 0;
      this.addLog('토너먼트가 끝나기 전에 게임이 종료됐어');
    } else {
      T.rounds.push(this.pairUp(winners));
      T.round++;
      this.beginRound(now);
    }
    this.out.tour = true;
  }

  // ---------- 매 틱 ----------
  tick(now) {
    if (this.game.status !== 'running') return;
    const dt = TICK_MS / 60000;
    for (const st of STOCKS) {
      const m = this.mk[st.id];
      const sig = st.vol / 100 * Math.sqrt(dt);
      let lf = Math.log(m.f) + sig * 0.6 * gauss();
      let lp = Math.log(m.p) + sig * 0.8 * gauss();
      lp += 0.04 * (lf - lp);
      m.f = Math.max(st.min, Math.exp(lf));
      m.p = Math.max(st.min, Math.exp(lp));
    }
    this.out.prices = true;
    this.out.hist.push({ t: now, p: this.roundedPrices() });

    if (this.nextNews && now >= this.nextNews.at) { this.fireNews(this.nextNews, now); this.scheduleNews(now); }

    for (const d of Object.values(this.duels)) {
      if (d.status === 'play' && now >= d.deadline) { this.autoPlay(d); this.resolveRound(d, now); }
      else if (d.status === 'reward' && now >= d.rewardDeadline) {
        const Wp = this.players[d[d.winner]];
        if (Wp) this.duelReward(Wp, d.id, 'money', null, now); else this.endDuel(d, now);
      } else if (d.status === 'done' && now >= d.doneAt) { delete this.duels[d.id]; this.out.arena = true; }
    }

    if (this.tour && this.tour.status === 'running' && now >= this.tour.endsAt) this.endRound(now);
    if (now - this.lastLb >= 4000) this.updateLeaderboard(now);
    if (now >= this.game.endAt) this.end(now);
  }

  roundedPrices() { const o = {}; for (const k in this.mk) o[k] = R(this.mk[k].p); return o; }

  updateLeaderboard(now, final) {
    this.lastLb = now;
    const pr = this.prices();
    const rows = [];
    for (const t of Object.values(this.teams)) {
      if (!t.members.length && !t.invested) continue;
      let w = worthOf(t, pr);
      if (t.status === 'active' && w <= this.outLine(t) && !final) {
        for (const [s, h] of Object.entries(t.hold)) t.cash += R(h.q * pr[s]);
        t.hold = {}; t.status = 'out';
        for (const u of t.members) { const p = this.players[u]; if (p && p.arena === 'queue') { this.queue = this.queue.filter(x => x !== u); p.arena = 'none'; this.out.arena = true; } }
        this.teamLog(t, '💥 파산');
        this.dirtyTeam(t.id);
        this.msgTeam(t.id, `💥 팀 파산! 총자산이 ${W(this.outLine(t))}원 이하로 떨어져서 아웃됐어`, 'bad');
        this.addLog(`💥 ${t.name} 파산`);
        w = worthOf(t, pr);
      }
      rows.push([t.name, w, t.status === 'out' ? 1 : 0, Math.round(this.rate(t, w) * 10000) / 10000, t.members.length, t.id]);
    }
    rows.sort((x, y) => (x[2] - y[2]) || (y[3] - x[3]) || (y[1] - x[1]));
    this.out.lb = { t: now, list: rows, final: !!final };
    if (this.tour && this.tour.status === 'running') { this.liveRates(); this.out.tour = true; }
  }

  // ---------- 공개용 상태 ----------
  publicArena() {
    const duels = {};
    for (const d of Object.values(this.duels)) {
      duels[d.id] = { id: d.id, an: d.an, bn: d.bn, at: d.at || '', bt: d.bt || '', round: d.round, sa: d.sa, sb: d.sb, rounds: d.rounds, status: d.status, deadline: d.deadline || 0, rewardDeadline: d.rewardDeadline || 0, winner: d.winner || '', pa: d.pa != null, pb: d.pb != null, loserHalf: d.loserHalf || 0, loserItems: d.loserItems || {}, result: d.result || '' };
    }
    return { queue: this.queue.map(u => { const p = this.players[u]; return p ? `${p.name}(${this.teams[p.team]?.name || '?'})` : '?'; }), qteams: this.queue.map(u => this.players[u]?.team || ''), duels };
  }
  // 공개된 문제 (정답 없이) + 범위별 해결 팀 수
  publicProblems() {
    return this.released.map((id, i) => {
      const p = this.problems.find(x => x.id === id); if (!p) return null;
      return { id, n: i + 1, title: p.title, body: p.body, parts: p.parts.map((pt, k) => ({ label: pt.label, opts: pt.opts || null, solved: (p.solvedBy && p.solvedBy[k]) || 0 })) };
    }).filter(Boolean);
  }
  publicTour() {
    const T = this.tour; if (!T) return null;
    const nm = (id) => id ? (this.teams[id]?.name || '?') : '';
    const fin = (x) => Number.isFinite(x) ? Math.round(x * 100000) / 100000 : -999;
    return {
      status: T.status, round: T.round, endsAt: T.endsAt, len: T.len, nRounds: T.nRounds,
      champ: T.champ ? nm(T.champ) : '', champId: T.champ || '',
      rounds: T.rounds.map((ms, ri) => ({ label: roundLabel(ms.reduce((n, m) => n + (m.b ? 2 : 1), 0)), ms: ms.map(m => ({ a: nm(m.a), b: nm(m.b), ta: m.a, tb: m.b || '', w: m.w || '', ra: fin(m.ra), rb: fin(m.rb) })) })),
    };
  }
  publicTeam(t) {
    return { name: t.name, cash: t.cash, hold: t.hold, items: t.items, act: t.act, status: t.status, preview: t.preview, invested: t.invested, log: t.log, solved: t.solved, tries: t.tries, tourOut: !!t.tourOut, members: t.members.map(u => this.players[u]?.name || '?') };
  }
  publicPlayer(uid) {
    const p = this.players[uid], t = this.teams[p.team];
    return { name: p.name, team: p.team, arena: p.arena, duel: p.duel, joinedAt: p.joinedAt, t: t ? this.publicTeam(t) : null };
  }
  storedTeam(t) {
    return { name: t.name, cash: t.cash, hold: t.hold, items: t.items, act: t.act, status: t.status, preview: t.preview, invested: t.invested, log: t.log, solved: t.solved, tries: t.tries, tourOut: !!t.tourOut };
  }
}

function normPlayer(uid, p) {
  return { uid, name: p.name || '?', team: p.team, arena: p.arena || 'none', duel: p.duel || null, joinedAt: p.joinedAt || 0 };
}
function normTeam(id, t) {
  t = t || {};
  return {
    id, name: t.name || id.replace(/^t/, '') + '팀', cash: Number(t.cash) || 0, hold: t.hold || {}, items: t.items || {},
    act: { shield: false, double: false, feeFreeUntil: 0, ...(t.act || {}) },
    status: t.status || 'active', preview: t.preview || null, invested: Number(t.invested) || 0,
    log: Array.isArray(t.log) ? t.log : Object.values(t.log || {}), solved: t.solved || {}, tries: t.tries || {}, tourOut: !!t.tourOut, members: [],
  };
}
