const express = require("express");
const router = express.Router();

const pool = require("../db");
const authenticateToken = require("../middleware/authMiddleware");
const allowRoles = require("../middleware/roleMiddleware");

// POST /api/duplicate-flags/create
// Create a possible duplicate flag
router.post(
  "/create",
  authenticateToken,
  allowRoles(
    "patient",
    "doctor",
    "frontline_worker",
    "facility_staff",
    "district_admin"
  ),
  async (req, res) => {
    try {
      const {
        patient_id,
        possible_duplicate_of,
        match_reason
      } = req.body;

      if (!patient_id || !possible_duplicate_of) {
        return res.status(400).json({
          status: "error",
          message:
            "patient_id and possible_duplicate_of are required"
        });
      }

      if (patient_id === possible_duplicate_of) {
        return res.status(400).json({
          status: "error",
          message:
            "patient_id and possible_duplicate_of cannot be the same"
        });
      }

      const patientCheck = await pool.query(
        `
        SELECT id
        FROM patients
        WHERE id = $1
        `,
        [patient_id]
      );

      if (patientCheck.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Patient not found"
        });
      }

      const duplicateCheck = await pool.query(
        `
        SELECT id
        FROM patients
        WHERE id = $1
        `,
        [possible_duplicate_of]
      );

      if (duplicateCheck.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Possible duplicate patient not found"
        });
      }

      const existingFlag = await pool.query(
        `
        SELECT id
        FROM patient_duplicate_flags
        WHERE patient_id = $1
          AND possible_duplicate_of = $2
          AND resolved = false
        LIMIT 1
        `,
        [patient_id, possible_duplicate_of]
      );

      if (existingFlag.rows.length > 0) {
        return res.status(409).json({
          status: "error",
          message: "Duplicate flag already exists",
          flag_id: existingFlag.rows[0].id
        });
      }

      const result = await pool.query(
        `
        INSERT INTO patient_duplicate_flags
        (
          patient_id,
          possible_duplicate_of,
          match_reason
        )
        VALUES
        ($1, $2, $3)
        RETURNING
          id,
          patient_id,
          possible_duplicate_of,
          match_reason,
          resolved,
          created_at
        `,
        [
          patient_id,
          possible_duplicate_of,
          match_reason || null
        ]
      );

      return res.status(201).json({
        status: "success",
        message: "Possible duplicate flag created",
        data: result.rows[0]
      });

    } catch (error) {
      console.error(
        "Create duplicate flag error:",
        error.message
      );

      return res.status(500).json({
        status: "error",
        message: "Failed to create duplicate flag"
      });
    }
  }
);


// GET /api/duplicate-flags/my
// Get duplicate flags related to logged-in patient's record
router.get(
  "/my",
  authenticateToken,
  allowRoles("patient"),
  async (req, res) => {
    try {
      const userId = req.user.userId;

      const patientResult = await pool.query(
        `
        SELECT id
        FROM patients
        WHERE user_id = $1
        LIMIT 1
        `,
        [userId]
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
          pdf.id,
          pdf.patient_id,
          p1.full_name AS patient_name,
          pdf.possible_duplicate_of,
          p2.full_name AS possible_duplicate_name,
          pdf.match_reason,
          pdf.resolved,
          pdf.created_at
        FROM patient_duplicate_flags pdf
        JOIN patients p1
          ON p1.id = pdf.patient_id
        JOIN patients p2
          ON p2.id = pdf.possible_duplicate_of
        WHERE pdf.patient_id = $1
           OR pdf.possible_duplicate_of = $1
        ORDER BY pdf.created_at DESC
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
        "Get my duplicate flags error:",
        error.message
      );

      return res.status(500).json({
        status: "error",
        message: "Failed to fetch duplicate flags"
      });
    }
  }
);


// GET /api/duplicate-flags/all
// Staff/admin can view all duplicate flags
router.get(
  "/all",
  authenticateToken,
  allowRoles(
    "doctor",
    "frontline_worker",
    "facility_staff",
    "district_admin"
  ),
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT
          pdf.id,
          pdf.patient_id,
          p1.full_name AS patient_name,
          pdf.possible_duplicate_of,
          p2.full_name AS possible_duplicate_name,
          pdf.match_reason,
          pdf.resolved,
          pdf.created_at
        FROM patient_duplicate_flags pdf
        JOIN patients p1
          ON p1.id = pdf.patient_id
        JOIN patients p2
          ON p2.id = pdf.possible_duplicate_of
        ORDER BY pdf.created_at DESC
        `
      );

      return res.status(200).json({
        status: "success",
        count: result.rows.length,
        data: result.rows
      });

    } catch (error) {
      console.error(
        "Get all duplicate flags error:",
        error.message
      );

      return res.status(500).json({
        status: "error",
        message: "Failed to fetch duplicate flags"
      });
    }
  }
);


// GET /api/duplicate-flags/:flagId
// Get one duplicate flag
router.get(
  "/:flagId",
  authenticateToken,
  async (req, res) => {
    try {
      const { flagId } = req.params;

      const result = await pool.query(
        `
        SELECT
          pdf.id,
          pdf.patient_id,
          p1.full_name AS patient_name,
          pdf.possible_duplicate_of,
          p2.full_name AS possible_duplicate_name,
          pdf.match_reason,
          pdf.resolved,
          pdf.created_at
        FROM patient_duplicate_flags pdf
        JOIN patients p1
          ON p1.id = pdf.patient_id
        JOIN patients p2
          ON p2.id = pdf.possible_duplicate_of
        WHERE pdf.id = $1
        `,
        [flagId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Duplicate flag not found"
        });
      }

      return res.status(200).json({
        status: "success",
        data: result.rows[0]
      });

    } catch (error) {
      console.error(
        "Get duplicate flag error:",
        error.message
      );

      return res.status(500).json({
        status: "error",
        message: "Failed to fetch duplicate flag"
      });
    }
  }
);


// PATCH /api/duplicate-flags/:flagId/resolve
// Mark duplicate flag as resolved
router.patch(
  "/:flagId/resolve",
  authenticateToken,
  allowRoles(
    "doctor",
    "frontline_worker",
    "facility_staff",
    "district_admin"
  ),
  async (req, res) => {
    try {
      const { flagId } = req.params;

      const result = await pool.query(
        `
        UPDATE patient_duplicate_flags
        SET resolved = true
        WHERE id = $1
        RETURNING
          id,
          patient_id,
          possible_duplicate_of,
          match_reason,
          resolved,
          created_at
        `,
        [flagId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Duplicate flag not found"
        });
      }

      return res.status(200).json({
        status: "success",
        message: "Duplicate flag resolved",
        data: result.rows[0]
      });

    } catch (error) {
      console.error(
        "Resolve duplicate flag error:",
        error.message
      );

      return res.status(500).json({
        status: "error",
        message: "Failed to resolve duplicate flag"
      });
    }
  }
);


module.exports = router;