const express = require('express');
const pool = require('../db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// Generates a human-readable ID like GA-2026-000123 and retries on the rare collision.
async function generatePatientRefCode() {
  const year = new Date().getFullYear();
  for (let attempt = 0; attempt < 5; attempt++) {
    const random = Math.floor(100000 + Math.random() * 900000); // 6 digits
    const code = `GA-${year}-${random}`;
    const { rows } = await pool.query('SELECT 1 FROM patients WHERE patient_ref_code = $1', [code]);
    if (rows.length === 0) return code;
  }
  throw new Error('Could not generate a unique patient reference code, try again');
}

// POST /api/patients — register a new patient
router.post('/', verifyToken, async (req, res) => {
  const {
    full_name, date_of_birth, approximate_age, gender, phone_number,
    village, district, state, emergency_contact_name, emergency_contact_phone,
    emergency_contact_relation, blood_group, preferred_language,
    existing_conditions, allergies
  } = req.body;

  if (!full_name || !gender) {
    return res.status(400).json({ error: 'full_name and gender are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Duplicate check: same phone + similar name already registered
    let duplicateWarning = null;
    if (phone_number) {
      const dupCheck = await client.query(
        `SELECT id, full_name, patient_ref_code FROM patients
         WHERE phone_number = $1 AND is_active = TRUE`,
        [phone_number]
      );
      if (dupCheck.rows.length > 0) {
        duplicateWarning = dupCheck.rows[0];
      }
    }

    const patientRefCode = await generatePatientRefCode();

    const insertPatient = await client.query(
      `INSERT INTO patients (
        patient_ref_code, full_name, date_of_birth, approximate_age, gender,
        phone_number, village, district, state, emergency_contact_name,
        emergency_contact_phone, emergency_contact_relation, blood_group,
        registered_by_user_id, preferred_language
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *`,
      [
        patientRefCode, full_name, date_of_birth || null, approximate_age || null, gender,
        phone_number || null, village || null, district || null, state || null,
        emergency_contact_name || null, emergency_contact_phone || null,
        emergency_contact_relation || null, blood_group || null,
        req.user.userId, preferred_language || 'hi'
      ]
    );
    const patient = insertPatient.rows[0];

    await client.query(
      `INSERT INTO patient_health_profile (patient_id, existing_conditions, allergies)
       VALUES ($1, $2, $3)`,
      [patient.id, JSON.stringify(existing_conditions || []), JSON.stringify(allergies || [])]
    );

    if (duplicateWarning) {
      await client.query(
        `INSERT INTO patient_duplicate_flags (patient_id, possible_duplicate_of, match_reason)
         VALUES ($1, $2, 'same phone number')`,
        [patient.id, duplicateWarning.id]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ patient, duplicate_warning: duplicateWarning });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/patients/search?query=lakshmi
router.get('/search', verifyToken, async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'query parameter is required' });

  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.patient_ref_code, p.full_name, p.approximate_age, p.date_of_birth,
              p.village, p.phone_number, hp.current_risk_status, hp.is_high_risk
       FROM patients p
       LEFT JOIN patient_health_profile hp ON hp.patient_id = p.id
       WHERE p.is_active = TRUE
         AND (p.full_name ILIKE '%' || $1 || '%'
              OR p.phone_number ILIKE '%' || $1 || '%'
              OR p.patient_ref_code ILIKE '%' || $1 || '%')
       ORDER BY p.full_name
       LIMIT 20`,
      [query]
    );
    res.json({ results: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/patients/:id — full longitudinal record for the patient dashboard
router.get('/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  try {
    const patientResult = await pool.query('SELECT * FROM patients WHERE id = $1', [id]);
    if (patientResult.rows.length === 0) return res.status(404).json({ error: 'Patient not found' });

    const [health, triage, consultations, prescriptions, referrals, followUps, appointments] = await Promise.all([
      pool.query('SELECT * FROM patient_health_profile WHERE patient_id = $1', [id]),
      pool.query('SELECT * FROM triage_records WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 10', [id]),
      pool.query('SELECT * FROM consultations WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 10', [id]),
      pool.query(
        `SELECT pr.*, json_agg(pi.*) AS items FROM prescriptions pr
         LEFT JOIN prescription_items pi ON pi.prescription_id = pr.id
         WHERE pr.patient_id = $1 GROUP BY pr.id ORDER BY pr.created_at DESC LIMIT 10`, [id]),
      pool.query('SELECT * FROM referrals WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 10', [id]),
      pool.query('SELECT * FROM follow_ups WHERE patient_id = $1 ORDER BY follow_up_date DESC LIMIT 10', [id]),
      pool.query('SELECT * FROM appointments WHERE patient_id = $1 ORDER BY scheduled_date DESC LIMIT 10', [id]),
    ]);

    res.json({
      patient: patientResult.rows[0],
      health_profile: health.rows[0] || null,
      triage_history: triage.rows,
      consultations: consultations.rows,
      prescriptions: prescriptions.rows,
      referrals: referrals.rows,
      follow_ups: followUps.rows,
      appointments: appointments.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
