const express = require("express");

const pool = require("../db");
const authenticateToken = require("../middleware/authMiddleware");
const allowRoles = require("../middleware/roleMiddleware");

const router = express.Router();

// ========================================
// GET PATIENT PROFILE
// ========================================
router.get(
  "/profile",
  authenticateToken,
  allowRoles("patient"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
          id,
          role,
          full_name,
          phone_number,
          email,
          preferred_language,
          is_phone_verified,
          is_email_verified,
          profile_photo_url,
          last_login_at,
          created_at,
          updated_at
         FROM users
         WHERE id = $1
           AND role = 'patient'
           AND is_active = true`,
        [req.user.userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Patient profile not found"
        });
      }

      res.json({
        status: "success",
        message: "Patient profile retrieved successfully",
        patient: result.rows[0]
      });

    } catch (error) {
      console.error("Patient profile error:", error.message);

      res.status(500).json({
        status: "error",
        message: "Failed to retrieve patient profile"
      });
    }
  }
);

// ========================================
// GET PATIENT DASHBOARD
// ========================================
router.get(
  "/dashboard",
  authenticateToken,
  allowRoles("patient"),
  async (req, res) => {
    try {
      // ------------------------------------
      // PATIENT PROFILE
      // ------------------------------------
      const patientResult = await pool.query(
        `SELECT
          p.id,
          p.patient_ref_code,
          p.full_name,
          p.date_of_birth,
          p.approximate_age,
          p.gender,
          p.phone_number,
          p.village,
          p.district,
          p.state,
          p.address,
          p.blood_group,
          p.preferred_language,
          p.photo_url
         FROM patients p
         WHERE p.user_id = $1
           AND p.is_active = true`,
        [req.user.userId]
      );

      if (patientResult.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Patient profile not found"
        });
      }

      const patient = patientResult.rows[0];

      // ------------------------------------
      // UPCOMING APPOINTMENTS
      // ------------------------------------
      const appointmentsResult = await pool.query(
        `SELECT
          a.id,
          a.facility_id,
          f.name AS facility_name,
          f.type AS facility_type,
          f.district AS facility_district,
          a.doctor_id,
          d.full_name AS doctor_name,
          a.department,
          a.priority,
          a.status,
          a.scheduled_date,
          a.scheduled_time,
          a.queue_number,
          a.checked_in_at
         FROM appointments a
         LEFT JOIN facilities f
           ON f.id = a.facility_id
         LEFT JOIN users d
           ON d.id = a.doctor_id
         WHERE a.patient_id = $1
           AND a.scheduled_date >= CURRENT_DATE
           AND a.status = 'booked'::appointment_status
         ORDER BY
           a.scheduled_date ASC,
           a.scheduled_time ASC NULLS LAST
         LIMIT 5`,
        [patient.id]
      );

      // ------------------------------------
      // RECENT CONSULTATIONS
      // ------------------------------------
      const consultationsResult = await pool.query(
        `SELECT
          c.id,
          c.doctor_id,
          d.full_name AS doctor_name,
          c.facility_id,
          f.name AS facility_name,
          c.appointment_id,
          c.mode,
          c.status,
          c.symptoms,
          c.vitals,
          c.diagnosis,
          c.treatment_instructions,
          c.started_at,
          c.completed_at,
          c.created_at
         FROM consultations c
         LEFT JOIN users d
           ON d.id = c.doctor_id
         LEFT JOIN facilities f
           ON f.id = c.facility_id
         WHERE c.patient_id = $1
         ORDER BY c.created_at DESC
         LIMIT 5`,
        [patient.id]
      );

      // ------------------------------------
      // DASHBOARD RESPONSE
      // ------------------------------------
      res.json({
        status: "success",
        message: "Patient dashboard retrieved successfully",

        patient: patient,

        upcoming_appointments: appointmentsResult.rows,

        recent_consultations: consultationsResult.rows,

        summary: {
          upcoming_appointments: appointmentsResult.rows.length,
          recent_consultations: consultationsResult.rows.length
        }
      });

    } catch (error) {
      console.error(
        "Patient dashboard error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message: "Failed to retrieve patient dashboard"
      });
    }
  }
);

module.exports = router;