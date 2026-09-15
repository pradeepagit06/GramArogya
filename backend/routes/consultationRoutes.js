
const express = require("express");

const pool = require("../db");
const authenticateToken = require("../middleware/authMiddleware");
const allowRoles = require("../middleware/roleMiddleware");

const router = express.Router();

// ========================================
// REQUEST CONSULTATION - PATIENT
// ========================================
router.post(
  "/request",
  authenticateToken,
  allowRoles("patient"),
  async (req, res) => {
    try {
      const {
        appointment_id,
        facility_id,
        mode,
        symptoms,
        vitals
      } = req.body;

      const allowedModes = [
        "in_person",
        "teleconsultation"
      ];

      if (mode && !allowedModes.includes(mode)) {
        return res.status(400).json({
          status: "error",
          message: "Invalid consultation mode"
        });
      }

      const patientResult = await pool.query(
        `SELECT id
         FROM patients
         WHERE user_id = $1
           AND is_active = true`,
        [req.user.userId]
      );

      if (patientResult.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Patient profile not found"
        });
      }

      const patientId = patientResult.rows[0].id;

      // Validate appointment
      if (appointment_id) {
        const appointmentResult = await pool.query(
          `SELECT id, facility_id
           FROM appointments
           WHERE id = $1
             AND patient_id = $2`,
          [appointment_id, patientId]
        );

        if (appointmentResult.rows.length === 0) {
          return res.status(404).json({
            status: "error",
            message: "Appointment not found for this patient"
          });
        }
      }

      // Validate facility
      if (facility_id) {
        const facilityResult = await pool.query(
          `SELECT id
           FROM facilities
           WHERE id = $1
             AND is_active = true`,
          [facility_id]
        );

        if (facilityResult.rows.length === 0) {
          return res.status(404).json({
            status: "error",
            message: "Facility not found"
          });
        }
      }

      const result = await pool.query(
        `INSERT INTO consultations
        (
          patient_id,
          requested_by,
          facility_id,
          appointment_id,
          mode,
          status,
          symptoms,
          vitals
        )
        VALUES
        (
          $1,
          $2,
          $3,
          $4,
          COALESCE($5::consultation_mode, 'in_person'::consultation_mode),
          'requested'::consultation_status,
          COALESCE($6::jsonb, '[]'::jsonb),
          COALESCE($7::jsonb, '{}'::jsonb)
        )
        RETURNING
          id,
          patient_id,
          requested_by,
          facility_id,
          appointment_id,
          mode,
          status,
          symptoms,
          vitals,
          created_at`,
        [
          patientId,
          req.user.userId,
          facility_id || null,
          appointment_id || null,
          mode || null,
          JSON.stringify(symptoms || []),
          JSON.stringify(vitals || {})
        ]
      );

      res.status(201).json({
        status: "success",
        message: "Consultation requested successfully",
        consultation: result.rows[0]
      });

    } catch (error) {
      console.error(
        "Consultation request error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message: "Failed to request consultation"
      });
    }
  }
);

// ========================================
// GET MY CONSULTATIONS - PATIENT
// ========================================
router.get(
  "/my",
  authenticateToken,
  allowRoles("patient"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
          c.id,
          c.patient_id,
          c.doctor_id,
          d.full_name AS doctor_name,
          c.facility_id,
          f.name AS facility_name,
          c.appointment_id,
          c.mode,
          c.status,
          c.symptoms,
          c.vitals,
          c.clinical_notes,
          c.diagnosis,
          c.treatment_instructions,
          c.video_room_url,
          c.started_at,
          c.completed_at,
          c.created_at,
          c.updated_at
         FROM consultations c
         LEFT JOIN users d
           ON d.id = c.doctor_id
         LEFT JOIN facilities f
           ON f.id = c.facility_id
         INNER JOIN patients p
           ON p.id = c.patient_id
         WHERE p.user_id = $1
         ORDER BY c.created_at DESC`,
        [req.user.userId]
      );

      res.json({
        status: "success",
        message: "Consultations retrieved successfully",
        consultations: result.rows
      });

    } catch (error) {
      console.error(
        "Get consultations error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message: "Failed to retrieve consultations"
      });
    }
  }
);

// ========================================
// GET SINGLE CONSULTATION - PATIENT
// ========================================
router.get(
  "/:consultationId",
  authenticateToken,
  allowRoles("patient"),
  async (req, res) => {
    try {
      const { consultationId } = req.params;

      const result = await pool.query(
        `SELECT
          c.id,
          c.patient_id,
          c.doctor_id,
          d.full_name AS doctor_name,
          c.facility_id,
          f.name AS facility_name,
          c.appointment_id,
          c.mode,
          c.status,
          c.symptoms,
          c.vitals,
          c.clinical_notes,
          c.diagnosis,
          c.treatment_instructions,
          c.video_room_url,
          c.started_at,
          c.completed_at,
          c.created_at,
          c.updated_at
         FROM consultations c
         LEFT JOIN users d
           ON d.id = c.doctor_id
         LEFT JOIN facilities f
           ON f.id = c.facility_id
         INNER JOIN patients p
           ON p.id = c.patient_id
         WHERE c.id = $1
           AND p.user_id = $2`,
        [consultationId, req.user.userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Consultation not found"
        });
      }

      res.json({
        status: "success",
        message: "Consultation retrieved successfully",
        consultation: result.rows[0]
      });

    } catch (error) {
      console.error(
        "Get consultation error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message: "Failed to retrieve consultation"
      });
    }
  }
);

// ======================================================
// DOCTOR SECTION
// ======================================================

// ========================================
// GET REQUESTED CONSULTATIONS - DOCTOR
// ========================================
router.get(
  "/doctor/requests",
  authenticateToken,
  allowRoles("doctor"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
          c.id,
          c.patient_id,
          p.patient_ref_code,
          u.full_name AS patient_name,
          u.phone_number AS patient_phone,
          c.doctor_id,
          c.facility_id,
          f.name AS facility_name,
          c.appointment_id,
          c.mode,
          c.status,
          c.symptoms,
          c.vitals,
          c.created_at
         FROM consultations c
         INNER JOIN patients p
           ON p.id = c.patient_id
         INNER JOIN users u
           ON u.id = p.user_id
         LEFT JOIN facilities f
           ON f.id = c.facility_id
         WHERE c.status = 'requested'::consultation_status
         ORDER BY c.created_at ASC`
      );

      res.json({
        status: "success",
        message: "Requested consultations retrieved successfully",
        consultations: result.rows
      });

    } catch (error) {
      console.error(
        "Get doctor requests error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message: "Failed to retrieve consultation requests"
      });
    }
  }
);

// ========================================
// GET MY CONSULTATIONS - DOCTOR
// ========================================
router.get(
  "/doctor/my",
  authenticateToken,
  allowRoles("doctor"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
          c.id,
          c.patient_id,
          p.patient_ref_code,
          u.full_name AS patient_name,
          u.phone_number AS patient_phone,
          c.doctor_id,
          c.facility_id,
          f.name AS facility_name,
          c.appointment_id,
          c.mode,
          c.status,
          c.symptoms,
          c.vitals,
          c.clinical_notes,
          c.diagnosis,
          c.treatment_instructions,
          c.video_room_url,
          c.started_at,
          c.completed_at,
          c.created_at,
          c.updated_at
         FROM consultations c
         INNER JOIN patients p
           ON p.id = c.patient_id
         INNER JOIN users u
           ON u.id = p.user_id
         LEFT JOIN facilities f
           ON f.id = c.facility_id
         WHERE c.doctor_id = $1
         ORDER BY c.created_at DESC`,
        [req.user.userId]
      );

      res.json({
        status: "success",
        message: "Doctor consultations retrieved successfully",
        consultations: result.rows
      });

    } catch (error) {
      console.error(
        "Get doctor consultations error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message: "Failed to retrieve doctor consultations"
      });
    }
  }
);

// ========================================
// ACCEPT CONSULTATION - DOCTOR
// ========================================
router.patch(
  "/doctor/:consultationId/accept",
  authenticateToken,
  allowRoles("doctor"),
  async (req, res) => {
    try {
      const { consultationId } = req.params;

      const result = await pool.query(
        `UPDATE consultations
         SET
           doctor_id = $1,
           status = 'in_progress'::consultation_status,
           started_at = COALESCE(started_at, NOW()),
           updated_at = NOW()
         WHERE id = $2
           AND status = 'requested'::consultation_status
         RETURNING
           id,
           patient_id,
           doctor_id,
           facility_id,
           appointment_id,
           mode,
           status,
           symptoms,
           vitals,
           started_at,
           created_at,
           updated_at`,
        [req.user.userId, consultationId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Requested consultation not found or already assigned"
        });
      }

      res.json({
        status: "success",
        message: "Consultation accepted successfully",
        consultation: result.rows[0]
      });

    } catch (error) {
      console.error(
        "Accept consultation error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message: "Failed to accept consultation"
      });
    }
  }
);

// ========================================
// UPDATE CONSULTATION - DOCTOR
// ========================================
router.patch(
  "/doctor/:consultationId/update",
  authenticateToken,
  allowRoles("doctor"),
  async (req, res) => {
    try {
      const { consultationId } = req.params;

      const {
        clinical_notes,
        diagnosis,
        treatment_instructions,
        vitals
      } = req.body;

      const result = await pool.query(
        `UPDATE consultations
         SET
           clinical_notes = COALESCE($1, clinical_notes),
           diagnosis = COALESCE($2, diagnosis),
           treatment_instructions = COALESCE($3, treatment_instructions),
           vitals = COALESCE($4::jsonb, vitals),
           updated_at = NOW()
         WHERE id = $5
           AND doctor_id = $6
           AND status = 'in_progress'::consultation_status
         RETURNING
           id,
           patient_id,
           doctor_id,
           status,
           symptoms,
           vitals,
           clinical_notes,
           diagnosis,
           treatment_instructions,
           started_at,
           updated_at`,
        [
          clinical_notes ?? null,
          diagnosis ?? null,
          treatment_instructions ?? null,
          vitals !== undefined
            ? JSON.stringify(vitals)
            : null,
          consultationId,
          req.user.userId
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Active consultation not found for this doctor"
        });
      }

      res.json({
        status: "success",
        message: "Consultation updated successfully",
        consultation: result.rows[0]
      });

    } catch (error) {
      console.error(
        "Update consultation error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message: "Failed to update consultation"
      });
    }
  }
);

// ========================================
// COMPLETE CONSULTATION - DOCTOR
// ========================================
router.patch(
  "/doctor/:consultationId/complete",
  authenticateToken,
  allowRoles("doctor"),
  async (req, res) => {
    try {
      const { consultationId } = req.params;

      const {
        clinical_notes,
        diagnosis,
        treatment_instructions
      } = req.body;

      const result = await pool.query(
        `UPDATE consultations
         SET
           clinical_notes = COALESCE($1, clinical_notes),
           diagnosis = COALESCE($2, diagnosis),
           treatment_instructions = COALESCE($3, treatment_instructions),
           status = 'completed'::consultation_status,
           completed_at = NOW(),
           updated_at = NOW()
         WHERE id = $4
           AND doctor_id = $5
           AND status = 'in_progress'::consultation_status
         RETURNING
           id,
           patient_id,
           doctor_id,
           status,
           symptoms,
           vitals,
           clinical_notes,
           diagnosis,
           treatment_instructions,
           started_at,
           completed_at,
           updated_at`,
        [
          clinical_notes ?? null,
          diagnosis ?? null,
          treatment_instructions ?? null,
          consultationId,
          req.user.userId
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Active consultation not found for this doctor"
        });
      }

      res.json({
        status: "success",
        message: "Consultation completed successfully",
        consultation: result.rows[0]
      });

    } catch (error) {
      console.error(
        "Complete consultation error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message: "Failed to complete consultation"
      });
    }
  }
);

module.exports = router;