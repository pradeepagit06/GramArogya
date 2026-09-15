
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const pool = require("./db");

const authRoutes = require("./routes/authRoutes");
const patientRoutes = require("./routes/patientRoutes");
const appointmentRoutes = require("./routes/appointmentRoutes");
const consultationRoutes = require("./routes/consultationRoutes");
const prescriptionRoutes = require("./routes/prescriptionRoutes");
const diagnosticRoutes = require("./routes/diagnosticRoutes");
const medicineRoutes = require("./routes/medicineRoutes");
const referralRoutes = require("./routes/referralRoutes");
const followUpRoutes = require("./routes/followUpRoutes");
const healthProfileRoutes = require("./routes/healthProfileRoutes");
const triageRoutes = require("./routes/triageRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const healthEducationRoutes = require("./routes/healthEducationRoutes");
const offlineSyncRoutes = require("./routes/offlineSyncRoutes");
const duplicateFlagRoutes = require("./routes/duplicateFlagRoutes");
const diagnosticAvailabilityRoutes = require("./routes/diagnosticAvailabilityRoutes");
const auditLogRoutes = require("./routes/auditLogRoutes");
const referralStatusHistoryRoutes = require("./routes/referralStatusHistoryRoutes");
const voiceTranslationRoutes = require("./routes/voiceTranslationRoutes");
const translateRoutes = require("./routes/translateRoutes");
const ttsRoutes = require("./routes/ttsRoutes");

// Facility Staff
const facilityStaffRoutes = require("./routes/facilityStaffRoutes");

const app = express();

app.use(cors());
app.use(express.json());

/* =========================
   API ROUTES
========================= */

app.use("/api/auth", authRoutes);

app.use("/api/patient", patientRoutes);

app.use("/api/appointments", appointmentRoutes);

app.use("/api/consultations", consultationRoutes);

app.use("/api/prescriptions", prescriptionRoutes);

app.use("/api/diagnostics", diagnosticRoutes);

app.use("/api/medicines", medicineRoutes);

app.use("/api/referrals", referralRoutes);

app.use("/api/follow-ups", followUpRoutes);

app.use("/api/health-profile", healthProfileRoutes);

app.use("/api/triage", triageRoutes);

app.use("/api/notifications", notificationRoutes);

app.use("/api/health-education", healthEducationRoutes);

app.use("/api/offline-sync", offlineSyncRoutes);

app.use("/api/duplicate-flags", duplicateFlagRoutes);

app.use(
  "/api/diagnostic-availability",
  diagnosticAvailabilityRoutes
);

app.use(
  "/api/audit-logs",
  auditLogRoutes
);

app.use(
  "/api/referral-status-history",
  referralStatusHistoryRoutes
);

/* =========================
   VOICE & LANGUAGE
========================= */

app.use(
  "/api/voice-translation",
  voiceTranslationRoutes
);

app.use(
  "/api/translate",
  translateRoutes
);

app.use(
  "/api/tts",
  ttsRoutes
);

/* =========================
   FACILITY STAFF
========================= */

app.use(
  "/api/facility-staff",
  facilityStaffRoutes
);

/* =========================
   ROOT ROUTE
========================= */

app.get("/", (req, res) => {
  res.json({
    message: "GramArogya Backend API is running",
    status: "success"
  });
});

/* =========================
   HEALTH CHECK
========================= */

app.get("/api/health", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT NOW() AS server_time"
    );

    res.json({
      status: "success",
      message: "Backend and PostgreSQL are connected",
      database: "connected",
      server_time: result.rows[0].server_time
    });

  } catch (error) {
    console.error(
      "Database health check failed:",
      error.message
    );

    res.status(500).json({
      status: "error",
      message: "Database connection failed"
    });
  }
});

/* =========================
   404 HANDLER
========================= */

app.use((req, res) => {
  res.status(404).json({
    status: "error",
    message: "API route not found"
  });
});

/* =========================
   SERVER START
========================= */

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(
    "GramArogya backend running on http://localhost:" + PORT
  );
});



