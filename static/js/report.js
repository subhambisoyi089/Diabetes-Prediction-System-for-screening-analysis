/* report.js — Doctor-friendly clinical PDF report v2
 *
 * Report.download({ name, created_at, result, gender })
 *   result = JSON returned by /api/predict
 *
 * Sections:
 *   1. Cover header with branding + patient info
 *   2. Clinical summary (risk gauge bar + health score)
 *   3. What influenced the result (Shapley table)
 *   4. Clinical values vs reference ranges
 *   5. Population comparison table
 *   6. Doctor notes + recommendations
 *   7. Disclaimer + footer
 */
const Report = (() => {
  /* ── Colours ─────────────────────────────────────────── */
  const INK       = [21, 38, 43];
  const MUTED     = [88, 108, 113];
  const LINE      = [208, 217, 214];
  const ACCENT    = [36, 54, 199];
  const TEAL      = [27, 127, 95];
  const AMBER     = [143, 97, 0];
  const RED       = [193, 58, 58];
  const WHITE     = [255, 255, 255];
  const PAPER     = [237, 241, 239];

  const LEVEL_COLOR = { low: TEAL, moderate: AMBER, high: RED };
  const LEVEL_TEXT  = { low: 'Low Risk', moderate: 'Moderate Risk', high: 'High Risk' };

  /* ── Units & names ─────────────────────────────────────── */
  const UNITS = {
    Glucose: 'mg/dL', BloodPressure: 'mmHg', Insulin: 'µU/mL',
    SkinThickness: 'mm', BMI: 'kg/m²', Age: 'years',
  };
  const NAMES = {
    Glucose: 'Fasting Glucose', BloodPressure: 'Diastolic BP',
    BMI: 'BMI', Age: 'Age', Insulin: 'Insulin', SkinThickness: 'Skin-fold',
    DiabetesPedigreeFunction: 'Family History Score',
  };

  /* Clinical reference ranges (WHO / ADA 2024) */
  const REF = {
    Glucose:      { normal: '<100', impaired: '100–125', diabetic: '≥126', unit: 'mg/dL' },
    BloodPressure:{ normal: '<80',  impaired: '80–89',   diabetic: '≥90',  unit: 'mmHg (diastolic)' },
    BMI:          { normal: '18.5–24.9', impaired: '25–29.9', diabetic: '≥30', unit: 'kg/m²' },
    Insulin:      { normal: '2–25',  impaired: '25–50',  diabetic: '>50',  unit: 'µU/mL (fasting)' },
  };

  const signed  = (n) => (n > 0 ? '+' : n < 0 ? '-' : '') + Math.abs(n).toFixed(1);
  const valueText = (c) => {
    if (c.imputed) return 'Not provided (estimated)';
    if (c.feature === 'DiabetesPedigreeFunction') return `Score ${c.value}`;
    return UNITS[c.feature] ? `${c.value} ${UNITS[c.feature]}` : String(c.value);
  };

  /* ── PDF helpers ───────────────────────────────────────── */
  function download({ name, created_at, result, gender }) {
    const lib = window.jspdf;
    if (!lib || !lib.jsPDF) throw new Error("The PDF tool didn't load. Check your connection and try again.");

    const doc = new lib.jsPDF({ unit: 'mm', format: 'a4' });
    const PAGE_W = 210, PAGE_H = 297, M = 16, CW = PAGE_W - 2 * M;
    let y = M;

    const ensure = (h) => { if (y + h > PAGE_H - M - 8) { doc.addPage(); y = M; } };
    const setColor = (rgb) => doc.setTextColor(rgb[0], rgb[1], rgb[2]);
    const setFill  = (rgb) => doc.setFillColor(rgb[0], rgb[1], rgb[2]);
    const setDraw  = (rgb) => doc.setDrawColor(rgb[0], rgb[1], rgb[2]);

    /* Heading with coloured left bar */
    function heading(text, color = ACCENT) {
      ensure(14);
      y += 5;
      setFill(color);
      doc.rect(M, y - 9, 3, 11, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); setColor(INK);
      doc.text(text, M + 6, y);
      y += 2;
      setDraw(LINE); doc.setLineWidth(0.3); doc.line(M + 6, y, M + CW, y);
      y += 6;
    }

    function paragraph(text, size = 10, color = INK) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(size); setColor(color);
      const lines = doc.splitTextToSize(text, CW - 6);
      ensure(lines.length * 5 + 2);
      doc.text(lines, M + 6, y);
      y += lines.length * 5 + 3;
    }

    function kv(label, value, labelColor = MUTED, valColor = INK) {
      ensure(7);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setColor(labelColor);
      doc.text(label + ':', M + 6, y);
      doc.setFont('helvetica', 'bold'); setColor(valColor);
      doc.text(String(value), M + 56, y);
      y += 6;
    }

    function table(headers, rows, widths, rowColors = null) {
      const rowH = 7;
      ensure(rowH * 2);
      setFill(PAPER);
      doc.rect(M, y - 5, CW, rowH, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); setColor(MUTED);
      let x = M + 4;
      headers.forEach((h, i) => { doc.text(h, x, y); x += widths[i]; });
      y += rowH;
      doc.setFont('helvetica', 'normal');
      rows.forEach((row, ri) => {
        ensure(rowH);
        if (ri % 2 === 0) {
          setFill([248, 250, 249]);
          doc.rect(M, y - 5, CW, rowH, 'F');
        }
        x = M + 4;
        row.forEach((cell, i) => {
          const rgb  = typeof cell === 'object' ? cell.color : INK;
          const bold = typeof cell === 'object' && cell.bold;
          doc.setFont('helvetica', bold ? 'bold' : 'normal');
          doc.setFontSize(9); setColor(rgb || INK);
          doc.text(String(typeof cell === 'object' ? cell.text : cell), x, y);
          x += widths[i];
        });
        setDraw(LINE); doc.setLineWidth(0.2); doc.line(M, y + 2, M + CW, y + 2);
        y += rowH;
      });
      y += 3;
    }

    /* ═══════════════════════════════════════════════════════
       COVER HEADER
       ═══════════════════════════════════════════════════════ */
    /* Dark header band */
    setFill(INK);
    doc.rect(0, 0, PAGE_W, 42, 'F');

    /* Logo mark */
    setFill([36, 54, 199]);
    doc.roundedRect(M, 10, 22, 22, 4, 4, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    setColor([95, 216, 170]);
    doc.text('DRC', M + 4.5, 24);

    /* Title */
    doc.setFont('helvetica', 'bold'); doc.setFontSize(20); setColor(WHITE);
    doc.text('Diabetes Risk Assessment Report', M + 28, 20);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setColor([157, 177, 174]);
    doc.text('Generated by Diabetes Risk Check · Not a clinical diagnosis · For physician review', M + 28, 27);
    const when = created_at ? new Date(created_at) : new Date();
    doc.text(`Date: ${when.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}`, M + 28, 34);

    y = 50;

    /* ─── Patient info row ─── */
    setFill(PAPER); doc.rect(M, y - 4, CW, 22, 'F');
    setDraw(LINE); doc.setLineWidth(0.3); doc.rect(M, y - 4, CW, 22, 'S');

    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); setColor(MUTED);
    doc.text('PATIENT', M + 4, y + 2);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); setColor(INK);
    doc.text(name || 'Anonymous', M + 4, y + 9);

    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setColor(MUTED);
    doc.text('BIOLOGICAL SEX', M + 80, y + 2);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); setColor(INK);
    const genderLabel = { female: 'Female', male: 'Male', other: 'Other / Not specified' };
    doc.text(genderLabel[gender] || 'Not specified', M + 80, y + 9);

    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setColor(MUTED);
    doc.text('MODEL', M + 130, y + 2);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); setColor(INK);
    doc.text(result.model_used || '—', M + 130, y + 9);

    y += 26;

    /* ═══════════════════════════════════════════════════════
       1. CLINICAL SUMMARY
       ═══════════════════════════════════════════════════════ */
    heading('Clinical Summary', LEVEL_COLOR[result.risk_level] || ACCENT);

    const level      = result.risk_level;
    const levelColor = LEVEL_COLOR[level] || INK;
    const levelText  = LEVEL_TEXT[level] || '—';

    /* Large risk % */
    doc.setFont('helvetica', 'bold'); doc.setFontSize(42); setColor(levelColor);
    doc.text(`${result.risk_percent}%`, M + 6, y + 12);

    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); setColor(levelColor);
    doc.text(levelText, M + 50, y + 8);

    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setColor(MUTED);
    doc.text('Probability of diabetes mellitus based on ML model.', M + 50, y + 15);
    doc.text(`Health Score: ${result.health_score} / 100  (combines risk, BMI, age, activity)`, M + 50, y + 21);

    /* Risk bar */
    y += 28;
    setFill(LINE); doc.roundedRect(M + 6, y, CW - 12, 5, 2.5, 2.5, 'F');
    setFill(levelColor);
    doc.roundedRect(M + 6, y, Math.max(5, (CW - 12) * Math.min(result.risk_percent, 100) / 100), 5, 2.5, 2.5, 'F');

    doc.setFontSize(8.5); setColor(MUTED);
    doc.text('0%', M + 6, y + 10); doc.text('50%', M + (CW / 2), y + 10); doc.text('100%', M + CW - 6, y + 10, { align: 'right' });
    y += 16;

    /* Risk interpretation box */
    const interp = {
      low:      'The model predicts a low likelihood of diabetes. Encourage continued healthy habits and annual screening.',
      moderate: 'The model predicts a moderate risk. Recommend HbA1c test, fasting glucose, and lifestyle counselling.',
      high:     'The model predicts a high risk. Recommend immediate HbA1c, fasting glucose, and OGTT. Initiate lifestyle intervention.',
    }[level] || '';

    setFill(level === 'high' ? [248, 221, 221] : level === 'moderate' ? [246, 234, 200] : [220, 240, 232]);
    doc.roundedRect(M + 6, y - 3, CW - 12, 14, 3, 3, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); setColor(levelColor);
    doc.text('Clinical Interpretation:', M + 10, y + 4);
    doc.setFont('helvetica', 'normal'); setColor(INK);
    const interpLines = doc.splitTextToSize(interp, CW - 26);
    doc.text(interpLines, M + 51, y + 4);
    y += Math.max(14, interpLines.length * 5) + 6;

    /* ═══════════════════════════════════════════════════════
       2. KEY CONTRIBUTING FACTORS
       ═══════════════════════════════════════════════════════ */
    heading('Key Contributing Factors', ACCENT);

    const exp = result.explanation;
    const up   = exp.contributions.find((c) => c.impact_pts >= 0.5);
    const down = exp.contributions.find((c) => c.impact_pts <= -0.5);
    let summary = `Baseline score for reference population: ${exp.baseline_percent}%.`;
    if (up)   summary += ` Highest risk factor: ${up.label} (+${up.impact_pts.toFixed(1)} pts).`;
    if (down) summary += ` Best protective factor: ${down.label} (${down.impact_pts.toFixed(1)} pts).`;
    paragraph(summary, 9.5);
    y += 1;

    table(
      ['Factor', 'Patient Value', 'Effect on Score', 'Direction'],
      exp.contributions.map((c) => [
        NAMES[c.feature] || c.label,
        valueText(c),
        { text: `${signed(c.impact_pts)} pts`, color: c.impact_pts > 0 ? RED : c.impact_pts < 0 ? TEAL : MUTED, bold: true },
        { text: c.impact_pts > 0 ? '▲ Raises risk' : c.impact_pts < 0 ? '▼ Lowers risk' : '— Neutral',
          color: c.impact_pts > 0 ? RED : c.impact_pts < 0 ? TEAL : MUTED },
      ]),
      [54, 46, 36, CW - 136],
    );

    /* ═══════════════════════════════════════════════════════
       3. CLINICAL VALUES vs REFERENCE RANGES
       ═══════════════════════════════════════════════════════ */
    heading('Clinical Values vs Reference Ranges (WHO / ADA 2024)', TEAL);
    paragraph('The following values are from the patient\'s input or model-estimated from lifestyle data.', 9);

    const cmpKeys = ['Glucose', 'BloodPressure', 'BMI', 'Insulin'];
    const cmpRows = cmpKeys.map((feat) => {
      const userVal = result.population_comparison[feat]?.you;
      const ref = REF[feat];
      if (!ref || userVal === undefined) return null;
      return [
        NAMES[feat] || feat,
        { text: `${Number(userVal).toFixed(feat === 'BMI' ? 1 : 0)} ${UNITS[feat] || ''}`, bold: true, color: INK },
        ref.normal,
        ref.impaired,
        { text: ref.diabetic, color: RED },
      ];
    }).filter(Boolean);

    table(
      ['Measure', 'Your Value', 'Normal', 'Pre-diabetic', 'Diabetic Range'],
      cmpRows,
      [44, 34, 30, 32, CW - 140],
    );

    /* ═══════════════════════════════════════════════════════
       4. POPULATION COMPARISON
       ═══════════════════════════════════════════════════════ */
    heading('Population Comparison', MUTED);
    paragraph('Patient values compared to dataset averages (Pima / NHANES / CDC combined).', 9);

    table(
      ['Measure', 'Patient', 'Non-diabetic avg', 'Diabetic avg'],
      Object.entries(result.population_comparison).map(([feat, v]) => {
        const d = feat === 'BMI' ? 1 : 0;
        const you = Number(v.you).toFixed(d);
        const youNum = parseFloat(you);
        const diabNum = parseFloat(Number(v.diabetic_avg).toFixed(d));
        const valColor = youNum >= diabNum ? RED : TEAL;
        return [
          NAMES[feat] || feat,
          { text: `${you} ${UNITS[feat] || ''}`, bold: true, color: valColor },
          `${Number(v.non_diabetic_avg).toFixed(d)} ${UNITS[feat] || ''}`,
          `${Number(v.diabetic_avg).toFixed(d)} ${UNITS[feat] || ''}`,
        ];
      }),
      [44, 36, 48, CW - 128],
    );

    /* ═══════════════════════════════════════════════════════
       5. DOCTOR RECOMMENDATIONS
       ═══════════════════════════════════════════════════════ */
    heading('Physician Recommendations', ACCENT);

    const recs = {
      low: [
        'Continue annual fasting glucose and HbA1c screening.',
        'Maintain healthy BMI (18.5–24.9 kg/m²) through diet and exercise.',
        'Reassess in 12 months or sooner if symptoms develop.',
        'Educate patient on early warning signs of hyperglycaemia.',
      ],
      moderate: [
        'Order HbA1c and 2-hour OGTT to confirm pre-diabetic status.',
        'Refer to a registered dietitian for a structured meal plan.',
        'Prescribe at least 150 min/week of moderate aerobic exercise.',
        'Consider metformin therapy if BMI ≥ 35 or other risk factors persist.',
        'Reassess in 3–6 months.',
      ],
      high: [
        'URGENT: Order fasting glucose, HbA1c, full metabolic panel.',
        'If HbA1c ≥ 6.5% or fasting glucose ≥ 126 mg/dL: diagnose and initiate treatment.',
        'Refer to endocrinologist if Type 1 indicators present.',
        'Begin structured diabetes education programme immediately.',
        'Monitor blood pressure and lipids; initiate statin if LDL > 100 mg/dL.',
        'Schedule follow-up within 2 weeks.',
      ],
    }[level] || [];

    recs.forEach((rec, i) => {
      ensure(8);
      setFill(i % 2 === 0 ? PAPER : WHITE);
      doc.rect(M + 6, y - 4, CW - 12, 7, 'F');
      setFill(levelColor);
      doc.circle(M + 10.5, y - 0.5, 1.2, 'F');
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); setColor(INK);
      const lines = doc.splitTextToSize(rec, CW - 24);
      doc.text(lines, M + 14, y);
      y += lines.length * 5 + 2;
    });
    y += 4;

    /* ═══════════════════════════════════════════════════════
       6. DATASET & MODEL INFO
       ═══════════════════════════════════════════════════════ */
    heading('Dataset & Model Information', MUTED);
    paragraph(
      `Model: ${result.model_used}. ` +
      'Trained on a combined dataset including the Pima Indian Diabetes dataset (768 female patients, age ≥21), ' +
      'NHANES cycles (male and female adults), and CDC BRFSS survey data, providing broader demographic coverage. ' +
      `Baseline reference population score: ${exp.baseline_percent}%. ` +
      'Note: The Pima dataset over-represents women of specific heritage; scores may be less accurate for other populations.',
      8.5,
      MUTED,
    );

    /* ═══════════════════════════════════════════════════════
       7. DISCLAIMER
       ═══════════════════════════════════════════════════════ */
    heading('Important Disclaimer', RED);
    paragraph(
      'This report is generated by a machine learning model and is NOT a medical diagnosis. ' +
      'Glucose and blood pressure values may have been estimated from lifestyle questionnaire answers rather than laboratory measurements. ' +
      'Scores for male patients use a modified pregnancies feature (set to 0) and may be less accurate than for the original female-only training population. ' +
      'This report is intended to support — not replace — clinical judgement. All results must be confirmed by appropriate laboratory tests and physician evaluation.',
      9,
    );

    /* ═══════════════════════════════════════════════════════
       FOOTER ON EVERY PAGE
       ═══════════════════════════════════════════════════════ */
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      /* footer bar */
      setFill(INK);
      doc.rect(0, PAGE_H - 12, PAGE_W, 12, 'F');
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setColor([157, 177, 174]);
      doc.text('Diabetes Risk Check — Confidential medical document', M, PAGE_H - 5);
      doc.text(`Page ${p} of ${pages}`, PAGE_W - M, PAGE_H - 5, { align: 'right' });
    }

    const stamp = when.toISOString().slice(0, 10);
    const safeName = (name || 'patient').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '');
    doc.save(`diabetes-risk-report-${safeName}-${stamp}.pdf`);
  }

  return { download };
})();
