const express = require('express');
const pool = require('../db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

const VALID_STATUSES = [
  'created', 'sent', 'received', 'accepted',
  'scheduled', 'patient_arrived', 'completed', 'cancelled'
];

// POST /api/referrals
router.post('/', verifyToken, async (req, res) => {
  const {
    patient_id, consultation_id, referring_facility_id, receiving_facility_id,
    required_department, reason, priority, notes
  } = req.body;

  if (!patient_id || !reason) {
    return res.status(400).json({ error: 'patient_id and reason are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO referrals (
        patient_id, consultation_id, referring_user_id, referring_facility_id,
        receiving_facility_id, required_department, reason, priority, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *`,
      [
        patient_id, consultation_id || null, req.user.userId, referring_facility_id || null,
        receiving_facility_id || null, required_department || null, reason,
        priority || 'normal', notes || null
      ]
    );
    const referral = rows[0];

    await client.query(
      `INSERT INTO referral_status_history (referral_id, status, changed_by, remarks)
       VALUES ($1, 'created', $2, 'Referral created')`,
      [referral.id, req.user.userId]
    );

    await client.query('COMMIT');
    res.status(201).json({ referral });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PATCH /api/referrals/:id/status   { status, remarks }
router.patch('/:id/status', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { status, remarks } = req.body;

  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'UPDATE referrals SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [status, id]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Referral not found' });
    }

    await client.query(
      `INSERT INTO referral_status_history (referral_id, status, changed_by, remarks)
       VALUES ($1, $2, $3, $4)`,
      [id, status, req.user.userId, remarks || null]
    );

    // Notify the frontline worker who created the referral.
    await client.query(
      `INSERT INTO notifications (user_id, type, title, message, related_entity_type, related_entity_id)
       VALUES ($1, 'referral_update', 'Referral status updated', $2, 'referral', $3)`,
      [rows[0].referring_user_id, `Referral is now: ${status.replace('_',' ')}`, id]
    );

    await client.query('COMMIT');
    res.json({ referral: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/referrals/patient/:patientId
router.get('/patient/:patientId', verifyToken, async (req, res) => {
  try {
    const referrals = await pool.query(
      'SELECT * FROM referrals WHERE patient_id = $1 ORDER BY created_at DESC',
      [req.params.patientId]
    );
    const history = await pool.query(
      `SELECT h.* FROM referral_status_history h
       JOIN referrals r ON r.id = h.referral_id
       WHERE r.patient_id = $1 ORDER BY h.changed_at ASC`,
      [req.params.patientId]
    );
    res.json({ referrals: referrals.rows, status_history: history.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/referrals/facility/:facilityId — incoming queue for PHC/hospital dashboard
router.get('/facility/:facilityId', verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*, p.full_name AS patient_name, p.patient_ref_code
       FROM referrals r JOIN patients p ON p.id = r.patient_id
       WHERE r.receiving_facility_id = $1 AND r.status NOT IN ('completed','cancelled')
       ORDER BY CASE r.priority WHEN 'emergency' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, r.created_at ASC`,
      [req.params.facilityId]
    );
    res.json({ referrals: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
