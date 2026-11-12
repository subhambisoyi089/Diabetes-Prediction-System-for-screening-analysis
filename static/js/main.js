/* main.js - the "Check your risk" page */

const $ = (id) => document.getElementById(id);
const state = { bmi: null, estimate: null, result: null };

const GAUGE_LENGTH = 314.16; // half circle, r = 100
const RING_LENGTH = 263.9;   // full circle, r = 42
const MINUS = '\u2212';

const num = (id) => {
  const v = $(id).value.trim();
  return v === '' ? NaN : Number(v);
};

/* ------------------------------------------------------------------ *
 * Sliders
 * ------------------------------------------------------------------ */
const SLIDERS = ['sugar_diet', 'activity', 'stress', 'salt_intake'];

function syncSlider(input) {
  const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty('--pct', pct + '%');
  const out = document.querySelector(`output[for="${input.id}"]`);
  if (out) {
    out.textContent = input.value;
    // Bounce the value label
    out.classList.remove('popped');
    void out.offsetWidth;
    out.classList.add('popped');
  }
}

/* ------------------------------------------------------------------ *
 * Live BMI + lifestyle estimates (server does the maths)
 * ------------------------------------------------------------------ */
let bmiRequest = 0;
async function updateBMI() {
  const height = num('height_cm');
  const weight = num('weight_kg');
  const line = $('bmiLine');
  const ok = height >= 100 && height <= 250 && weight >= 20 && weight <= 300;
  if (!ok) {
    state.bmi = null;
    line.innerHTML = 'Enter height and weight to see your BMI.';
    return;
  }
  const mine = ++bmiRequest;
  try {
    const r = await api('/api/bmi', { method: 'POST', body: { height_cm: height, weight_kg: weight } });
    if (mine !== bmiRequest) return; // a newer request is in flight
    state.bmi = r.bmi;
    const cat = r.category;
    const catCls = cat.toLowerCase();
    line.innerHTML = `Your BMI is <strong class="bmi-val-bold">${r.bmi}</strong> <span class="bmi-chip bmi-${catCls}">${esc(cat)}</span>`;
    // Fade-in flash on BMI update
    line.classList.remove('updated');
    void line.offsetWidth;
    line.classList.add('updated');
  } catch (err) {
    if (mine === bmiRequest) line.textContent = err.message;
  }
}

let estimateRequest = 0;
async function updateEstimate() {
  const age = num('age');
  if (!(age >= 18 && age <= 100)) {
    state.estimate = null;
    $('estGlucose').textContent = '—';
    $('estBP').textContent = '—';
    return;
  }
  const mine = ++estimateRequest;
  try {
    const r = await api('/api/estimate', {
      method: 'POST',
      body: {
        age,
        sugar_diet: num('sugar_diet'),
        activity: num('activity'),
        stress: num('stress'),
        salt_intake: num('salt_intake'),
        family_history: $('family_history').checked,
      },
    });
    if (mine !== estimateRequest) return;
    state.estimate = r;

    // Clinical status categorization
    const gStatus = r.glucose < 100 ? { label: 'Normal', cls: 'status-good' }
                  : r.glucose < 126 ? { label: 'Borderline', cls: 'status-mid' }
                  : { label: 'Elevated', cls: 'status-high' };

    const bpStatus = r.blood_pressure < 80 ? { label: 'Optimal', cls: 'status-good' }
                   : r.blood_pressure < 90 ? { label: 'Stage 1', cls: 'status-mid' }
                   : { label: 'Stage 2', cls: 'status-high' };

    $('estGlucose').innerHTML = `<strong class="val-bold">${r.glucose}</strong> <span class="val-unit">mg/dL</span> <span class="est-chip ${gStatus.cls}">${gStatus.label}</span>`;
    $('estBP').innerHTML = `<strong class="val-bold">${r.blood_pressure}</strong> <span class="val-unit">mmHg</span> <span class="est-chip ${bpStatus.cls}">${bpStatus.label}</span>`;

    // Pop animation on value change
    [$('estGlucose'), $('estBP')].forEach((el) => {
      el.classList.remove('changed');
      void el.offsetWidth;
      el.classList.add('changed');
      setTimeout(() => el.classList.remove('changed'), 400);
    });
  } catch (err) {
    if (mine === estimateRequest) {
      $('estGlucose').textContent = '—';
      $('estBP').textContent = '—';
    }
  }
}

const scheduleBMI = debounce(updateBMI, 250);
const scheduleEstimate = debounce(updateEstimate, 250);

/* ------------------------------------------------------------------ *
 * Height Unit Converter (cm <-> ft/in)
 * ------------------------------------------------------------------ */
function syncHeightFromFtIn() {
  const ft = num('height_ft');
  const inch = num('height_in') || 0;
  if (!isNaN(ft) && ft > 0) {
    const cm = Math.round((ft * 12 + inch) * 2.54 * 10) / 10;
    $('height_cm').value = cm;
    $('heightConvertHint').textContent = `≈ ${cm} cm`;
    scheduleBMI();
  } else {
    $('heightConvertHint').textContent = '';
  }
}

function syncHeightFromCm() {
  const cm = num('height_cm');
  if (!isNaN(cm) && cm > 0) {
    const totalInches = cm / 2.54;
    const feet = Math.floor(totalInches / 12);
    const inches = Math.round((totalInches % 12) * 10) / 10;
    $('height_ft').value = feet;
    $('height_in').value = inches;
    $('heightConvertHint').textContent = `≈ ${feet} ft ${inches} in`;
  } else {
    $('heightConvertHint').textContent = '';
  }
}

$('btnCm')?.addEventListener('click', () => {
  $('btnCm').classList.add('unit-btn-active');
  $('btnFt').classList.remove('unit-btn-active');
  $('ftInPanel').hidden = true;
  $('cmInputWrap').hidden = false;
  $('height_cm').focus();
});

$('btnFt')?.addEventListener('click', () => {
  $('btnFt').classList.add('unit-btn-active');
  $('btnCm').classList.remove('unit-btn-active');
  $('cmInputWrap').hidden = true;
  $('ftInPanel').hidden = false;
  syncHeightFromCm();
  $('height_ft').focus();
});

$('height_ft')?.addEventListener('input', syncHeightFromFtIn);
$('height_in')?.addEventListener('input', syncHeightFromFtIn);
$('height_cm')?.addEventListener('input', () => { syncHeightFromCm(); scheduleBMI(); });

/* ------------------------------------------------------------------ *
 * Weight Unit Converter (kg <-> lbs)
 * ------------------------------------------------------------------ */
function syncWeightFromLbs() {
  const lbs = num('weight_lbs');
  if (!isNaN(lbs) && lbs > 0) {
    const kg = Math.round((lbs / 2.20462) * 10) / 10;
    $('weight_kg').value = kg;
    $('weightConvertHint').textContent = `≈ ${kg} kg`;
    scheduleBMI();
  } else {
    $('weightConvertHint').textContent = '';
  }
}

function syncWeightFromKg() {
  const kg = num('weight_kg');
  if (!isNaN(kg) && kg > 0) {
    const lbs = Math.round(kg * 2.20462 * 10) / 10;
    $('weight_lbs').value = lbs;
    $('weightConvertHint').textContent = `≈ ${lbs} lbs`;
  } else {
    $('weightConvertHint').textContent = '';
  }
}

$('btnKg')?.addEventListener('click', () => {
  $('btnKg').classList.add('unit-btn-active');
  $('btnLbs').classList.remove('unit-btn-active');
  $('lbsInputWrap').hidden = true;
  $('kgInputWrap').hidden = false;
  $('weight_kg').focus();
});

$('btnLbs')?.addEventListener('click', () => {
  $('btnLbs').classList.add('unit-btn-active');
  $('btnKg').classList.remove('unit-btn-active');
  $('kgInputWrap').hidden = true;
  $('lbsInputWrap').hidden = false;
  syncWeightFromKg();
  $('weight_lbs').focus();
});

$('weight_lbs')?.addEventListener('input', syncWeightFromLbs);
$('weight_kg')?.addEventListener('input', () => { syncWeightFromKg(); scheduleBMI(); });

/* ------------------------------------------------------------------ *
 * Gender selector & Pregnancy handling
 * ------------------------------------------------------------------ */
function updateGenderState() {
  const gender = document.querySelector('input[name="gender"]:checked')?.value || 'female';
  const isMale = (gender === 'male');
  const maleNotice = $('maleNotice');
  const pregInput = $('pregnancies');
  const pregField = $('pregnancyField');

  if (maleNotice) maleNotice.hidden = !isMale;
  if (pregInput && pregField) {
    if (isMale) {
      pregInput.value = '0';
      pregInput.disabled = true;
      pregField.classList.add('field-disabled');
    } else {
      pregInput.disabled = false;
      pregField.classList.remove('field-disabled');
    }
  }
}

document.querySelectorAll('input[name="gender"]').forEach((r) => {
  r.addEventListener('change', updateGenderState);
});
updateGenderState();

SLIDERS.forEach((id) => {
  const el = $(id);
  syncSlider(el);
  el.addEventListener('input', () => { syncSlider(el); scheduleEstimate(); });
});
$('age').addEventListener('input', scheduleEstimate);
$('family_history').addEventListener('change', scheduleEstimate);
$('use_own_readings').addEventListener('change', (e) => { $('ownReadings').hidden = !e.target.checked; });

/* ------------------------------------------------------------------ *
 * Submit
 * ------------------------------------------------------------------ */
const FIELD_TO_INPUT = {
  height_cm: 'height_cm', weight_kg: 'weight_kg', bmi: 'height_cm', age: 'age',
  pregnancies: 'pregnancies', glucose: 'glucose', blood_pressure: 'blood_pressure',
  insulin: 'insulin', skin_thickness: 'skin_thickness',
};

function showError(message, fieldId) {
  const box = $('formError');
  box.textContent = message;
  box.hidden = false;
  document.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  if (fieldId && $(fieldId)) {
    $(fieldId).setAttribute('aria-invalid', 'true');
    $(fieldId).focus();
  }
}
const clearError = () => {
  $('formError').hidden = true;
  document.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
};

$('riskForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();

  // Make sure BMI and estimates reflect exactly what's on screen.
  await Promise.all([updateBMI(), updateEstimate()]);

  const age = num('age');
  if (!(age >= 18 && age <= 100)) return showError('Enter your age (18 to 100).', 'age');
  if (state.bmi === null) return showError('Enter your height (100-250 cm) and weight (20-300 kg).', 'height_cm');

  let glucose = state.estimate?.glucose;
  let bp = state.estimate?.blood_pressure;
  if ($('use_own_readings').checked) {
    glucose = num('glucose');
    bp = num('blood_pressure');
    if (!(glucose >= 40 && glucose <= 400)) return showError('Enter your glucose (40 to 400 mg/dL), or switch off "Use my own" readings.', 'glucose');
    if (!(bp >= 30 && bp <= 200)) return showError('Enter your blood pressure (30 to 200 mmHg), or switch off "Use my own" readings.', 'blood_pressure');
  }
  if (glucose === undefined || bp === undefined) return showError("Couldn't estimate glucose and blood pressure. Check your age and try again.", 'age');

  const body = {
    pregnancies: Number.isNaN(num('pregnancies')) ? 0 : num('pregnancies'),
    glucose,
    blood_pressure: bp,
    skin_thickness: Number.isNaN(num('skin_thickness')) ? 0 : num('skin_thickness'),
    insulin: Number.isNaN(num('insulin')) ? 0 : num('insulin'),
    bmi: state.bmi,
    family_history: $('family_history').checked,
    age,
    activity: num('activity'),
    sugar_diet: num('sugar_diet'),
    stress: num('stress'),
    salt_intake: num('salt_intake'),
    height_cm: num('height_cm'),
    weight_kg: num('weight_kg'),
    gender: (document.querySelector('input[name="gender"]:checked') || {}).value || 'female',
    save: true,
  };

  const btn = $('submitBtn');
  btn.disabled = true;
  btn.classList.add('is-loading');
  try {
    const result = await api('/api/predict', { method: 'POST', body });
    renderResult(result);
  } catch (err) {
    showError(err.message, FIELD_TO_INPUT[err.field]);
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-loading');
  }
});

/* ------------------------------------------------------------------ *
 * Result: gauge, ring, count-up
 * ------------------------------------------------------------------ */
function animateArc(el, length, fraction) {
  // Snap back to empty, then let the CSS transition fill it.
  el.style.transition = 'none';
  el.style.strokeDashoffset = length;
  void el.getBoundingClientRect(); // force reflow so the reset sticks
  el.style.transition = '';
  requestAnimationFrame(() => { el.style.strokeDashoffset = length * (1 - fraction); });
}

function scoreBand(score) {
  if (score >= 70) return 'low';      // healthy / optimal -> green
  if (score >= 48) return 'moderate'; // fair / moderate -> amber
  return 'high';                      // needs attention -> coral/red
}

function renderResult(r) {
  state.result = r;

  // Gauge + risk number
  $('gauge').dataset.level = r.risk_level;
  animateArc($('gaugeFill'), GAUGE_LENGTH, Math.min(r.risk_percent, 100) / 100);
  countUp($('riskNumber'), r.risk_percent, { decimals: 1, suffix: '%' });
  $('riskLabel').textContent = LEVEL_TEXT[r.risk_level];
  $('riskLabel').dataset.level = r.risk_level;

  // Health score ring + rating badge
  const band = scoreBand(r.health_score);
  $('ringFill').dataset.band = band;
  animateArc($('ringFill'), RING_LENGTH, r.health_score / 100);
  countUp($('scoreNumber'), r.health_score, { decimals: 0 });

  const badge = $('scoreBadge');
  if (badge) {
    const rating = r.health_rating || (r.health_score >= 80 ? 'Optimal' : r.health_score >= 68 ? 'Good' : r.health_score >= 50 ? 'Fair' : 'Needs Attention');
    badge.textContent = rating;
    badge.dataset.rating = band;
  }

  $('readoutActions').hidden = false;

  renderExplanation(r);
  renderComparison(r.population_comparison);
  $('details').hidden = false;

  if (window.matchMedia('(max-width: 959px)').matches) {
    $('readout').scrollIntoView({ behavior: REDUCED_MOTION ? 'auto' : 'smooth', block: 'start' });
  }
}

/* ------------------------------------------------------------------ *
 * "What drove your result" - diverging bars from the Shapley values
 * ------------------------------------------------------------------ */
function valueText(c) {
  if (c.imputed) return 'not provided, estimated';
  switch (c.feature) {
    case 'Glucose': return `${c.value} mg/dL`;
    case 'BloodPressure': return `${c.value} mmHg`;
    case 'Insulin': return `${c.value} µU/mL`;
    case 'SkinThickness': return `${c.value} mm`;
    case 'Age': return `${c.value} years`;
    case 'DiabetesPedigreeFunction': return `score ${c.value}`;
    default: return String(c.value);
  }
}

const signed = (n) => (n > 0 ? '+' : n < 0 ? MINUS : '') + Math.abs(n).toFixed(1);

function renderExplanation(r) {
  const { baseline_percent: baseline, contributions: rows } = r.explanation;
  const max = Math.max(...rows.map((c) => Math.abs(c.impact_pts)), 1);

  $('dxChart').classList.remove('in');
  $('dxChart').innerHTML = rows.map((c) => {
    const dir = c.impact_pts > 0 ? 'up' : c.impact_pts < 0 ? 'down' : 'flat';
    const width = (Math.abs(c.impact_pts) / max) * 50;
    return `
      <div class="dx-row">
        <div class="dx-name"><span>${esc(c.label)}</span><small>${esc(valueText(c))}</small></div>
        <div class="dx-track" aria-hidden="true"><i class="dx-bar dx-${dir}" style="--w:${width.toFixed(1)}%"></i></div>
        <div class="dx-val dx-${dir}">${signed(c.impact_pts)}<span class="sr-only"> points, ${c.impact_pts > 0 ? 'raises' : 'lowers'} risk</span></div>
      </div>`;
  }).join('');

  const up = rows.find((c) => c.impact_pts >= 0.5);
  const down = rows.find((c) => c.impact_pts <= -0.5);
  let text = `Your score is ${r.risk_percent}%. A typical person in the reference sample scores ${baseline}%.`;
  if (up) text += ` ${up.label} raises it the most (${signed(up.impact_pts)} points).`;
  if (down) text += ` ${down.label} lowers it the most (${signed(down.impact_pts)} points).`;
  text += ` Worked out with ${r.model_used}.`;
  $('whySummary').textContent = text;

  requestAnimationFrame(() => requestAnimationFrame(() => $('dxChart').classList.add('in')));
}

/* ------------------------------------------------------------------ *
 * "How you compare" - you vs. average without / with diabetes
 * ------------------------------------------------------------------ */
const CMP_META = {
  Glucose: { name: 'Glucose', unit: 'mg/dL' },
  BloodPressure: { name: 'Blood pressure', unit: 'mmHg' },
  BMI: { name: 'BMI', unit: '' },
  Age: { name: 'Age', unit: 'years' },
};

function renderComparison(cmp) {
  const chart = $('cmpChart');
  chart.classList.remove('in');
  chart.innerHTML = Object.entries(cmp).map(([feat, v]) => {
    const meta = CMP_META[feat];
    const top = Math.max(v.you, v.non_diabetic_avg, v.diabetic_avg) * 1.08;
    const row = (label, value, cls) => `
      <div class="cmp-row">
        <span class="cmp-label">${label}</span>
        <div class="cmp-track" aria-hidden="true"><i class="cmp-bar ${cls}" style="--w:${((value / top) * 100).toFixed(1)}%"></i></div>
        <span class="cmp-num">${Number(value).toFixed(feat === 'BMI' ? 1 : 0)}</span>
      </div>`;
    return `
      <div class="cmp-group">
        <h3>${meta.name} ${meta.unit ? `<small>${meta.unit}</small>` : ''}</h3>
        ${row('You', v.you, 'cmp-you')}
        ${row('Without diabetes', v.non_diabetic_avg, 'cmp-low')}
        ${row('With diabetes', v.diabetic_avg, 'cmp-high')}
      </div>`;
  }).join('');
  requestAnimationFrame(() => requestAnimationFrame(() => chart.classList.add('in')));
}

/* ------------------------------------------------------------------ *
 * PDF report
 * ------------------------------------------------------------------ */
$('downloadBtn').addEventListener('click', () => {
  if (!state.result) return;
  try {
    const gender = (document.querySelector('input[name="gender"]:checked') || {}).value || 'female';
    Report.download({
      name: document.querySelector('.nav-name')?.textContent || '',
      created_at: state.result.created_at,
      result: state.result,
      gender,
    });
  } catch (err) {
    showError(err.message);
  }
});
