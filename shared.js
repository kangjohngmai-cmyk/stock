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
  preview: { icon: '📰', name: '속보 미리보기', desc: '다음 정기 속보 내용과 발표 시간을 팀 전원에게 먼저 알려줘.' },
  swap: { icon: '🔄', name: '수익률 교환', desc: '무작위 다른 팀과 수익률을 맞바꿔 (상대 포트폴리오를 우리 팀 규모에 맞춰서 받아). 도박!' },
};
export const ITEM_WEIGHTS = { shield: 25, double: 20, feefree: 20, preview: 20, swap: 15 };

export const DEFAULT_CFG = {
  startCash: 1000000,   // 팀원 1명당 팀에 들어오는 돈
  feeRate: 0.005,       // 수수료 0.5%
  creditLimit: 1000000, // 팀원 1명당 빚 한도 (팀 현금이 이만큼×인원 마이너스까지 가능)
  outLine: -500000,     // 팀원 1명당 파산 기준 (팀 총자산이 이 값×인원 이하면 파산)
  maxTeams: 20,         // 팀 번호 1~maxTeams
  tourRoundMin: 0,      // 토너먼트 라운드 길이(분), 0이면 남은 시간에 맞춰 자동
  duelStealPct: 50,     // 결투 승리 시 가져오는 돈: 진 사람 몫(팀 재산÷팀원 수)의 몇 %
  durationMin: 60,
  newsEveryMin: 4,
  probTries: 3,         // 문제 범위마다 팀당 시도 횟수
  volScale: 2,          // 주가 변동성 배율 (1 = 처음 버전, 클수록 크게 출렁임)
  newsScale: 1.5,       // 속보 세기 배율
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

// 정답 비교용 정규화: 공백·쉼표 무시, 대소문자 무시.
// 정수는 문자열로 비교해서 아주 큰 수(2^53 넘는 수)도 정확하게 비교함. 1024 = 1024.0 = +1024 = 001024
export function normAns(a) {
  let s = String(a ?? '').trim().toLowerCase().replace(/\s+/g, '').replace(/,/g, '');
  if (s === '') return 's:';
  const im = s.match(/^([+-]?)0*(\d+)$/);
  if (im) { const d = im[2] || '0'; return 'i:' + (im[1] === '-' && d !== '0' ? '-' : '') + d; }
  const dm = s.match(/^([+-]?)0*(\d*)\.(\d*?)0*$/);
  if (dm && (dm[2] || dm[3])) {
    if (!dm[3]) { const d = dm[2] || '0'; return 'i:' + (dm[1] === '-' && d !== '0' ? '-' : '') + d; }
  }
  const n = Number(s);
  if (Number.isFinite(n) && /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/.test(s)) {
    if (Number.isInteger(n) && Math.abs(n) < 2 ** 53) return 'i:' + String(n);
    return 'n:' + n;
  }
  return 's:' + s;
}

export const won = (n) => (Math.round(n) || 0).toLocaleString('ko-KR');
export const signed = (n) => (n > 0 ? '+' : '') + won(n);
export const pct = (x) => (x > 0 ? '+' : '') + (x * 100).toFixed(2) + '%';

// ---------- 문제 텍스트 파싱 ----------
// T: 제목            (선택)
// Q: 문제 본문        (여기부터 다음 P/O/A 줄 전까지 전부 본문, 빈 줄도 OK)
// P: 1 ≤ N ≤ 100    (범위/부분 문제 이름. 없으면 범위 1개짜리 문제)
// A: 정답            (A: 를 여러 줄 쓰면 정답 여러 개 인정)
// O: 보기1 | 보기2   (객관식이면, 그 범위의 A는 정답 번호)
// 다음 T: 나 Q: 가 나오면 새 문제
function hashStr(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); }

export function parseProblems(text) {
  const out = [], errs = [];
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  let cur = null, part = null;
  const flush = () => { if (cur && (cur.body || cur.title || cur.parts.length)) out.push(cur); cur = null; part = null; };
  const ensure = () => { if (!cur) cur = { title: '', body: '', parts: [], inBody: false }; };
  for (const raw of lines) {
    const m = raw.match(/^\s*([TQPOAtqpoa])\s*[:：]\s?(.*)$/);
    if (!m) { if (cur && cur.inBody) cur.body += '\n' + raw.replace(/\s+$/, ''); continue; }
    const k = m[1].toUpperCase(), v = m[2].trim();
    if (k === 'T') { if (cur && (cur.body || cur.parts.length)) flush(); ensure(); cur.title = v; continue; }
    if (k === 'Q') { if (cur && (cur.body || cur.parts.length)) flush(); ensure(); cur.body = v; cur.inBody = true; continue; }
    ensure(); cur.inBody = false;
    if (k === 'P') { part = { label: v || ('범위 ' + (cur.parts.length + 1)), ans: [], opts: null }; cur.parts.push(part); continue; }
    if (!part) { part = { label: '정답', ans: [], opts: null }; cur.parts.push(part); }
    if (k === 'O') part.opts = v.split('|').map(x => x.trim()).filter(Boolean);
    else if (k === 'A') part.ans.push(v);
  }
  flush();
  const res = [];
  out.forEach((p, i) => {
    const name = `${i + 1}번째 문제`;
    p.body = p.body.replace(/\n+$/, '').trim();
    if (!p.body) { errs.push(`${name}: Q: 본문이 없어`); return; }
    if (!p.parts.length) { errs.push(`${name}: A: 정답이 없어`); return; }
    const parts = [];
    for (const pt of p.parts) {
      if (!pt.ans.length) { errs.push(`${name} "${pt.label}": A: 정답이 없어`); return; }
      if (pt.opts) {
        const n = parseInt(pt.ans[0], 10);
        if (!(n >= 1 && n <= pt.opts.length)) { errs.push(`${name} "${pt.label}": 객관식 정답은 1~${pt.opts.length} 번호로 써줘`); return; }
        parts.push({ label: pt.label, opts: pt.opts, ans: n - 1 });
      } else parts.push({ label: pt.label, opts: null, ans: pt.ans });
    }
    const title = p.title || (p.body.split('\n')[0].slice(0, 24) + (p.body.length > 24 ? '…' : ''));
    res.push({ id: 'p' + hashStr(title + '\u0001' + p.body), title, body: p.body, parts });
  });
  // 같은 문제가 두 번 들어간 경우 id 겹치지 않게
  const seen = {};
  for (const p of res) { if (seen[p.id]) p.id += '_' + (++seen[p.id]); else seen[p.id] = 1; }
  return { problems: res, errs };
}

export function checkAnswer(part, a) {
  if (part.opts) return String(a) === String(part.ans);
  return [].concat(part.ans).some(x => normAns(x) === normAns(a));
}
