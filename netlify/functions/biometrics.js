const { getPool } = require('./_db');
const { getUser, ok, created, badRequest, unauthorized, notFound, serverError, options } = require('./_auth');

// Risk stratification helpers
function bpRisk(sys, dia) {
  if (!sys || !dia) return null;
  if (sys >= 180 || dia >= 120) return 'crisis';
  if (sys >= 140 || dia >= 90)  return 'high_2';
  if (sys >= 130 || dia >= 80)  return 'high_1';
  if (sys >= 120)               return 'elevated';
  return 'normal';
}
function cholRisk(total, hdl) {
  if (!total) return null;
  const ratio = hdl ? total / hdl : null;
  if (total >= 240 || (ratio && ratio >= 5)) return 'very_high';
  if (total >= 200 || (ratio && ratio >= 4)) return 'high';
  if (total >= 180) return 'borderline';
  return 'normal';
}
function glucoseRisk(fg) {
  if (!fg) return null;
  if (fg >= 126) return 'diabetes';
  if (fg >= 100) return 'prediabetes';
  return 'normal';
}
function bmiCategory(bmi) {
  if (!bmi) return null;
  if (bmi < 18.5) return 'underweight';
  if (bmi < 25)   return 'normal';
  if (bmi < 30)   return 'overweight';
  return 'obese';
}
function overallRisk(bp, chol, gluc, bmiCat) {
  const high = [bp,chol,gluc].filter(r => r && (r.includes('high') || r==='diabetes' || r==='obese')).length;
  const mod  = [bp,chol,gluc,bmiCat].filter(r => r && (r.includes('elevated') || r.includes('borderline') || r==='prediabetes' || r==='overweight')).length;
  if (high >= 2 || bp==='crisis' || bp==='high_2') return 'high';
  if (high >= 1 || mod >= 2) return 'moderate';
  return 'low';
}

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
        q = `SELECT br.*, p.first_name, p.last_name, p.email
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
      blood_glucose, hba1c, notes, fasting_flag, pregnant, non_hdl, cholesterol_ratio,
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

    // Risk flags
    const bp_risk         = bpRisk(systolic_bp, diastolic_bp);
    const cholesterol_risk = cholRisk(total_cholesterol, hdl_cholesterol);
    const glucose_risk    = glucoseRisk(blood_glucose);
    const bmi_cat         = bmiCategory(bmi);
    const overall         = overallRisk(bp_risk, cholesterol_risk, glucose_risk, bmi_cat);

    try {
      const r = await db.query(
        `INSERT INTO biometric_results
           (participant_id,event_id,screened_by,screened_at,
            height_in,weight_lbs,bmi,waist_circumference_in,body_fat_pct,
            systolic_bp,diastolic_bp,heart_rate,
            total_cholesterol,hdl_cholesterol,ldl_cholesterol,triglycerides,cholesterol_ratio,non_hdl,
            blood_glucose,hba1c,
            waist_height_ratio,waist_height_category,fasting_flag,pregnant,grip_strength,
            fruit_veg_servings,activity_minutes,muscle_strengthening,stress_level,alcohol_drinks,tobacco_use,sleep_hours,
            bp_risk,cholesterol_risk,glucose_risk,bmi_category,overall_risk,notes)
         OUTPUT INSERTED.*
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38)`,
        [participant_id, event_id||null, screened_by||null,
         screened_at||new Date().toISOString(),
         height_in||null, weight_lbs||null, bmi,
         waist_circumference_in||null, body_fat_pct||null,
         systolic_bp||null, diastolic_bp||null, heart_rate||null,
         total_cholesterol||null, hdl_cholesterol||null, ldl_cholesterol||null,
         triglycerides||null, cholesterol_ratio ?? null, non_hdl ?? null,
         blood_glucose||null, hba1c||null,
         waist_height_ratio, waist_height_category, fasting_flag ? 1 : 0, pregnant ? 1 : 0, grip_strength ?? null,
         fruit_veg_servings ?? null, activity_minutes ?? null, muscle_strengthening ?? null,
         stress_level ?? null, alcohol_drinks ?? null, tobacco_use ?? null, sleep_hours ?? null,
         bp_risk, cholesterol_risk, glucose_risk, bmi_cat, overall, notes||null]
      );
      return created(r.rows[0]);
    } catch (e) { return serverError(e); }
  }

  return badRequest('Method not supported');
};
