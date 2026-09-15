const express = require("express");

const pool = require("../db");
const authenticateToken = require("../middleware/authMiddleware");
const allowRoles = require("../middleware/roleMiddleware");

const router = express.Router();

// ========================================
// GET MY APPOINTMENTS
// ========================================
router.get(
  "/my",
  authenticateToken,
  allowRoles("patient"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
          a.id,
          a.facility_id,
          a.doctor_id,
          a.department,
          a.priority,
          a.status,
          a.scheduled_date,
          a.scheduled_time,
          a.queue_number,
          a.checked_in_at,
          a.created_at,
          a.updated_at
         FROM appointments a
         INNER JOIN patients p
           ON p.id = a.patient_id
         WHERE p.user_id = $1
         ORDER BY a.scheduled_date DESC, a.scheduled_time DESC`,
        [req.user.userId]
      );

      res.json({
        status: "success",
        message: "Appointments retrieved successfully",
        appointments: result.rows
      });

    } catch (error) {
      console.error("Get appointments error:", error.message);

      res.status(500).json({
        status: "error",
        message: "Failed to retrieve appointments"
      });
    }
  }
);

// ========================================
// BOOK APPOINTMENT
// ========================================
router.post(
  "/book",
  authenticateToken,
  allowRoles("patient"),
  async (req, res) => {
    try {
      const {
        facility_id,
        doctor_id,
        department,
        priority,
        scheduled_date,
        scheduled_time
      } = req.body;

      // Required fields
      if (!facility_id || !scheduled_date) {
        return res.status(400).json({
          status: "error",
          message: "Facility and appointment date are required"
        });
      }

      // Find patient profile linked to logged-in user
      const patientResult = await pool.query(
        `SELECT id
         FROM patients
         WHERE user_id = $1`,
        [req.user.userId]
      );

      if (patientResult.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Patient profile not found"
        });
      }

      const patientId = patientResult.rows[0].id;

      // Check facility
      const facilityResult = await pool.query(
        `SELECT id
         FROM facilities
         WHERE id = $1`,
        [facility_id]
      );

      if (facilityResult.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Facility not found"
        });
      }

      // Check doctor if provided
      if (doctor_id) {
        const doctorResult = await pool.query(
          `SELECT id
           FROM users
           WHERE id = $1
             AND role = 'doctor'
             AND is_active = true`,
          [doctor_id]
        );

        if (doctorResult.rows.length === 0) {
          return res.status(404).json({
            status: "error",
            message: "Doctor not found"
          });
        }
      }

      // Create appointment
      const result = await pool.query(
        `INSERT INTO appointments
         (
           patient_id,
           facility_id,
           doctor_id,
           department,
           priority,
           status,
           scheduled_date,
           scheduled_time
         )
         VALUES
         (
           $1,
           $2,
           $3,
           $4,
           COALESCE($5::priority_level, 'normal'::priority_level),
           'booked'::appointment_status,
           $6,
           $7
         )
         RETURNING
           id,
           patient_id,
           facility_id,
           doctor_id,
           department,
           priority,
           status,
           scheduled_date,
           scheduled_time,
           queue_number,
           created_at`,
        [
          patientId,
          facility_id,
          doctor_id || null,
          department || null,
          priority || null,
          scheduled_date,
          scheduled_time || null
        ]
      );

      res.status(201).json({
        status: "success",
        message: "Appointment booked successfully",
        appointment: result.rows[0]
      });

    } catch (error) {
      console.error("Book appointment error:", error.message);

      res.status(500).json({
        status: "error",
        message: "Failed to book appointment"
      });
    }
  }
);

// ========================================
// GET SINGLE APPOINTMENT
// ========================================
router.get(
  "/:appointmentId",
  authenticateToken,
  allowRoles("patient"),
  async (req, res) => {
    try {
      const { appointmentId } = req.params;

      const result = await pool.query(
        `SELECT
          a.id,
          a.facility_id,
          a.doctor_id,
          a.department,
          a.priority,
          a.status,
          a.scheduled_date,
          a.scheduled_time,
          a.queue_number,
          a.checked_in_at,
          a.created_at,
          a.updated_at
         FROM appointments a
         INNER JOIN patients p
           ON p.id = a.patient_id
         WHERE a.id = $1
           AND p.user_id = $2`,
        [appointmentId, req.user.userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Appointment not found"
        });
      }

      res.json({
        status: "success",
        message: "Appointment retrieved successfully",
        appointment: result.rows[0]
      });

    } catch (error) {
      console.error("Get appointment error:", error.message);

      res.status(500).json({
        status: "error",
        message: "Failed to retrieve appointment"
      });
    }
  }
);

// ========================================
// CANCEL APPOINTMENT
// ========================================
router.patch(
  "/:appointmentId/cancel",
  authenticateToken,
  allowRoles("patient"),
  async (req, res) => {
    try {
      const { appointmentId } = req.params;

      const result = await pool.query(
        `UPDATE appointments a
         SET
           status = 'cancelled'::appointment_status,
           updated_at = NOW()
         FROM patients p
         WHERE a.id = $1
           AND a.patient_id = p.id
           AND p.user_id = $2
           AND a.status IN (
             'booked'::appointment_status
           )
         RETURNING
           a.id,
           a.status,
           a.scheduled_date,
           a.scheduled_time,
           a.updated_at`,
        [appointmentId, req.user.userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Appointment not found or cannot be cancelled"
        });
      }

      res.json({
        status: "success",
        message: "Appointment cancelled successfully",
        appointment: result.rows[0]
      });

    } catch (error) {
      console.error("Cancel appointment error:", error.message);

      res.status(500).json({
        status: "error",
        message: "Failed to cancel appointment"
      });
    }
  }
);

module.exports = router;