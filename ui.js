// 화면 공통 도우미
export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const cls = (x) => x > 0 ? 'up' : x < 0 ? 'down' : 'flat';
export const mmss = (ms) => { ms = Math.max(0, ms); const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function toast(text, kind = 'info', ms = 3200) {
  const box = document.getElementById('toasts'); if (!box) return;
  const d = document.createElement('div'); d.className = 'toast ' + kind; d.textContent = text;
  box.appendChild(d);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => d.remove(), ms);
}

// 선 그래프
export function drawLine(cv, vals, opt = {}) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  if (!vals || vals.length < 2) {
    if (opt.axis) { c.fillStyle = '#5d6785'; c.font = '13px Pretendard, sans-serif'; c.textAlign = 'center'; c.fillText('데이터 모으는 중…', w / 2, h / 2); }
    return;
  }
  const padR = opt.axis ? 58 : 2, padT = 6, padB = 6;
  let mn = Math.min(...vals), mx = Math.max(...vals);
  if (opt.base != null) { mn = Math.min(mn, opt.base); mx = Math.max(mx, opt.base); }
  if (mx - mn < mx * 0.002) { mx += mx * 0.002; mn -= mn * 0.002; }
  const X = i => (i / (vals.length - 1)) * (w - padR);
  const Y = v => padT + (1 - (v - mn) / (mx - mn)) * (h - padT - padB);
  const last = vals[vals.length - 1];
  const color = opt.color || (opt.base != null ? (last >= opt.base ? '#ff4d5e' : '#3d8bff') : '#7c6cff');
  if (opt.axis) {
    c.strokeStyle = 'rgba(141,151,179,.12)'; c.lineWidth = 1; c.fillStyle = '#5d6785'; c.font = '11px Pretendard, sans-serif'; c.textAlign = 'left';
    for (let k = 0; k <= 3; k++) {
      const v = mn + (mx - mn) * k / 3, y = Y(v);
      c.beginPath(); c.moveTo(0, y); c.lineTo(w - padR, y); c.stroke();
      c.fillText(Math.round(v).toLocaleString(), w - padR + 6, y + 4);
    }
  }
  if (opt.base != null) {
    c.setLineDash([4, 4]); c.strokeStyle = 'rgba(141,151,179,.45)'; c.beginPath(); c.moveTo(0, Y(opt.base)); c.lineTo(w - padR, Y(opt.base)); c.stroke(); c.setLineDash([]);
  }
  c.beginPath();
  vals.forEach((v, i) => i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v)));
  c.strokeStyle = color; c.lineWidth = opt.width || 2; c.lineJoin = 'round'; c.stroke();
  if (opt.fill) {
    c.lineTo(X(vals.length - 1), h); c.lineTo(0, h); c.closePath();
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, color + '55'); g.addColorStop(1, color + '00');
    c.fillStyle = g; c.fill();
  }
  if (opt.axis) {
    c.fillStyle = color; c.beginPath(); c.arc(X(vals.length - 1), Y(last), 3.5, 0, 7); c.fill();
  }
}
