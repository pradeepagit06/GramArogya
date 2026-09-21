const express = require('express');
const cors = require('cors');
require('dotenv').config();

const pool = require('./db');
const authRoutes = require('./routes/auth');
const patientRoutes = require('./routes/patients');
const triageRoutes = require('./routes/triage');
const referralRoutes = require('./routes/referrals');
const followUpRoutes = require('./routes/followups');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ status: 'ok', db_time: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/triage', triageRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/follow-ups', followUpRoutes);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`GramArogya backend running on port ${PORT}`));
