const { getPool } = require('./_db');
const { getUser, ok, created, badRequest, unauthorized, notFound, serverError, options } = require('./_auth');

// ── Risk model ────────────────────────────────────────────────────────────────
// Per-measure status: green (0) / yellow (1) / red (2) / critical (3, red+alert).
// Thresholds follow ACC/AHA (BP), ADA (glucose, HbA1c), ATP III (lipids), WHO (BMI).
// Legacy *_risk category strings are derived from these for back-compat.
function lvl(level, critical) { return { level, critical: !!critical }; }

function bpStatus(sys, dia) {
  if (!sys || !dia) return null;
  if (sys >= 180 || dia >= 120) return lvl('red', true);          // hypertensive crisis
  if (sys >= 140 || dia >= 90)  return lvl('red');                // stage 2
  if (sys >= 130 || dia >= 80)  return lvl('yellow');             // stage 1
  if (sys >= 120)               return lvl('yellow');             // elevated
  return lvl('green');
}
function glucoseStatus(fg) {
  if (!fg) return null;
  if (fg >= 300 || fg < 54) return lvl('red', true);              // severe hyper/hypoglycemia
  if (fg >= 126) return lvl('red');                               // diabetes range
  if (fg >= 100) return lvl('yellow');                            // prediabetes
  return lvl('green');
}
function hba1cStatus(a) {
  if (!a) return null;
  if (a >= 10)  return lvl('red', true);
  if (a >= 6.5) return lvl('red');
  if (a >= 5.7) return lvl('yellow');
  return lvl('green');
}
function totalCholStatus(t) { if (!t) return null; return t >= 240 ? lvl('red') : t >= 200 ? lvl('yellow') : lvl('green'); }
function hdlStatus(h) { if (!h) return null; return h < 40 ? lvl('red') : h < 60 ? lvl('yellow') : lvl('green'); }
function ldlStatus(l) { if (!l) return null; if (l >= 190) return lvl('red', true); return l >= 160 ? lvl('red') : l >= 100 ? lvl('yellow') : lvl('green'); }
function trigStatus(t) { if (!t) return null; if (t >= 500) return lvl('red', true); return t >= 200 ? lvl('red') : t >= 150 ? lvl('yellow') : lvl('green'); }
function bmiStatus(b) { if (!b) return null; if (b >= 40) return lvl('red', true); if (b >= 30) return lvl('red'); if (b >= 25 || b < 18.5) return lvl('yellow'); return lvl('green'); }
function whrStatus(r) { if (r == null) return null; return r >= 0.6 ? lvl('red') : r >= 0.5 ? lvl('yellow') : lvl('green'); }

// Compute the full risk object: per-measure levels, overall score, level, critical flag.
function computeRisk(v) {
  const measures = {
    blood_pressure: bpStatus(v.systolic_bp, v.diastolic_bp),
    blood_glucose:  glucoseStatus(v.blood_glucose),
    hba1c:          hba1cStatus(v.hba1c),
    total_cholesterol: totalCholStatus(v.total_cholesterol),
    hdl:            hdlStatus(v.hdl_cholesterol),
    ldl:            ldlStatus(v.ldl_cholesterol),
    triglycerides:  trigStatus(v.triglycerides),
    bmi:            bmiStatus(v.bmi),
    waist_height:   whrStatus(v.waist_height_ratio),
  };
  const pts = { green: 0, yellow: 1, red: 2 };
  let score = 0, reds = 0, criticals = 0;
  for (const k in measures) {
    const m = measures[k]; if (!m) continue;
    score += m.critical ? 3 : pts[m.level];
    if (m.level === 'red') reds++;
    if (m.critical) criticals++;
  }
  let level;
  if (criticals > 0) level = 'critical';
  else if (reds >= 2 || score >= 5) level = 'high';
  else if (reds >= 1 || score >= 2) level = 'moderate';
  else level = 'low';
  return { score, level, critical: criticals > 0, measures };
}

// Legacy category strings (kept for existing consumers / reports).
function bpRisk(sys, dia) { if (!sys || !dia) return null; if (sys>=180||dia>=120) return 'crisis'; if (sys>=140||dia>=90) return 'high_2'; if (sys>=130||dia>=80) return 'high_1'; if (sys>=120) return 'elevated'; return 'normal'; }
function cholRisk(total, hdl) { if (!total) return null; const ratio = hdl ? total/hdl : null; if (total>=240||(ratio&&ratio>=5)) return 'very_high'; if (total>=200||(ratio&&ratio>=4)) return 'high'; if (total>=180) return 'borderline'; return 'normal'; }
function glucoseRisk(fg) { if (!fg) return null; if (fg>=126) return 'diabetes'; if (fg>=100) return 'prediabetes'; return 'normal'; }
function bmiCategory(bmi) { if (!bmi) return null; if (bmi<18.5) return 'underweight'; if (bmi<25) return 'normal'; if (bmi<30) return 'overweight'; return 'obese'; }

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const user = getUser(event, context);
  if (!user) return unauthorized();

  const db = getPool();
  const qs = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    try {
      let q, vals = [];
      if (qs.participant_id) {
        q = 'SELECT * FROM biometric_results WHERE participant_id=$1 ORDER BY screened_at DESC';
        vals = [qs.participant_id];
      } else if (qs.event_id) {
        q = `SELECT br.*, p.first_name, p.last_name, p.email, p.gender, p.date_of_birth, p.employee_id, p.department
               FROM biometric_results br
               JOIN participants p ON p.id=br.participant_id
              WHERE br.event_id=$1 ORDER BY p.last_name`;
        vals = [qs.event_id];
      } else {
        q = `SELECT TOP 100 br.*, p.first_name, p.last_name
               FROM biometric_results br
               JOIN participants p ON p.id=br.participant_id
              ORDER BY br.screened_at DESC`;
      }
      const r = await db.query(q, vals);
      return ok(r.rows);
    } catch (e) { return serverError(e); }
  }

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body||'{}'); } catch { return badRequest('Invalid JSON'); }
    const {
      participant_id, event_id, screened_by, screened_at,
      height_in, weight_lbs, waist_circumference_in, body_fat_pct,
      systolic_bp, diastolic_bp, heart_rate,
      total_cholesterol, hdl_cholesterol, ldl_cholesterol, triglycerides,
      blood_glucose, hba1c, notes, fasting_flag, pregnant, diabetic, non_hdl, cholesterol_ratio,
      grip_strength,
      fruit_veg_servings, activity_minutes, muscle_strengthening, stress_level,
      alcohol_drinks, tobacco_use, sleep_hours
    } = b;

    if (!participant_id) return badRequest('participant_id required');

    // Auto-calculate BMI and ratio
    const bmi = (height_in && weight_lbs)
      ? +(703 * weight_lbs / (height_in * height_in)).toFixed(2)
      : null;
    // Non-HDL and cholesterol ratio are entered manually by the screener (not auto).
    // Waist-to-height ratio: <0.50 ideal | 0.50–0.59 borderline | >=0.60 high
    const waist_height_ratio = (waist_circumference_in && height_in)
      ? +(waist_circumference_in / height_in).toFixed(2)
      : null;
    const waist_height_category = waist_height_ratio == null ? null
      : waist_height_ratio < 0.5 ? 'ideal'
      : waist_height_ratio < 0.6 ? 'borderline' : 'high';

    // Risk model (per-measure colors + critical + overall score)
    const risk = computeRisk({
      systolic_bp, diastolic_bp, blood_glucose, hba1c,
      total_cholesterol, hdl_cholesterol, ldl_cholesterol, triglycerides,
      bmi, waist_height_ratio,
    });
    // Legacy category strings (back-compat)
    const bp_risk         = bpRisk(systolic_bp, diastolic_bp);
    const cholesterol_risk = cholRisk(total_cholesterol, hdl_cholesterol);
    const glucose_risk    = glucoseRisk(blood_glucose);
    const bmi_cat         = bmiCategory(bmi);
    const overall         = risk.level;

    // Column → value map: single source of truth for both insert and update.
    const cols = {
      screened_by: screened_by || null,
      screened_at: screened_at || new Date().toISOString(),
      height_in: height_in || null,
      weight_lbs: weight_lbs || null,
      bmi,
      waist_circumference_in: waist_circumference_in || null,
      body_fat_pct: body_fat_pct || null,
      systolic_bp: systolic_bp || null,
      diastolic_bp: diastolic_bp || null,
      heart_rate: heart_rate || null,
      total_cholesterol: total_cholesterol || null,
      hdl_cholesterol: hdl_cholesterol || null,
      ldl_cholesterol: ldl_cholesterol || null,
      triglycerides: triglycerides || null,
      cholesterol_ratio: cholesterol_ratio ?? null,
      non_hdl: non_hdl ?? null,
      blood_glucose: blood_glucose || null,
      hba1c: hba1c || null,
      waist_height_ratio,
      waist_height_category,
      fasting_flag: fasting_flag ? 1 : 0,
      pregnant: pregnant ? 1 : 0,
      diabetic: diabetic ? 1 : 0,
      grip_strength: grip_strength ?? null,
      fruit_veg_servings: fruit_veg_servings ?? null,
      activity_minutes: activity_minutes ?? null,
      muscle_strengthening: muscle_strengthening ?? null,
      stress_level: stress_level ?? null,
      alcohol_drinks: alcohol_drinks ?? null,
      tobacco_use: tobacco_use ?? null,
      sleep_hours: sleep_hours ?? null,
      bp_risk, cholesterol_risk, glucose_risk,
      bmi_category: bmi_cat,
      overall_risk: overall,
      risk_score: risk.score,
      risk_json: JSON.stringify(risk),
      notes: notes || null,
    };
    const keys = Object.keys(cols);

    try {
      // One screening record per participant per event: update in place when it
      // already exists, otherwise insert. (Ad-hoc screenings with no event_id
      // always insert a new row.)
      if (event_id) {
        const setClause = keys.map((k, i) => `${k}=$${i + 3}`).join(',');
        const upd = await db.query(
          `UPDATE biometric_results SET ${setClause}
             OUTPUT INSERTED.*
           WHERE participant_id=$1 AND event_id=$2`,
          [participant_id, event_id, ...keys.map(k => cols[k])]
        );
        if (upd.rows.length) return ok(upd.rows[0]);
      }

      const insKeys = ['participant_id', 'event_id', ...keys];
      const insVals = [participant_id, event_id || null, ...keys.map(k => cols[k])];
      const placeholders = insKeys.map((_, i) => `$${i + 1}`).join(',');
      const ins = await db.query(
        `INSERT INTO biometric_results (${insKeys.join(',')})
         OUTPUT INSERTED.* VALUES (${placeholders})`,
        insVals
      );
      return created(ins.rows[0]);
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
