const { getPool } = require('./_db');
const { getUser, ok, created, badRequest, unauthorized, notFound, serverError, options } = require('./_auth');

// ── Risk model (HealthYou Biometric Ranges spec) ──────────────────────────────
// Per-measure status: level 'ideal'(green)/'borderline'(yellow)/'high'(red),
// plus cr = Critical Risk (HealthYou follow-up) and emergency = Medical Emergency
// (immediate ER referral). Sex/age/fasting/diabetic context drives several measures.
function st(level, cr, emergency) { return { level, cr: !!cr, emergency: !!emergency }; }

function bmiStatus(b) { if (!b) return null; if (b < 18.5) return st('high'); if (b < 25) return st('ideal'); if (b < 30) return st('borderline'); return st('high'); }
function waistStatus(w, sex) { if (!w || !sex) return null; const thr = sex === 'F' ? 35 : 40; return w >= thr ? st('high') : st('ideal'); }
function systolicStatus(s) { if (!s) return null; const lvl = s >= 140 ? 'high' : s >= 120 ? 'borderline' : 'ideal'; return st(lvl, s >= 150, s >= 180); }
function diastolicStatus(d) { if (!d) return null; const lvl = d >= 90 ? 'high' : d >= 80 ? 'borderline' : 'ideal'; return st(lvl, d >= 100, d >= 120); }
function worse(a, b) { // combine two statuses (e.g. systolic+diastolic) → worst
  if (!a) return b; if (!b) return a;
  const rank = { ideal: 0, borderline: 1, high: 2 };
  const level = rank[a.level] >= rank[b.level] ? a.level : b.level;
  return st(level, a.cr || b.cr, a.emergency || b.emergency);
}
function glucoseStatus(g, fasting, diabetic) {
  if (!g) return null;
  const emergency = g > 300;
  if (fasting) {
    const lvl = g >= 126 ? 'high' : g >= 100 ? 'borderline' : 'ideal';
    return st(lvl, g >= (diabetic ? 180 : 140), emergency);
  }
  const lvl = g >= 200 ? 'high' : g >= 140 ? 'borderline' : 'ideal';
  return st(lvl, g >= (diabetic ? 240 : 200), emergency);
}
function hba1cStatus(a, diabetic) {
  if (!a) return null;
  const lvl = a >= 6.5 ? 'high' : a >= 5.7 ? 'borderline' : 'ideal';
  return st(lvl, diabetic ? a >= 8.0 : a > 6.4, a > 12.0);
}
function hdlStatus(h, sex) {
  if (!h || !sex) return null;
  if (sex === 'F') return h > 50 ? st('ideal') : h >= 41 ? st('borderline') : st('high');
  return h > 40 ? st('ideal') : h >= 31 ? st('borderline') : st('high');
}
function ldlStatus(l) { if (!l) return null; const lvl = l >= 140 ? 'high' : l >= 100 ? 'borderline' : 'ideal'; return st(lvl, l > 160); }
function trigStatus(t, fasting) {
  if (!t) return null;
  if (fasting) { const lvl = t >= 200 ? 'high' : t >= 150 ? 'borderline' : 'ideal'; return st(lvl, t >= 400); }
  const lvl = t >= 250 ? 'high' : t >= 200 ? 'borderline' : 'ideal'; return st(lvl, t >= 500);
}
function totalCholStatus(t) { if (!t) return null; return t >= 240 ? st('high') : t >= 200 ? st('borderline') : st('ideal'); }
function ratioStatus(r) { if (!r) return null; const lvl = r >= 4.5 ? 'high' : r >= 4.0 ? 'borderline' : 'ideal'; return st(lvl, r > 6.0); }
function gripThreshold(age, sex) {
  let m, f;
  if (age == null)      return null;
  if (age < 20)         { m = 78; f = 42; }
  else if (age < 30)    { m = 81; f = 47; }
  else if (age < 40)    { m = 79; f = 47; }
  else if (age < 50)    { m = 78; f = 42; }
  else if (age < 60)    { m = 72; f = 40; }
  else                  { m = 66; f = 38; }
  return sex === 'F' ? f : m;
}
function gripStatus(g, age, sex) { if (!g || !sex || age == null) return null; const thr = gripThreshold(age, sex); return g > thr ? st('ideal') : st('high'); }
function whrStatus(r) { if (r == null) return null; return r >= 0.6 ? st('high') : r >= 0.5 ? st('borderline') : st('ideal'); }

// Compute the full risk object. ctx: { sex:'M'|'F'|null, age:number|null, fasting:bool, diabetic:bool }
function computeRisk(v, ctx) {
  const c = ctx || {};
  const measures = {
    bmi:                bmiStatus(v.bmi),
    waist_circumference: waistStatus(v.waist_circumference_in, c.sex),
    waist_height:       whrStatus(v.waist_height_ratio),
    blood_pressure:     worse(systolicStatus(v.systolic_bp), diastolicStatus(v.diastolic_bp)),
    blood_glucose:      glucoseStatus(v.blood_glucose, c.fasting, c.diabetic),
    hba1c:              hba1cStatus(v.hba1c, c.diabetic),
    hdl:                hdlStatus(v.hdl_cholesterol, c.sex),
    ldl:                ldlStatus(v.ldl_cholesterol),
    triglycerides:      trigStatus(v.triglycerides, c.fasting),
    total_cholesterol:  totalCholStatus(v.total_cholesterol),
    cholesterol_ratio:  ratioStatus(v.cholesterol_ratio),
    grip_strength:      gripStatus(v.grip_strength, c.age, c.sex),
  };
  const pts = { ideal: 0, borderline: 1, high: 2 };
  let score = 0, highs = 0, borderlines = 0, crs = 0, emergencies = 0;
  for (const k in measures) {
    const m = measures[k]; if (!m) continue;
    score += pts[m.level];
    if (m.level === 'high') highs++;
    if (m.level === 'borderline') borderlines++;
    if (m.cr) crs++;
    if (m.emergency) emergencies++;
  }
  let level;
  if (emergencies > 0 || crs > 0) level = 'critical';
  else if (highs >= 2) level = 'high';
  else if (highs >= 1 || borderlines >= 2) level = 'moderate';
  else level = 'low';
  return { score, level, critical: crs > 0 || emergencies > 0, emergency: emergencies > 0, measures };
}

exports.computeRisk = computeRisk; // exposed for tests

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
      blood_glucose, hba1c, notes, fasting_flag, pregnant, diabetic, gender, non_hdl, cholesterol_ratio,
      grip_strength,
      fruit_veg_servings, activity_minutes, muscle_strengthening, stress_level,
      alcohol_drinks, tobacco_use, sleep_hours
    } = b;

    if (!participant_id) return badRequest('participant_id required');

    // Participant sex + age drive several spec thresholds (waist, HDL, grip).
    // A sex supplied at screening time takes precedence and is persisted to the participant.
    let sex = null, age = null;
    try {
      const pr = await db.query('SELECT gender, CONVERT(varchar(10), date_of_birth, 23) AS dob FROM participants WHERE id=$1', [participant_id]);
      const stored = (pr.rows[0]?.gender || '').toString().trim();
      const chosen = (gender || stored).toString().trim();
      const g = chosen.toUpperCase();
      sex = g.startsWith('M') ? 'M' : g.startsWith('F') ? 'F' : null;
      if (gender && gender.toString().trim() && gender.toString().trim().toLowerCase() !== stored.toLowerCase()) {
        try { await db.query('UPDATE participants SET gender=$2 WHERE id=$1', [participant_id, gender]); } catch (e) { /* non-critical */ }
      }
      const dob = pr.rows[0]?.dob;
      if (dob) { const d = new Date(dob + 'T00:00:00Z'), now = new Date(); age = now.getUTCFullYear() - d.getUTCFullYear() - ((now.getUTCMonth() < d.getUTCMonth() || (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate())) ? 1 : 0); }
    } catch (e) { /* sex/age optional */ }

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

    // Risk model (per-measure colors + critical + overall score) per HY spec
    const risk = computeRisk({
      systolic_bp, diastolic_bp, blood_glucose, hba1c,
      total_cholesterol, hdl_cholesterol, ldl_cholesterol, triglycerides,
      cholesterol_ratio, bmi, waist_circumference_in, grip_strength,
    }, { sex, age, fasting: !!fasting_flag, diabetic: !!diabetic });
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
