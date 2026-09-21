const express = require('express');
const pool = require('../db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// POST /api/follow-ups   { patient_id, reason, follow_up_date, risk_category, related_referral_id }
router.post('/', verifyToken, async (req, res) => {
  const { patient_id, reason, follow_up_date, risk_category, related_referral_id, related_consultation_id } = req.body;
  if (!patient_id || !follow_up_date) {
    return res.status(400).json({ error: 'patient_id and follow_up_date are required' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO follow_ups (
        patient_id, related_consultation_id, related_referral_id, assigned_to_user_id,
        reason, risk_category, follow_up_date, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,'upcoming')
      RETURNING *`,
      [patient_id, related_consultation_id || null, related_referral_id || null, req.user.userId,
       reason || null, risk_category || null, follow_up_date]
    );
    res.status(201).json({ follow_up: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/follow-ups/:id/complete
router.patch('/:id/complete', verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE follow_ups SET status = 'completed', completed_at = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Follow-up not found' });
    res.json({ follow_up: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/follow-ups/due-today — for the frontline worker / doctor dashboard card
router.get('/due-today', verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT f.*, p.full_name AS patient_name, p.patient_ref_code
       FROM follow_ups f JOIN patients p ON p.id = f.patient_id
       WHERE f.assigned_to_user_id = $1
         AND f.status IN ('upcoming','due_today','overdue')
         AND f.follow_up_date <= CURRENT_DATE
       ORDER BY f.follow_up_date ASC`,
      [req.user.userId]
    );
    res.json({ follow_ups: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/follow-ups/patient/:patientId
router.get('/patient/:patientId', verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM follow_ups WHERE patient_id = $1 ORDER BY follow_up_date DESC',
      [req.params.patientId]
    );
    res.json({ follow_ups: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
