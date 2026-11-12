/* common.js - helpers shared by every page */

const CSRF_TOKEN = document.querySelector('meta[name="csrf-token"]')?.content || '';
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** fetch() wrapper: JSON in/out, CSRF header, friendly errors. */
async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF_TOKEN },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Can't reach the server. Check your connection and try again.");
  }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }

  if (res.status === 401) {
    window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname);
    throw new Error('Please sign in to continue.');
  }
  if (!res.ok) {
    const err = new Error(data?.error || 'Something went wrong. Try again.');
    err.field = data?.field;
    throw err;
  }
  return data;
}

/** Animate a number from 0 to `to`. Falls back to instant for reduced motion. */
function countUp(el, to, { duration = 1300, decimals = 0, suffix = '' } = {}) {
  const format = (v) => v.toFixed(decimals) + suffix;
  if (REDUCED_MOTION || duration <= 0) { el.textContent = format(to); return; }
  const start = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3); // easeOutCubic
  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    el.textContent = format(to * ease(t));
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function debounce(fn, ms = 250) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

function formatDate(iso, withTime = false) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, withTime
    ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Escape text before putting it into innerHTML. */
function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const LEVEL_TEXT = { low: 'Low risk', moderate: 'Moderate risk', high: 'High risk' };
