// =====================================================
// 모의 주식 게임 엔진 (관리자 브라우저에서만 실행됨)
// Firebase와 무관한 순수 로직. 상태 변경 결과는 out(dirty)에 모아 둔다.
// =====================================================
import { STOCKS, ITEMS, ITEM_WEIGHTS, DEFAULT_CFG, TICK_MS, execBuy, execSell, worthOf, normAns } from './shared.js';

const rnd = Math.random;
function gauss() { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const pick = (a) => a[Math.floor(rnd() * a.length)];
const R = Math.round;

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

export class Game {
  constructor() { this.reset(); }

  reset(cfg) {
    this.cfg = { ...DEFAULT_CFG, ...(cfg || this.cfg || {}) };
    this.game = { status: 'lobby', startAt: 0, endAt: 0, pausedAt: 0 };
    this.mk = {};
    for (const s of STOCKS) this.mk[s.id] = { p: s.p0, f: s.p0, open: s.p0 };
    this.players = {};
    this.queue = [];
    this.duels = {};
    this.seq = 0;
    this.nextNews = null;
    this.nextQuizAt = 0;
    this.quizIdx = 0;
    this.quiz = null;
    this.quizzes = this.quizzes || [];
    this.newsLog = [];
    this.lastLb = 0;
    this.log = [];
    this.out = this.freshOut();
    this.out.all = true;
  }

  freshOut() {
    return { players: new Set(), inbox: [], prices: false, hist: [], news: [], lb: null, quiz: false, quizLast: null, arena: false, game: false, cfg: false, all: false, wipe: false };
  }
  drain() { const o = this.out; this.out = this.freshOut(); return o; }

  // ---------- 저장/복구 ----------
  serialize() {
    return JSON.stringify({ cfg: this.cfg, game: this.game, mk: this.mk, queue: this.queue, duels: this.duels, seq: this.seq, nextNews: this.nextNews, nextQuizAt: this.nextQuizAt, quizIdx: this.quizIdx, quiz: this.quiz, quizzes: this.quizzes, newsLog: this.newsLog.slice(-30) });
  }
  restore(json, players) {
    const s = JSON.parse(json);
    Object.assign(this, s);
    for (const st of STOCKS) if (!this.mk[st.id]) this.mk[st.id] = { p: st.p0, f: st.p0, open: st.p0 };
    this.players = {};
    for (const [uid, p] of Object.entries(players || {})) this.players[uid] = normPlayer(uid, p);
    // 저장 시점 차이로 어긋난 아레나 상태 정리
    this.queue = (this.queue || []).filter(u => this.players[u]?.arena === 'queue');
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
  dirty(uid) { this.out.players.add(uid); }
  addLog(t) { this.log.push(t); if (this.log.length > 60) this.log.shift(); }
  prices() { const o = {}; for (const k in this.mk) o[k] = this.mk[k].p; return o; }
  worth(p) { return worthOf(p, this.prices()); }
  active() { return this.game.status === 'running'; }
  activePlayers() { return Object.values(this.players).filter(p => p.status === 'active'); }

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
    // 간격 변경 시 일정 재계산
    if (this.active()) {
      if ('newsEveryMin' in patch) this.scheduleNews(now);
      if ('quizEveryMin' in patch) this.nextQuizAt = this.cfg.quizEveryMin > 0 ? now + this.cfg.quizEveryMin * 60e3 : 0;
    }
  }

  start(now) {
    if (this.game.status !== 'lobby') return false;
    this.game = { status: 'running', startAt: now, endAt: now + this.cfg.durationMin * 60e3, pausedAt: 0 };
    for (const k in this.mk) this.mk[k].open = this.mk[k].p;
    this.scheduleNews(now);
    this.nextQuizAt = this.cfg.quizEveryMin > 0 ? now + this.cfg.quizEveryMin * 60e3 : 0;
    this.out.game = true;
    this.addLog('게임 시작');
    for (const p of this.activePlayers()) this.msg(p.uid, '🔔 게임이 시작됐어! 거래 가능', 'good');
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
    this.game.endAt += d; this.game.status = 'running'; this.game.pausedAt = 0;
    if (this.nextNews) this.nextNews.at += d;
    if (this.nextQuizAt) this.nextQuizAt += d;
    if (this.quiz) { this.quiz.endsAt += d; this.out.quiz = true; }
    for (const du of Object.values(this.duels)) { if (du.deadline) du.deadline += d; if (du.rewardDeadline) du.rewardDeadline += d; if (du.doneAt) du.doneAt += d; }
    for (const p of Object.values(this.players)) {
      if (p.act.feeFreeUntil > this.game.pausedAt) { p.act.feeFreeUntil += d; this.dirty(p.uid); }
      if (p.preview) { p.preview.at += d; this.dirty(p.uid); }
    }
    this.out.game = true; this.out.arena = true; this.addLog('재개');
    return true;
  }

  end(now) {
    if (this.game.status === 'ended') return false;
    this.game.status = 'ended'; this.game.endAt = now; this.out.game = true;
    if (this.quiz) this.closeQuiz();
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
    if (req.type === 'join') return this.join(uid, req.name, now);
    const p = this.players[uid];
    if (!p) return;
    try {
      switch (req.type) {
        case 'buy': return this.buy(p, req.s, req.q, now);
        case 'sell': return this.sell(p, req.s, req.q, now);
        case 'use': return this.useItem(p, req.item, now);
        case 'arenaJoin': return this.arenaJoin(p, now);
        case 'arenaLeave': return this.arenaLeave(p);
        case 'duelPlay': return this.duelPlay(p, req.id, req.i, now);
        case 'duelReward': return this.duelReward(p, req.id, req.choice, req.item, now);
        case 'quizAnswer': return this.quizAnswer(p, req.id, req.a, now);
      }
    } catch (e) { console.error(e); }
  }

  join(uid, rawName, now) {
    const name = String(rawName || '').trim().replace(/\s+/g, ' ').slice(0, 12);
    if (this.players[uid]) { this.dirty(uid); return; }
    if (this.game.status === 'ended') return this.msg(uid, '게임이 이미 끝났어', 'bad');
    if (!name) return this.msg(uid, '닉네임을 입력해줘', 'bad');
    const low = name.toLowerCase();
    if (Object.values(this.players).some(p => p.name.toLowerCase() === low)) return this.msg(uid, `"${name}"은(는) 이미 있는 닉네임이야`, 'bad');
    const p = normPlayer(uid, { name, cash: this.cfg.startCash, joinedAt: now });
    this.players[uid] = p;
    this.dirty(uid);
    this.addLog(`${name} 입장`);
    this.msg(uid, `환영해, ${name}! 시작 자금 ${this.cfg.startCash.toLocaleString()}원`, 'good');
  }

  canTrade(p) {
    if (!this.active()) { this.msg(p.uid, this.game.status === 'paused' ? '지금은 일시정지 중이야' : '지금은 거래 시간이 아니야', 'bad'); return false; }
    if (p.status !== 'active') { this.msg(p.uid, '파산해서 거래할 수 없어', 'bad'); return false; }
    return true;
  }

  buy(p, s, q, now) {
    q = Math.floor(Number(q));
    const st = STOCKS.find(x => x.id === s);
    if (!st || !(q >= 1) || q > 1e7) return this.msg(p.uid, '수량이 이상해', 'bad');
    if (!this.canTrade(p)) return;
    const m = this.mk[s];
    const feeFree = p.act.feeFreeUntil > now;
    const r = execBuy(m.p, q, st.depth * this.cfg.impactScale, feeFree ? 0 : this.cfg.feeRate);
    if (p.cash - r.total < -this.cfg.creditLimit) return this.msg(p.uid, `돈이 부족해 (빚 한도 ${this.cfg.creditLimit.toLocaleString()}원)`, 'bad');
    p.cash -= r.total;
    const h = p.hold[s] || { q: 0, avg: 0 };
    h.avg = (h.q * h.avg + r.value) / (h.q + q); h.q += q; p.hold[s] = h;
    m.p = Math.max(st.min, m.p * Math.exp(r.x));
    m.f = Math.max(st.min, m.f * Math.exp(0.3 * r.x));
    this.out.prices = true; this.dirty(p.uid);
    this.msg(p.uid, `✅ ${st.name} ${q.toLocaleString()}주 매수 (평균 ${R(r.avgPx).toLocaleString()}원${r.fee ? `, 수수료 ${r.fee.toLocaleString()}원` : ', 수수료 면제'})`, 'good');
    if (p.cash < 0) this.msg(p.uid, `⚠️ 현금이 마이너스야 (${p.cash.toLocaleString()}원). 총자산이 ${this.cfg.outLine.toLocaleString()}원 이하가 되면 파산!`, 'warn');
  }

  sell(p, s, q, now) {
    q = Math.floor(Number(q));
    const st = STOCKS.find(x => x.id === s);
    const h = p.hold[s];
    if (!st || !(q >= 1)) return this.msg(p.uid, '수량이 이상해', 'bad');
    if (!h || h.q < q) return this.msg(p.uid, '갖고 있는 주식보다 많이 팔 수 없어', 'bad');
    if (!this.canTrade(p)) return;
    const m = this.mk[s];
    const feeFree = p.act.feeFreeUntil > now;
    const r = execSell(m.p, q, st.depth * this.cfg.impactScale, feeFree ? 0 : this.cfg.feeRate);
    let proceeds = r.net;
    const cost = R(h.avg * q);
    const notes = [];
    if (p.act.shield && proceeds < cost) { notes.push(`🛡️ 손실 방지 발동! (${(cost - proceeds).toLocaleString()}원 손실 막음)`); proceeds = cost; p.act.shield = false; }
    if (p.act.double && proceeds > cost) { const bonus = proceeds - cost; notes.push(`✖️2 수익 2배 발동! (+${bonus.toLocaleString()}원 보너스)`); proceeds += bonus; p.act.double = false; }
    p.cash += proceeds;
    h.q -= q; if (h.q <= 0) delete p.hold[s];
    m.p = Math.max(st.min, m.p * Math.exp(-r.x));
    m.f = Math.max(st.min, m.f * Math.exp(-0.3 * r.x));
    this.out.prices = true; this.dirty(p.uid);
    const pl = proceeds - cost;
    this.msg(p.uid, `✅ ${st.name} ${q.toLocaleString()}주 매도 → ${proceeds.toLocaleString()}원 (${pl >= 0 ? '+' : ''}${pl.toLocaleString()}원)`, pl >= 0 ? 'good' : 'bad');
    for (const n of notes) this.msg(p.uid, n, 'good');
  }

  // ---------- 아이템 ----------
  grantItem(p, why) {
    let tot = 0; for (const k in ITEM_WEIGHTS) tot += ITEM_WEIGHTS[k];
    let r = rnd() * tot, item = 'shield';
    for (const k in ITEM_WEIGHTS) { r -= ITEM_WEIGHTS[k]; if (r <= 0) { item = k; break; } }
    p.items[item] = (p.items[item] || 0) + 1;
    this.dirty(p.uid);
    this.msg(p.uid, `🎁 ${why} 아이템 획득: ${ITEMS[item].icon} ${ITEMS[item].name}`, 'item');
    return item;
  }

  useItem(p, item, now) {
    const it = ITEMS[item];
    if (!it) return;
    if (!(p.items[item] > 0)) return this.msg(p.uid, '그 아이템이 없어', 'bad');
    if (!this.canTrade(p)) return;
    if (item === 'shield') {
      if (p.act.shield) return this.msg(p.uid, '손실 방지가 이미 켜져 있어', 'bad');
      p.act.shield = true; this.msg(p.uid, '🛡️ 손실 방지 ON — 다음에 손해 보는 매도 1번은 본전으로 팔려', 'good');
    } else if (item === 'double') {
      if (p.act.double) return this.msg(p.uid, '수익 2배가 이미 켜져 있어', 'bad');
      p.act.double = true; this.msg(p.uid, '✖️2 수익 2배 ON — 다음에 이익 보는 매도 1번의 수익이 2배', 'good');
    } else if (item === 'feefree') {
      p.act.feeFreeUntil = Math.max(now, p.act.feeFreeUntil) + this.cfg.feeFreeSec * 1000;
      this.msg(p.uid, `💸 수수료 면제 ON (${Math.round(this.cfg.feeFreeSec / 60 * 10) / 10}분)`, 'good');
    } else if (item === 'preview') {
      if (!this.nextNews) return this.msg(p.uid, '예정된 속보가 없어서 쓸 수 없어 (아이템은 그대로)', 'bad');
      p.preview = { at: this.nextNews.at, text: this.nextNews.text, s: this.nextNews.s, up: this.nextNews.mag > 0 };
      const sec = Math.max(0, Math.round((this.nextNews.at - now) / 1000));
      this.msg(p.uid, `📰 미리보기: "${this.nextNews.text}" — 약 ${Math.floor(sec / 60)}분 ${sec % 60}초 후 발표`, 'item');
    } else if (item === 'swap') {
      const cands = this.activePlayers().filter(o => o.uid !== p.uid && o.arena !== 'duel');
      if (!cands.length) return this.msg(p.uid, '바꿀 상대가 없어 (아이템은 그대로)', 'bad');
      const o = pick(cands);
      const before = this.worth(p);
      [p.cash, o.cash] = [o.cash, p.cash];
      [p.hold, o.hold] = [o.hold, p.hold];
      const after = this.worth(p);
      this.dirty(o.uid);
      const d = after - before;
      this.msg(p.uid, `🔄 자산 교환! ${o.name}님과 재산이 바뀌었어 (${d >= 0 ? '+' : ''}${d.toLocaleString()}원)`, d >= 0 ? 'good' : 'bad');
      this.msg(o.uid, `🔄 누군가 자산 교환 아이템을 썼어! ${p.name}님과 재산이 바뀌었어 (${-d >= 0 ? '+' : ''}${(-d).toLocaleString()}원)`, -d >= 0 ? 'good' : 'bad');
      this.addLog(`${p.name} ↔ ${o.name} 자산 교환`);
    }
    p.items[item]--; if (p.items[item] <= 0) delete p.items[item];
    this.dirty(p.uid);
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
    for (const p of Object.values(this.players)) if (p.preview) { p.preview = null; this.dirty(p.uid); }
    this.addLog(`속보: ${n.text}`);
  }

  manualNews(s, dir, strength, text, now) {
    const n = this.genNews(s || null, dir || null, strength || null, (text || '').trim() || null);
    this.fireNews(n, now);
    return n;
  }

  // ---------- 퀴즈 ----------
  startQuiz(idx, now) {
    if (this.quiz) return '이미 퀴즈 진행 중';
    if (idx == null) idx = this.quizIdx;
    const q = this.quizzes[idx];
    if (!q) return '남은 퀴즈가 없어';
    this.quizIdx = Math.max(this.quizIdx, idx + 1);
    this.quiz = { id: 'q' + (++this.seq), n: idx + 1, q: q.q, opts: q.opts || null, ans: q.ans, endsAt: now + this.cfg.quizSec * 1000, answered: {}, correct: [] };
    this.out.quiz = true;
    this.addLog(`퀴즈 ${idx + 1} 출제`);
    return null;
  }

  quizAnswer(p, id, a, now) {
    const z = this.quiz;
    if (!z || z.id !== id) return this.msg(p.uid, '이미 끝난 퀴즈야', 'bad');
    if (now > z.endsAt + 1500) return this.msg(p.uid, '시간 초과!', 'bad');
    if (z.answered[p.uid]) return this.msg(p.uid, '이미 답을 냈어', 'bad');
    z.answered[p.uid] = true;
    let ok;
    if (z.opts) ok = String(a) === String(z.ans);
    else ok = (Array.isArray(z.ans) ? z.ans : [z.ans]).some(x => normAns(x) === normAns(a));
    if (!ok) return this.msg(p.uid, '❌ 땡! 틀렸어', 'bad');
    z.correct.push(p.uid);
    if (this.cfg.quizMode === 'first' && z.correct.length > this.cfg.quizTopN) return this.msg(p.uid, `⭕ 정답! 근데 선착순 ${this.cfg.quizTopN}명이 이미 마감됐어`, 'warn');
    if (p.status !== 'active') return this.msg(p.uid, '⭕ 정답! (파산 상태라 아이템은 없어)', 'warn');
    this.grantItem(p, '⭕ 정답!');
  }

  closeQuiz() {
    const z = this.quiz; if (!z) return;
    const ansText = z.opts ? `${Number(z.ans) + 1}번 ${z.opts[z.ans]}` : (Array.isArray(z.ans) ? z.ans[0] : z.ans);
    this.out.quizLast = { id: z.id, n: z.n, q: z.q, ans: ansText, correct: z.correct.length, answered: Object.keys(z.answered).length, names: z.correct.slice(0, 10).map(u => this.players[u]?.name || '?') };
    this.quiz = null; this.out.quiz = true;
    this.addLog(`퀴즈 ${z.n} 종료: 정답자 ${z.correct.length}명`);
  }

  // ---------- 결투 ----------
  arenaJoin(p, now) {
    if (!this.canTrade(p)) return;
    if (p.arena !== 'none') return this.msg(p.uid, '이미 아레나에 있어', 'bad');
    this.queue = this.queue.filter(u => this.players[u] && this.players[u].status === 'active' && this.players[u].arena === 'queue');
    const oppUid = this.queue.find(u => u !== p.uid);
    if (oppUid) {
      this.queue = this.queue.filter(u => u !== oppUid);
      this.createDuel(this.players[oppUid], p, now);
    } else {
      this.queue.push(p.uid); p.arena = 'queue'; this.dirty(p.uid); this.out.arena = true;
      this.msg(p.uid, '⚔️ 아레나 입장! 상대를 기다리는 중…', 'info');
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
    this.duels[id] = { id, a: a.uid, b: b.uid, an: a.name, bn: b.name, round: 1, sa: 0, sb: 0, rounds: [], status: 'play', deadline: now + this.cfg.duelRoundSec * 1000, pa: null, pb: null, winner: null };
    a.arena = 'duel'; a.duel = { id, side: 'a', hand: hand(), used: [false, false, false, false, false] };
    b.arena = 'duel'; b.duel = { id, side: 'b', hand: hand(), used: [false, false, false, false, false] };
    this.dirty(a.uid); this.dirty(b.uid); this.out.arena = true;
    this.msg(a.uid, `⚔️ 결투 시작! 상대: ${b.name}`, 'item');
    this.msg(b.uid, `⚔️ 결투 시작! 상대: ${a.name}`, 'item');
    this.addLog(`결투: ${a.name} vs ${b.name}`);
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
    const W = d.winner === 'a' ? A : B, L = d.winner === 'a' ? B : A;
    d.status = 'reward'; d.rewardDeadline = now + this.cfg.rewardSec * 1000; d.deadline = 0;
    d.loserHalf = L ? Math.max(0, Math.floor(this.worth(L) / 2)) : 0;
    d.loserItems = L ? { ...L.items } : {};
    if (W) this.msg(W.uid, `🏆 결투 승리! (${Math.max(d.sa, d.sb)}:${Math.min(d.sa, d.sb)}) 보상을 골라줘`, 'good');
    if (L) this.msg(L.uid, `💀 결투 패배… (${Math.min(d.sa, d.sb)}:${Math.max(d.sa, d.sb)}) 상대가 보상을 고르는 중`, 'bad');
  }

  duelReward(p, id, choice, item, now) {
    const d = this.duels[id];
    if (!d || d.status !== 'reward' || d[d.winner] !== p.uid) return;
    const L = this.players[d.winner === 'a' ? d.b : d.a];
    if (choice === 'item') {
      if (!L || !(L.items[item] > 0)) return this.msg(p.uid, '상대가 그 아이템을 안 갖고 있어', 'bad');
      L.items[item]--; if (L.items[item] <= 0) delete L.items[item];
      p.items[item] = (p.items[item] || 0) + 1;
      d.result = `${ITEMS[item].icon} ${ITEMS[item].name} 강탈`;
      this.msg(p.uid, `🎁 ${ITEMS[item].icon} ${ITEMS[item].name}을(를) 빼앗았어!`, 'item');
      if (L) this.msg(L.uid, `😭 ${ITEMS[item].icon} ${ITEMS[item].name}을(를) 빼앗겼어`, 'bad');
    } else {
      const amt = L ? Math.max(0, Math.floor(this.worth(L) / 2)) : 0;
      if (L) { L.cash -= amt; this.dirty(L.uid); }
      p.cash += amt;
      d.result = `재산 절반 ${amt.toLocaleString()}원 획득`;
      this.msg(p.uid, `💰 상대 재산 절반 ${amt.toLocaleString()}원을 가져왔어!`, 'good');
      if (L) this.msg(L.uid, `💸 재산 절반 ${amt.toLocaleString()}원을 빼앗겼어`, 'bad');
    }
    this.addLog(`결투 결과: ${p.name} 승 — ${d.result}`);
    this.endDuel(d, now);
  }

  endDuel(d, now) {
    d.status = 'done'; d.doneAt = now + 15000; this.out.arena = true;
    for (const u of [d.a, d.b]) { const p = this.players[u]; if (p) { p.arena = 'none'; p.duel = null; this.dirty(u); } }
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
    if (this.quiz && now >= this.quiz.endsAt) this.closeQuiz();
    if (!this.quiz && this.nextQuizAt && now >= this.nextQuizAt) {
      if (this.quizIdx < this.quizzes.length) this.startQuiz(null, now);
      this.nextQuizAt = this.cfg.quizEveryMin > 0 ? now + this.cfg.quizEveryMin * 60e3 : 0;
    }

    for (const d of Object.values(this.duels)) {
      if (d.status === 'play' && now >= d.deadline) { this.autoPlay(d); this.resolveRound(d, now); }
      else if (d.status === 'reward' && now >= d.rewardDeadline) {
        const W = this.players[d[d.winner]];
        if (W) this.duelReward(W, d.id, 'money', null, now); else this.endDuel(d, now);
      } else if (d.status === 'done' && now >= d.doneAt) { delete this.duels[d.id]; this.out.arena = true; }
    }

    if (now - this.lastLb >= 4000) this.updateLeaderboard(now);
    if (now >= this.game.endAt) this.end(now);
  }

  roundedPrices() { const o = {}; for (const k in this.mk) o[k] = R(this.mk[k].p); return o; }

  updateLeaderboard(now, final) {
    this.lastLb = now;
    const pr = this.prices();
    const rows = [];
    for (const p of Object.values(this.players)) {
      let w = worthOf(p, pr);
      if (p.status === 'active' && w <= this.cfg.outLine && !final) {
        for (const [s, h] of Object.entries(p.hold)) p.cash += R(h.q * pr[s]);
        p.hold = {}; p.status = 'out';
        if (p.arena === 'queue') { this.queue = this.queue.filter(u => u !== p.uid); p.arena = 'none'; this.out.arena = true; }
        this.dirty(p.uid);
        this.msg(p.uid, `💥 파산! 총자산이 ${this.cfg.outLine.toLocaleString()}원 이하로 떨어져서 아웃됐어`, 'bad');
        this.addLog(`💥 ${p.name} 파산`);
        w = worthOf(p, pr);
      }
      rows.push([p.name, w, p.status === 'out' ? 1 : 0]);
    }
    rows.sort((x, y) => (x[2] - y[2]) || (y[1] - x[1]));
    this.out.lb = { t: now, list: rows, final: !!final };
  }

  // 공개용 상태
  publicArena() {
    const duels = {};
    for (const d of Object.values(this.duels)) {
      duels[d.id] = { id: d.id, an: d.an, bn: d.bn, round: d.round, sa: d.sa, sb: d.sb, rounds: d.rounds, status: d.status, deadline: d.deadline || 0, rewardDeadline: d.rewardDeadline || 0, winner: d.winner || '', pa: d.pa != null, pb: d.pb != null, loserHalf: d.loserHalf || 0, loserItems: d.loserItems || {}, result: d.result || '' };
    }
    return { queue: this.queue.map(u => this.players[u]?.name || '?'), duels };
  }
  publicQuiz() {
    const z = this.quiz; if (!z) return null;
    return { id: z.id, n: z.n, q: z.q, opts: z.opts, endsAt: z.endsAt };
  }
  publicPlayer(uid) {
    const p = this.players[uid];
    return { name: p.name, cash: p.cash, hold: p.hold, items: p.items, act: p.act, status: p.status, arena: p.arena, duel: p.duel, preview: p.preview, joinedAt: p.joinedAt };
  }
}

function normPlayer(uid, p) {
  return {
    uid, name: p.name || '?', cash: Number(p.cash) || 0, hold: p.hold || {}, items: p.items || {},
    act: { shield: false, double: false, feeFreeUntil: 0, ...(p.act || {}) },
    status: p.status || 'active', arena: p.arena || 'none', duel: p.duel || null, preview: p.preview || null, joinedAt: p.joinedAt || 0,
  };
}
