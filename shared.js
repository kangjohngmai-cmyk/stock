// 참가자 화면과 엔진이 같이 쓰는 정의/계산

export const TICK_MS = 2000;

// vol: 분당 변동성(%), depth: 시장 깊이(원) — 작을수록 거래량에 가격이 크게 흔들림
export const STOCKS = [
  { id: 'DAL', name: '달빛전자', sector: '반도체', p0: 52000, vol: 1.8, depth: 60e6, min: 100, color: '#7c9cff' },
  { id: 'QRK', name: '쿼크바이오', sector: '바이오', p0: 18000, vol: 3.8, depth: 30e6, min: 50, color: '#3ddc97' },
  { id: 'BUN', name: '번개물류', sector: '물류', p0: 31000, vol: 2.0, depth: 45e6, min: 100, color: '#ffb547' },
  { id: 'NYM', name: '냠냠푸드', sector: '식품', p0: 12000, vol: 1.2, depth: 40e6, min: 50, color: '#ff7aa8' },
  { id: 'PXL', name: '픽셀게임즈', sector: '게임', p0: 45000, vol: 3.0, depth: 40e6, min: 100, color: '#b47cff' },
  { id: 'SUN', name: '햇살에너지', sector: '에너지', p0: 27000, vol: 2.4, depth: 40e6, min: 100, color: '#ffd84d' },
  { id: 'SKY', name: '하늘항공', sector: '항공', p0: 21000, vol: 2.2, depth: 40e6, min: 100, color: '#4dd6ff' },
  { id: 'CAT', name: '냥냥코인', sector: '코인', p0: 1500, vol: 6.0, depth: 20e6, min: 5, color: '#ff8a4d' },
];

export const ITEMS = {
  shield: { icon: '🛡️', name: '손실 방지', desc: '켜 두면, 다음에 손해 보면서 팔 때 1번은 본전(평균 매수가)으로 팔려.' },
  double: { icon: '✖️2', name: '수익 2배', desc: '켜 두면, 다음에 이익 보면서 팔 때 1번은 수익이 2배가 돼.' },
  feefree: { icon: '💸', name: '수수료 면제', desc: '3분 동안 매수·매도 수수료가 0원.' },
  preview: { icon: '📰', name: '속보 미리보기', desc: '다음 정기 속보 내용과 발표 시간을 먼저 알려줘.' },
  swap: { icon: '🔄', name: '자산 교환', desc: '내 현금+주식 전부가 무작위 참가자 1명의 것과 통째로 바뀌어. 도박!' },
};
export const ITEM_WEIGHTS = { shield: 25, double: 20, feefree: 20, preview: 20, swap: 15 };

export const DEFAULT_CFG = {
  startCash: 1000000,
  feeRate: 0.005,       // 수수료 0.5%
  creditLimit: 1000000, // 현금은 이만큼 마이너스까지 가능(빚)
  outLine: -500000,     // 총자산이 이 이하면 파산
  durationMin: 60,
  newsEveryMin: 4,
  quizEveryMin: 6,
  quizSec: 40,
  quizMode: 'all',      // 'all' 정답자 전원 / 'first' 선착순
  quizTopN: 10,
  impactScale: 1,       // 거래량 영향 배율의 역수(클수록 덜 흔들림)
  duelRoundSec: 20,
  rewardSec: 30,
  feeFreeSec: 180,
};

const R = Math.round;

export function execBuy(p, q, L, feeRate) {
  const x = q * p / L;
  const avgPx = x > 1e-9 ? p * (Math.exp(x) - 1) / x : p;
  const value = R(avgPx * q);
  const fee = R(value * feeRate);
  return { x, avgPx, value, fee, total: value + fee };
}

export function execSell(p, q, L, feeRate) {
  const x = q * p / L;
  const avgPx = x > 1e-9 ? p * (1 - Math.exp(-x)) / x : p;
  const value = R(avgPx * q);
  const fee = R(value * feeRate);
  return { x, avgPx, value, fee, net: value - fee };
}

// 살 수 있는 최대 수량 (budget 원 이하)
export function maxBuyQty(p, L, feeRate, budget) {
  if (budget <= 0) return 0;
  let lo = 0, hi = Math.max(1, Math.ceil(budget / p) + 1);
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (execBuy(p, mid, L, feeRate).total <= budget) lo = mid; else hi = mid - 1;
  }
  return lo;
}

export function worthOf(player, prices) {
  let w = Number(player.cash) || 0;
  for (const [s, h] of Object.entries(player.hold || {})) w += R((h.q || 0) * (prices[s] || 0));
  return w;
}

export function normAns(a) {
  const s = String(a ?? '').trim().toLowerCase().replace(/\s+/g, '').replace(/,/g, '');
  const n = Number(s);
  if (s !== '' && Number.isFinite(n)) return 'n:' + n;
  return 's:' + s;
}

export const won = (n) => (Math.round(n) || 0).toLocaleString('ko-KR');
export const signed = (n) => (n > 0 ? '+' : '') + won(n);
export const pct = (x) => (x > 0 ? '+' : '') + (x * 100).toFixed(2) + '%';

// 퀴즈 텍스트 파싱
// Q: 문제
// O: 보기1 | 보기2 | 보기3   (선택, 있으면 객관식 → A는 번호)
// A: 정답   (주관식은 A: 를 여러 줄 써서 정답 여러 개 허용)
export function parseQuizzes(text) {
  const out = [], errs = [];
  const blocks = String(text || '').replace(/\r/g, '').split(/\n\s*\n/);
  blocks.forEach((b, bi) => {
    const lines = b.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return;
    let q = '', opts = null; const ans = [];
    for (const l of lines) {
      const m = l.match(/^([QOAqoa])\s*[:：]\s*(.*)$/);
      if (!m) { if (q && !opts && !ans.length) q += '\n' + l; continue; }
      const k = m[1].toUpperCase(), v = m[2].trim();
      if (k === 'Q') q = v; else if (k === 'O') opts = v.split('|').map(s => s.trim()).filter(Boolean); else ans.push(v);
    }
    if (!q || !ans.length) { errs.push(`${bi + 1}번째 문제: Q 또는 A가 없어`); return; }
    if (opts) {
      const n = parseInt(ans[0], 10);
      if (!(n >= 1 && n <= opts.length)) { errs.push(`${bi + 1}번째 문제: 객관식 정답은 1~${opts.length} 번호로 써줘`); return; }
      out.push({ q, opts, ans: n - 1 });
    } else out.push({ q, opts: null, ans: ans.length === 1 ? ans[0] : ans });
  });
  return { quizzes: out, errs };
}
