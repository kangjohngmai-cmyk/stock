// 관리자 창에서 돌아가는 엔진: 게임 로직(Game)을 Firebase에 연결
import { fb } from './fb.js';
import { Game } from './game-core.js';
import { TICK_MS } from './shared.js';

const LOCK_STALE = 15000;

export class Engine {
  constructor(onUpdate) {
    this.onUpdate = onUpdate || (() => {});
    this.offset = 0;
    this.g = new Game();
    this.running = false;
    this.lockId = Math.random().toString(36).slice(2);
    this.flushTimer = null;
    this.lastSave = 0;
    this.reqCount = 0;
    this.writeErr = null;
  }

  now() { return Date.now() + this.offset; }

  async checkLock() {
    const lock = await fb.get('admin/lock');
    if (lock && lock.id !== this.lockId && this.now() - lock.t < LOCK_STALE) return lock;
    return null;
  }

  async boot() {
    fb.offset(v => { this.offset = v; });
    await new Promise(r => setTimeout(r, 400));
    const [snap, players] = await Promise.all([fb.get('admin/engine'), fb.get('players')]);
    if (snap) {
      try { this.g.restore(snap, players || {}); }
      catch (e) { console.error('복구 실패, 새로 시작', e); this.g = new Game(); }
    } else {
      this.g = new Game();
      // 이전 엔진 기록 없이 참가자만 남아 있으면 그대로 살림
      if (players) this.g.restore(this.g.serialize(), players);
    }
    await fb.set('admin/lock', { id: this.lockId, t: this.now() });
    this.running = true;
    this.flush(true);

    this.unsubReq = fb.onAdded('requests', null, (key, val) => {
      if (!this.running) return;
      fb.remove('requests/' + key).catch(() => {});
      if (!val || typeof val !== 'object') return;
      this.reqCount++;
      try { this.g.handle(val, this.now()); } catch (e) { console.error(e); }
      this.scheduleFlush();
    });

    // 백그라운드 탭에서도 덜 느려지도록 Worker 타이머 사용
    const blob = new Blob([`setInterval(()=>postMessage(0), ${TICK_MS});`], { type: 'text/javascript' });
    this.worker = new Worker(URL.createObjectURL(blob));
    this.worker.onmessage = () => this.onTick();
    this.lockTimer = setInterval(() => this.heartbeat(), 5000);
  }

  async heartbeat() {
    if (!this.running) return;
    try {
      const lock = await fb.get('admin/lock');
      if (lock && lock.id !== this.lockId) { this.stop('다른 관리자 창이 엔진을 가져갔어. 이 창의 엔진은 멈췄어.'); return; }
      await fb.set('admin/lock', { id: this.lockId, t: this.now() });
    } catch (e) { console.error(e); }
  }

  stop(reason) {
    this.running = false;
    if (this.worker) this.worker.terminate();
    if (this.unsubReq) this.unsubReq();
    clearInterval(this.lockTimer);
    this.stopReason = reason;
    this.onUpdate();
  }

  onTick() {
    if (!this.running) return;
    const now = this.now();
    try { this.g.tick(now); } catch (e) { console.error(e); }
    this.flush();
    if (now - this.lastSave > 10000) { this.lastSave = now; this.save(); }
  }

  save() { return fb.set('admin/engine', this.g.serialize()).catch(e => console.error('save', e)); }

  scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flush(); }, 80);
  }

  flush(all = false) {
    const g = this.g, o = g.drain(), now = this.now();
    if (o.all) all = true;
    const up = {};
    if (all) {
      for (const uid in g.players) o.players.add(uid);
      o.prices = o.game = o.cfg = o.arena = o.quiz = true;
      g.updateLeaderboard(now);
      const o2 = g.drain();
      o.lb = o2.lb; o.inbox.push(...o2.inbox); for (const u of o2.players) o.players.add(u);
    }
    for (const uid of o.players) if (g.players[uid]) up['players/' + uid] = g.publicPlayer(uid);
    for (const { uid, m } of o.inbox) up['inbox/' + uid + '/' + fb.newKey('inbox/' + uid)] = { ...m, t: now };
    if (o.prices) {
      const p = g.roundedPrices(), open = {};
      for (const k in g.mk) open[k] = Math.round(g.mk[k].open);
      up['market/prices'] = { t: now, p, open };
    }
    for (const h of o.hist) up['market/hist/' + fb.newKey('market/hist')] = h;
    for (const n of o.news) up['news/' + fb.newKey('news')] = n;
    if (o.lb) up['leaderboard'] = o.lb;
    if (o.quiz) up['quiz/current'] = g.publicQuiz();
    if (o.quizLast) up['quiz/last'] = o.quizLast;
    if (o.arena) up['arena'] = g.publicArena();
    if (o.game) up['game'] = g.game;
    if (o.cfg) up['config'] = g.cfg;
    if (Object.keys(up).length) {
      fb.update(up).then(() => { this.writeErr = null; }).catch(e => { this.writeErr = e.message; console.error('write', e); });
    }
    if (o.game) this.save();
    this.onUpdate(o);
  }

  // ---------- 관리자 버튼 ----------
  act(fn) { const r = fn(this.now()); this.flush(); this.save(); return r; }
  start() { return this.act(n => this.g.start(n)); }
  pause() { return this.act(n => this.g.pause(n)); }
  resume() { return this.act(n => this.g.resume(n)); }
  end() { return this.act(n => this.g.end(n)); }
  setCfg(patch) { return this.act(n => this.g.setCfg(patch, n)); }
  news(s, dir, strength, text) { return this.act(n => this.g.manualNews(s, dir, strength, text, n)); }
  startQuiz(idx) { return this.act(n => this.g.startQuiz(idx, n)); }
  closeQuiz() { return this.act(() => this.g.closeQuiz()); }
  setQuizzes(list) { this.g.quizzes = list; if (this.g.quizIdx > list.length) this.g.quizIdx = list.length; this.save(); this.onUpdate(); }
  setQuizIdx(i) { this.g.quizIdx = Math.max(0, Math.min(this.g.quizzes.length, i)); this.save(); this.onUpdate(); }
  grant(uid, item) {
    const p = this.g.players[uid]; if (!p) return;
    return this.act(() => { p.items[item] = (p.items[item] || 0) + 1; this.g.dirty(uid); this.g.msg(uid, '🎁 운영자가 아이템을 줬어!', 'item'); });
  }
  revive(uid) {
    const p = this.g.players[uid]; if (!p || p.status !== 'out') return;
    return this.act(() => { p.status = 'active'; p.cash = Math.max(p.cash, 0); this.g.dirty(uid); this.g.msg(uid, '✨ 운영자가 부활시켜 줬어!', 'good'); });
  }
  kick(uid) {
    const p = this.g.players[uid]; if (!p) return;
    this.g.queue = this.g.queue.filter(u => u !== uid);
    delete this.g.players[uid];
    fb.remove('players/' + uid); this.flush(); this.save();
  }

  async resetAll() {
    this.running = false;
    const keep = { cfg: this.g.cfg, quizzes: this.g.quizzes };
    await fb.update({ players: null, inbox: null, requests: null, news: null, 'market/hist': null, arena: null, quiz: null, leaderboard: null });
    this.g = new Game();
    this.g.cfg = { ...this.g.cfg, ...keep.cfg };
    this.g.quizzes = keep.quizzes;
    this.running = true;
    this.flush(true);
    await this.save();
  }
}
