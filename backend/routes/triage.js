const express = require('express');
const pool = require('../db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// Simple, transparent rule engine — decision support only, per the PRD.
// Tune these thresholds with a real clinician before using beyond a demo.
function computeTriagePriority(symptoms = [], vitals = {}) {
  const reasons = [];
  const s = symptoms.map(x => String(x).toLowerCase());
  const temp = Number(vitals.temperature_c);
  const bpSys = Number(vitals.bp_systolic);
  const bpDia = Number(vitals.bp_diastolic);
  const hr = Number(vitals.heart_rate);
  const spo2 = Number(vitals.spo2);

  // Emergency indicators
  if (s.some(x => x.includes('chest pain') || x.includes('breathing') || x.includes('unconscious') || x.includes('severe bleeding'))) {
    reasons.push('Emergency symptom reported');
  }
  if (!isNaN(spo2) && spo2 < 90) reasons.push('Low oxygen saturation');
  if (!isNaN(bpSys) && (bpSys >= 180 || bpSys <= 80)) reasons.push('Critical blood pressure');
  if (!isNaN(temp) && temp >= 40) reasons.push('Very high fever');

  if (reasons.length > 0) {
    return { priority: 'emergency', reasons };
  }

  // High priority indicators
  const highReasons = [];
  if (!isNaN(temp) && temp >= 38) highReasons.push('High fever');
  if (!isNaN(bpSys) && bpSys >= 140) highReasons.push('High BP');
  if (!isNaN(bpDia) && bpDia >= 90) highReasons.push('High BP');
  if (!isNaN(hr) && hr >= 100) highReasons.push('Increased heart rate');
  if (s.some(x => x.includes('severe pain') || x.includes('persistent vomiting') || x.includes('high fever'))) {
    highReasons.push('Concerning symptom reported');
  }

  if (highReasons.length > 0) {
    return { priority: 'high', reasons: [...new Set(highReasons)] };
  }

  return { priority: 'normal', reasons: ['No emergency or high-priority indicators found'] };
}

// POST /api/triage  { patient_id, symptoms:[], vitals:{}, duration_text, severity_text }
router.post('/', verifyToken, async (req, res) => {
  const { patient_id, symptoms, vitals, duration_text, severity_text, is_offline_entry } = req.body;
  if (!patient_id) return res.status(400).json({ error: 'patient_id is required' });

  const { priority, reasons } = computeTriagePriority(symptoms, vitals);

  try {
    const { rows } = await pool.query(
      `INSERT INTO triage_records (
        patient_id, recorded_by, symptoms, vitals, duration_text, severity_text,
        priority_result, reason_summary, is_offline_entry
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *`,
      [
        patient_id, req.user.userId, JSON.stringify(symptoms || []), JSON.stringify(vitals || {}),
        duration_text || null, severity_text || null, priority, reasons.join(', '), !!is_offline_entry
      ]
    );

    // Keep the patient's denormalized "current risk status" card up to date.
    await pool.query(
      `INSERT INTO patient_health_profile (patient_id, current_risk_status)
       VALUES ($1, $2)
       ON CONFLICT (patient_id) DO UPDATE SET current_risk_status = $2, updated_at = NOW()`,
      [patient_id, priority]
    );

    res.status(201).json({ triage_record: rows[0], priority, reasons });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/triage/patient/:patientId
router.get('/patient/:patientId', verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM triage_records WHERE patient_id = $1 ORDER BY created_at DESC',
      [req.params.patientId]
    );
    res.json({ triage_records: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
