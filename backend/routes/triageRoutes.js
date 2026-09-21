const express = require("express");

const pool = require("../db");
const authenticateToken = require("../middleware/authMiddleware");
const allowRoles = require("../middleware/roleMiddleware");

const router = express.Router();


// =====================================================
// 1. CREATE TRIAGE RECORD
// =====================================================
// POST /api/triage/create

router.post(
  "/create",
  authenticateToken,
  allowRoles(
    "patient",
    "doctor",
    "frontline_worker",
    "facility_staff"
  ),
  async (req, res) => {
    try {
      const {
        patient_id,
        symptoms,
        vitals,
        duration_text,
        severity_text,
        priority_result,
        reason_summary,
        is_offline_entry
      } = req.body;


      // Required fields

      if (!patient_id || !priority_result) {
        return res.status(400).json({
          status: "error",
          message: "patient_id and priority_result are required"
        });
      }


      // Validate priority

      const allowedPriorities = [
        "low",
        "normal",
        "high",
        "critical"
      ];

      if (!allowedPriorities.includes(priority_result)) {
        return res.status(400).json({
          status: "error",
          message: "Invalid priority_result"
        });
      }


      // Validate symptoms

      if (
        symptoms !== undefined &&
        !Array.isArray(symptoms)
      ) {
        return res.status(400).json({
          status: "error",
          message: "symptoms must be an array"
        });
      }


      // Validate vitals

      if (
        vitals !== undefined &&
        (
          typeof vitals !== "object" ||
          Array.isArray(vitals) ||
          vitals === null
        )
      ) {
        return res.status(400).json({
          status: "error",
          message: "vitals must be an object"
        });
      }


      // Check patient

      const patientResult = await pool.query(
        `
        SELECT
          id,
          full_name,
          patient_ref_code
        FROM patients
        WHERE id = $1
          AND is_active = true
        `,
        [patient_id]
      );

      if (patientResult.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Patient not found"
        });
      }


      // Create triage record

      const result = await pool.query(
        `
        INSERT INTO triage_records (
          patient_id,
          recorded_by,
          symptoms,
          vitals,
          duration_text,
          severity_text,
          priority_result,
          reason_summary,
          is_offline_entry
        )
        VALUES (
          $1,
          $2,
          $3::jsonb,
          $4::jsonb,
          $5,
          $6,
          $7::priority_level,
          $8,
          $9
        )
        RETURNING
          id,
          patient_id,
          recorded_by,
          symptoms,
          vitals,
          duration_text,
          severity_text,
          priority_result,
          reason_summary,
          is_offline_entry,
          created_at
        `,
        [
          patient_id,
          req.user.userId,
          JSON.stringify(symptoms || []),
          JSON.stringify(vitals || {}),
          duration_text || null,
          severity_text || null,
          priority_result,
          reason_summary || null,
          is_offline_entry || false
        ]
      );

      return res.status(201).json({
        status: "success",
        message: "Triage record created successfully",
        data: result.rows[0]
      });

    } catch (error) {
      console.error(
        "Create triage error:",
        error.message
      );

      return res.status(500).json({
        status: "error",
        message: "Failed to create triage record"
      });
    }
  }
);


// =====================================================
// 2. GET MY TRIAGE RECORDS
// =====================================================
// GET /api/triage/my

router.get(
  "/my",
  authenticateToken,
  allowRoles("patient"),
  async (req, res) => {
    try {

      const patientResult = await pool.query(
        `
        SELECT id
        FROM patients
        WHERE user_id = $1
          AND is_active = true
        `,
        [req.user.userId]
      );

      if (patientResult.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Patient profile not found"
        });
      }

      const patientId = patientResult.rows[0].id;


      const result = await pool.query(
        `
        SELECT
          t.id,
          t.patient_id,
          t.recorded_by,
          t.symptoms,
          t.vitals,
          t.duration_text,
          t.severity_text,
          t.priority_result,
          t.reason_summary,
          t.is_offline_entry,
          t.created_at,

          u.full_name AS recorded_by_name,
          u.role AS recorded_by_role

        FROM triage_records t

        LEFT JOIN users u
          ON u.id = t.recorded_by

        WHERE t.patient_id = $1

        ORDER BY t.created_at DESC
        `,
        [patientId]
      );

      return res.status(200).json({
        status: "success",
        count: result.rows.length,
        data: result.rows
      });

    } catch (error) {
      console.error(
        "Get my triage records error:",
        error.message
      );

      return res.status(500).json({
        status: "error",
        message: "Failed to fetch triage records"
      });
    }
  }
);


// =====================================================
// 3. GET TRIAGE DETAILS
// =====================================================
// GET /api/triage/:triageId

router.get(
  "/:triageId",
  authenticateToken,
  async (req, res) => {
    try {
      const { triageId } = req.params;

      const result = await pool.query(
        `
        SELECT
          t.id,
          t.patient_id,
          t.recorded_by,
          t.symptoms,
          t.vitals,
          t.duration_text,
          t.severity_text,
          t.priority_result,
          t.reason_summary,
          t.is_offline_entry,
          t.created_at,

          p.full_name AS patient_name,
          p.patient_ref_code,

          u.full_name AS recorded_by_name,
          u.role AS recorded_by_role

        FROM triage_records t

        JOIN patients p
          ON p.id = t.patient_id

        LEFT JOIN users u
          ON u.id = t.recorded_by

        WHERE t.id = $1
        `,
        [triageId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Triage record not found"
        });
      }

      const triageRecord = result.rows[0];


      // Patient can only view own record

      if (req.user.role === "patient") {

        const patientResult = await pool.query(
          `
          SELECT id
          FROM patients
          WHERE user_id = $1
          `,
          [req.user.userId]
        );

        if (
          patientResult.rows.length === 0 ||
          patientResult.rows[0].id !== triageRecord.patient_id
        ) {
          return res.status(403).json({
            status: "error",
            message: "You do not have permission to view this triage record"
          });
        }
      }


      return res.status(200).json({
        status: "success",
        data: triageRecord
      });

    } catch (error) {
      console.error(
        "Get triage details error:",
        error.message
      );

      return res.status(500).json({
        status: "error",
        message: "Failed to fetch triage record"
      });
    }
  }
);


module.exports = router;