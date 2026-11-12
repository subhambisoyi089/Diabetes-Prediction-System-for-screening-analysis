/* dashboard.js - saved assessments, trend chart, per-row PDF and delete */

const $ = (id) => document.getElementById(id);
const MINUS = '\u2212';

const tip = $('chartTip'); // created once; re-attached to the chart on every render
const levelOf = (risk) => (risk < 30 ? 'low' : risk < 50 ? 'moderate' : 'high');

/* ---------------- toast ---------------- */
let toastTimer;
function toast(message) {
  let el = $('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

/* ---------------- load + render ---------------- */
async function load() {
  let data;
  try {
    data = await api('/api/history');
  } catch (err) {
    $('dashLede').textContent = err.message;
    return;
  }
  const items = data.assessments; // oldest first

  if (!items.length) {
    $('dashEmpty').hidden = false;
    $('dashContent').hidden = true;
    $('dashLede').textContent = 'Every check you save shows up here.';
    return;
  }
  $('dashEmpty').hidden = true;
  $('dashContent').hidden = false;
  $('dashLede').textContent = `${data.user}, here is how your numbers have moved.`;

  renderStats(items);
  renderChart(items);
  renderTable(items);
}

function renderStats(items) {
  const first = items[0];
  const last = items[items.length - 1];
  $('statCount').textContent = items.length;
  $('statRisk').textContent = `${last.risk_percent}%`;
  $('statScore').textContent = last.health_score;

  const change = $('statChange');
  if (items.length < 2) {
    change.textContent = '—';
    change.removeAttribute('data-trend');
  } else {
    const diff = +(last.risk_percent - first.risk_percent).toFixed(1);
    change.textContent = diff === 0 ? 'No change' : `${diff < 0 ? MINUS : '+'}${Math.abs(diff)} pts`;
    // lower risk is better
    change.dataset.trend = diff < 0 ? 'good' : diff > 0 ? 'bad' : 'flat';
  }
}

/* ---------------- trend chart (plain SVG) ---------------- */
function renderChart(items) {
  const chart = $('trendChart');
  const W = 720, H = 300;
  const pad = { l: 44, r: 24, t: 16, b: 40 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const x = (i) => (items.length === 1 ? pad.l + innerW / 2 : pad.l + (innerW * i) / (items.length - 1));
  const y = (v) => pad.t + innerH * (1 - v / 100);

  const grid = [0, 25, 50, 75, 100].map((v) => `
    <line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>
    <text class="axis" x="${pad.l - 10}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('');

  // ~6 date labels at most
  const step = Math.max(1, Math.ceil(items.length / 6));
  const labels = items.map((it, i) => (i % step === 0 || i === items.length - 1) ? `
    <text class="axis" x="${x(i)}" y="${H - 14}" text-anchor="middle">${esc(formatDate(it.created_at).replace(/,? \d{4}$/, ''))}</text>` : '').join('');

  const path = (key) => items.map((it, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(it[key]).toFixed(1)}`).join(' ');
  const dots = (key, cls) => items.map((it, i) =>
    `<circle class="dot ${cls}" data-i="${i}" cx="${x(i).toFixed(1)}" cy="${y(it[key]).toFixed(1)}" r="4.5"/>`).join('');

  chart.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      ${grid}${labels}
      ${items.length > 1 ? `<path class="line line-risk" pathLength="1" d="${path('risk_percent')}"/>
      <path class="line line-health" pathLength="1" d="${path('health_score')}"/>` : ''}
      ${dots('risk_percent', 'dot-risk')}${dots('health_score', 'dot-health')}
    </svg>`;
  chart.appendChild(tip);
  tip.hidden = true;

  const svg = chart.querySelector('svg');
  const show = (i, target) => {
    const it = items[i];
    tip.innerHTML = `<strong>${esc(formatDate(it.created_at))}</strong>
      <span>Risk score ${it.risk_percent}%</span><span>Health score ${it.health_score}</span>`;
    tip.hidden = false;
    const box = chart.getBoundingClientRect();
    const dot = target.getBoundingClientRect();
    let left = dot.left - box.left + dot.width / 2;
    left = Math.min(Math.max(left, 90), box.width - 90);
    tip.style.left = `${left}px`;
    tip.style.top = `${dot.top - box.top - 12}px`;
  };
  svg.addEventListener('pointerover', (e) => {
    const dot = e.target.closest('.dot');
    if (dot) show(Number(dot.dataset.i), dot);
  });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; });
}

/* ---------------- table ---------------- */
function renderTable(items) {
  const rows = [...items].reverse(); // newest first
  $('historyBody').innerHTML = rows.map((it) => {
    const level = levelOf(it.risk_percent);
    return `
      <tr data-id="${it.id}">
        <td>${esc(formatDate(it.created_at, true))}</td>
        <td class="num">${it.risk_percent}%</td>
        <td><span class="chip chip-${level}">${LEVEL_TEXT[level]}</span></td>
        <td class="num">${it.health_score}</td>
        <td class="num">${it.bmi ?? '—'}</td>
        <td class="num">${it.glucose ?? '—'}</td>
        <td class="row-actions">
          <button class="link-btn" type="button" data-action="report" data-id="${it.id}">Report</button>
          <button class="link-btn danger" type="button" data-action="delete" data-id="${it.id}">Delete</button>
        </td>
      </tr>`;
  }).join('');
}

$('historyBody').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;

  if (btn.dataset.action === 'report') {
    btn.disabled = true;
    try {
      const d = await api(`/api/history/${id}`);
      Report.download({ name: d.user, created_at: d.created_at, result: d.result });
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  }

  if (btn.dataset.action === 'delete') {
    if (!window.confirm("Delete this check? This can't be undone.")) return;
    btn.disabled = true;
    try {
      await api(`/api/history/${id}`, { method: 'DELETE' });
      toast('Check deleted.');
      await load();
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  }
});

load();
