const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db');

const router = express.Router();

function generateOtp() {
  return String(Math.floor(1000 + Math.random() * 9000)); // 4-digit
}

// POST /api/auth/send-otp   { phone_number, role }
router.post('/send-otp', async (req, res) => {
  const { phone_number, role } = req.body;
  if (!phone_number || phone_number.length !== 10) {
    return res.status(400).json({ error: 'Valid 10-digit phone_number required' });
  }

  const otp = generateOtp();
  const otpHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min

  await pool.query(
    `INSERT INTO otp_verifications (phone_number, otp_code_hash, purpose, expires_at)
     VALUES ($1, $2, 'login', $3)`,
    [phone_number, otpHash, expiresAt]
  );

  // TODO: replace this console.log with a real SMS gateway call (MSG91, Twilio, etc.)
  console.log(`[DEV ONLY] OTP for ${phone_number}: ${otp}`);

  res.json({ message: 'OTP sent' });
});

// POST /api/auth/verify-otp   { phone_number, otp, role, full_name }
router.post('/verify-otp', async (req, res) => {
  const { phone_number, otp, role, full_name } = req.body;

  const { rows } = await pool.query(
    `SELECT * FROM otp_verifications
     WHERE phone_number = $1 AND purpose = 'login' AND is_verified = FALSE
     ORDER BY created_at DESC LIMIT 1`,
    [phone_number]
  );

  if (rows.length === 0) return res.status(400).json({ error: 'No OTP found, request a new one' });

  const record = rows[0];
  if (new Date() > new Date(record.expires_at)) {
    return res.status(400).json({ error: 'OTP expired' });
  }

  const isValid = await bcrypt.compare(otp, record.otp_code_hash);
  if (!isValid) return res.status(400).json({ error: 'Incorrect OTP' });

  await pool.query(`UPDATE otp_verifications SET is_verified = TRUE WHERE id = $1`, [record.id]);

  // find or create the user
  let userResult = await pool.query(`SELECT * FROM users WHERE phone_number = $1`, [phone_number]);
  let user;
  if (userResult.rows.length === 0) {
    const insert = await pool.query(
      `INSERT INTO users (role, full_name, phone_number, is_phone_verified)
       VALUES ($1, $2, $3, TRUE) RETURNING *`,
      [role || 'patient', full_name || 'New User', phone_number]
    );
    user = insert.rows[0];
  } else {
    user = userResult.rows[0];
    await pool.query(`UPDATE users SET is_phone_verified = TRUE, last_login_at = NOW() WHERE id = $1`, [user.id]);
  }

  const token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });

  await pool.query(
    `INSERT INTO auth_sessions (user_id, refresh_token_hash, expires_at)
     VALUES ($1, $2, NOW() + interval '7 days')`,
    [user.id, await bcrypt.hash(token, 10)]
  );

  res.json({ token, user: { id: user.id, role: user.role, full_name: user.full_name } });
});

module.exports = router;
