# GramArogya — Local Setup, Command by Command

Run these in order. Commands assume macOS/Linux; Windows notes are called out where it differs.

---

## 0. Check prerequisites

```bash
node -v      # need v18+
psql --version   # need v14+
git --version
```

If any are missing:

```bash
# macOS (Homebrew)
brew install node postgresql@14
brew services start postgresql@14

# Ubuntu/Debian
sudo apt update
sudo apt install nodejs npm postgresql postgresql-contrib
sudo systemctl start postgresql
```

---

## 1. Create the project

```bash
mkdir gramarogya && cd gramarogya
mkdir backend frontend
cd backend
npm init -y
```

---

## 2. Create the database and load the schema

Put `gramarogya_database_schema.sql` inside `gramarogya/backend/`, then:

```bash
# create the database
createdb gramarogya

# load the schema
psql -d gramarogya -f gramarogya_database_schema.sql

# confirm the tables exist
psql -d gramarogya -c "\dt"
```

> **Fix before loading, if you hit a "relation facilities does not exist" error:** the schema file defines `staff_profiles` (section 2) before `facilities` (section 3), but `staff_profiles.facility_id` references it. Cut the `CREATE TABLE facilities ( ... );` block from section 3 and paste it above `CREATE TABLE staff_profiles` in section 2, then re-run the `psql -f` command.

If `createdb`/`psql` prompt for a password you don't have, set one first:

```bash
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'yourpassword';"
```

---

## 3. Install backend dependencies

```bash
npm install express pg bcrypt jsonwebtoken dotenv cors
npm install -D nodemon
```

---

## 4. Create the `.env` file

```bash
cat > .env << 'EOF'
DATABASE_URL=postgresql://localhost:5432/gramarogya
JWT_SECRET=replace_with_a_long_random_string
PORT=4000
EOF
```

Generate a real secret instead of typing one by hand:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Copy that output into `JWT_SECRET` in `.env`.

---

## 5. Create the database connection pool

```bash
cat > db.js << 'EOF'
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

module.exports = pool;
EOF
```

---

## 6. Create the Express server with a health check

```bash
cat > server.js << 'EOF'
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const pool = require('./db');
const authRoutes = require('./routes/auth');

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

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`GramArogya backend running on port ${PORT}`));
EOF
```

---

## 7. Create the OTP authentication routes

```bash
mkdir routes
cat > routes/auth.js << 'EOF'
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
EOF
```

---

## 8. Run the backend

```bash
npx nodemon server.js
```

You should see:
```
GramArogya backend running on port 4000
```

---

## 9. Test it with curl (in a second terminal)

```bash
# health check
curl http://localhost:4000/api/health

# send an OTP (check the backend terminal — it prints the OTP since no SMS gateway is wired yet)
curl -X POST http://localhost:4000/api/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{"phone_number":"9876543210","role":"patient"}'

# verify it (replace 1234 with the OTP printed in the backend terminal)
curl -X POST http://localhost:4000/api/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"phone_number":"9876543210","otp":"1234","role":"patient","full_name":"Test Patient"}'
```

A successful verify returns a JSON object with a `token` — that confirms the whole chain (DB → OTP → JWT) works.

---

## 10. Serve the frontend files

```bash
cd ../frontend
# put gramarogya_login.html and gramarogya_voice_translate.html here
npx serve -l 3000
```

Open `http://localhost:3000/gramarogya_login.html` in your browser.

---

## 11. Connect the login page to the real backend

In `gramarogya_login.html`, replace the stubbed handlers with real calls. Find this block:

```js
document.getElementById('send-otp').addEventListener('click', ()=>{
  const val = document.getElementById('phone-input').value.trim();
  ...
```

Replace the body of that listener with:

```js
document.getElementById('send-otp').addEventListener('click', async ()=>{
  const val = document.getElementById('phone-input').value.trim();
  if (val.length !== 10) {
    document.getElementById('phone-input').style.borderColor = '#B5502E';
    return;
  }
  await fetch('http://localhost:4000/api/auth/send-otp', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ phone_number: val, role: selectedRole })
  });
  enteredPhone = val.slice(0,5) + " " + val.slice(5);
  document.getElementById('otp-sub-text').textContent = translations[currentLang].otpSubPrefix + enteredPhone;
  showStep('step-otp');
  setTimeout(()=> document.querySelector('.otp-row input').focus(), 100);
});
```

And the verify handler:

```js
document.getElementById('verify-otp').addEventListener('click', async ()=>{
  const code = Array.from(document.querySelectorAll('.otp-row input')).map(i=>i.value).join('');
  if (code.length !== 4) { alert('Enter all 4 digits.'); return; }

  const phoneDigits = enteredPhone.replace(/\s/g,'');
  const res = await fetch('http://localhost:4000/api/auth/verify-otp', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ phone_number: phoneDigits, otp: code, role: selectedRole, full_name: 'GramArogya User' })
  });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Verification failed'); return; }

  window.location.href = '/' + selectedRole + '/dashboard.html';
});
```

---

## 12. Run everything together

Two terminals:

```bash
# Terminal 1
cd gramarogya/backend && npx nodemon server.js

# Terminal 2
cd gramarogya/frontend && npx serve -l 3000
```

Then open `http://localhost:3000/gramarogya_login.html`, pick a role, enter a 10-digit phone number, watch the backend terminal for the printed OTP, and enter it to log in.

---

## 13. Next real step: SMS gateway

Right now the OTP is only printed to your backend console. To actually text it:

```bash
npm install twilio
```

```js
// in routes/auth.js, replace the console.log line with:
const twilio = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
await twilio.messages.create({
  body: `Your GramArogya OTP is ${otp}`,
  from: process.env.TWILIO_PHONE,
  to: `+91${phone_number}`
});
```

Add `TWILIO_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE` to `.env` once you have a Twilio (or MSG91) account.
