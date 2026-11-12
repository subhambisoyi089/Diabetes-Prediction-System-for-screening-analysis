async function loadModelComparison() {
  const note = document.getElementById('modelNote');
  let data;
  try {
    const res = await fetch('/api/model-comparison');
    if (!res.ok) throw new Error();
    data = await res.json();
  } catch {
    note.textContent = "Couldn't load the results. Refresh the page to try again.";
    return;
  }
  const { comparison, best_model, cv_folds, dataset_info } = data;

  // Populate dataset stats card if available
  if (dataset_info) {
    const nameEl = document.getElementById('dsCohortName');
    const totalEl = document.getElementById('dsTotal');
    const malesEl = document.getElementById('dsMales');
    const femalesEl = document.getElementById('dsFemales');
    const diabeticEl = document.getElementById('dsDiabetic');

    if (nameEl) nameEl.textContent = dataset_info.name || 'Diverse Clinical Dataset';
    if (totalEl) totalEl.textContent = Number(dataset_info.total_records || 0).toLocaleString();
    if (malesEl) malesEl.textContent = `${Number(dataset_info.male_records || 0).toLocaleString()} (${Math.round((dataset_info.male_records / dataset_info.total_records) * 100)}%)`;
    if (femalesEl) femalesEl.textContent = `${Number(dataset_info.female_records || 0).toLocaleString()} (${Math.round((dataset_info.female_records / dataset_info.total_records) * 100)}%)`;
    if (diabeticEl) diabeticEl.textContent = `${Number(dataset_info.diabetic_records || 0).toLocaleString()} (${Math.round((dataset_info.diabetic_records / dataset_info.total_records) * 100)}%)`;
  }

  const tbody = document.getElementById('modelTableBody');
  const barsWrap = document.getElementById('modelBars');
  tbody.innerHTML = '';
  barsWrap.innerHTML = '';

  note.textContent =
    `Evaluated on 20% untouched hold-out test set with 5-fold cross-validation. ` +
    `"${best_model}" achieved the highest cross-validated ROC-AUC and is deployed for live clinical predictions.`;

  Object.entries(comparison).forEach(([name, metrics]) => {
    const tr = document.createElement('tr');
    if (name === best_model) tr.classList.add('best');
    const maleAcc = metrics.male_accuracy !== undefined ? `${metrics.male_accuracy}%` : '—';
    const femAcc = metrics.female_accuracy !== undefined ? `${metrics.female_accuracy}%` : '—';

    tr.innerHTML = `
      <td><strong>${esc(name)}</strong>${name === best_model ? ' <span class="chip chip-best">Active Model</span>' : ''}</td>
      <td class="num">${metrics.accuracy}%</td>
      <td class="num">${maleAcc}</td>
      <td class="num">${femAcc}</td>
      <td class="num">${metrics.recall}%</td>
      <td class="num">${metrics.roc_auc}%</td>
      <td class="num">${metrics.cv_roc_auc}% <span class="pm">&plusmn;${metrics.cv_roc_auc_std}</span></td>
    `;
    tbody.appendChild(tr);

    const row = document.createElement('div');
    row.className = 'model-bar-row';
    row.innerHTML = `
      <div class="model-bar-name">${esc(name)}</div>
      <div class="model-bar-track"><div class="model-bar-fill${name === best_model ? ' is-best' : ''}" style="--w:${metrics.accuracy}%"></div></div>
      <div class="model-bar-pct">${metrics.accuracy}%</div>
    `;
    barsWrap.appendChild(row);
  });

  // Animate the bars in on the next frame
  requestAnimationFrame(() => requestAnimationFrame(() => barsWrap.classList.add('in')));
}
loadModelComparison();
