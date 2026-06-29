const { getPool } = require('./_db');
const { getUser, ok, badRequest, unauthorized, serverError, options } = require('./_auth');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const user = getUser(event, context);
  if (!user) return unauthorized();

  const db = getPool();
  const qs = event.queryStringParameters || {};

  try {
    const [stats, riskDist, bpAvg, recentScreenings] = await Promise.all([
      // Platform-wide counts
      db.query(`SELECT
        (SELECT COUNT(*) FROM participants WHERE active=1)           AS total_participants,
        (SELECT COUNT(*) FROM coaches WHERE active=1)               AS total_coaches,
        (SELECT COUNT(*) FROM iStrata.dbo.is_groups WHERE GroupStatus='Active') AS total_groups,
        (SELECT COUNT(*) FROM screening_events)                        AS total_events,
        (SELECT COUNT(*) FROM biometric_results)                       AS total_screenings,
        (SELECT COUNT(*) FROM coaching_sessions WHERE status='scheduled'
           AND scheduled_at >= NOW())                                  AS upcoming_sessions`),

      // Risk distribution
      db.query(`SELECT overall_risk, COUNT(*) AS count
                  FROM biometric_results
                 WHERE overall_risk IS NOT NULL
                 GROUP BY overall_risk`),

      // Average biometrics
      db.query(`SELECT
        ROUND(AVG(CAST(bmi AS DECIMAL(18,4))),1)              AS avg_bmi,
        ROUND(AVG(CAST(systolic_bp AS DECIMAL(18,4))),0)      AS avg_systolic,
        ROUND(AVG(CAST(diastolic_bp AS DECIMAL(18,4))),0)     AS avg_diastolic,
        ROUND(AVG(CAST(total_cholesterol AS DECIMAL(18,4))),0) AS avg_cholesterol,
        ROUND(AVG(CAST(blood_glucose AS DECIMAL(18,4))),0)    AS avg_glucose,
        ROUND(AVG(CAST(heart_rate AS DECIMAL(18,4))),0)       AS avg_heart_rate
        FROM biometric_results`),

      // Most recent 10 screenings
      db.query(`SELECT TOP 10 br.screened_at, br.overall_risk, br.bmi,
                       br.systolic_bp, br.diastolic_bp,
                       p.first_name, p.last_name
                  FROM biometric_results br
                  JOIN participants p ON p.id=br.participant_id
                 ORDER BY br.screened_at DESC`),
    ]);

    return ok({
      stats:           stats.rows[0],
      risk_distribution: riskDist.rows,
      averages:        bpAvg.rows[0],
      recent_screenings: recentScreenings.rows,
    });
  } catch (e) { return serverError(e); }
};
