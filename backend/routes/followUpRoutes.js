const express = require("express");

const pool = require("../db");
const authenticateToken = require("../middleware/authMiddleware");
const allowRoles = require("../middleware/roleMiddleware");

const router = express.Router();


// =====================================================
// 1. CREATE FOLLOW-UP
// =====================================================
// POST /api/follow-ups/create

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
        related_consultation_id,
        related_referral_id,
        assigned_to_user_id,
        reason,
        risk_category,
        follow_up_date
      } = req.body;

      if (!patient_id || !follow_up_date) {
        return res.status(400).json({
          status: "error",
          message: "patient_id and follow_up_date are required"
        });
      }

      const allowedRiskCategories = [
        "maternal",
        "child",
        "chronic",
        "elderly",
        "other"
      ];

      if (
        risk_category &&
        !allowedRiskCategories.includes(risk_category)
      ) {
        return res.status(400).json({
          status: "error",
          message: "Invalid risk_category"
        });
      }


      // Check patient

      const patientResult = await pool.query(
        `
        SELECT id, full_name, patient_ref_code
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


      // Check consultation

      if (related_consultation_id) {
        const consultationResult = await pool.query(
          `
          SELECT id
          FROM consultations
          WHERE id = $1
            AND patient_id = $2
          `,
          [
            related_consultation_id,
            patient_id
          ]
        );

        if (consultationResult.rows.length === 0) {
          return res.status(400).json({
            status: "error",
            message: "Consultation not found for this patient"
          });
        }
      }


      // Check referral

      if (related_referral_id) {
        const referralResult = await pool.query(
          `
          SELECT id
          FROM referrals
          WHERE id = $1
            AND patient_id = $2
          `,
          [
            related_referral_id,
            patient_id
          ]
        );

        if (referralResult.rows.length === 0) {
          return res.status(400).json({
            status: "error",
            message: "Referral not found for this patient"
          });
        }
      }


      // Check assigned user

      if (assigned_to_user_id) {
        const assignedUserResult = await pool.query(
          `
          SELECT id, full_name, role
          FROM users
          WHERE id = $1
            AND is_active = true
          `,
          [assigned_to_user_id]
        );

        if (assignedUserResult.rows.length === 0) {
          return res.status(404).json({
            status: "error",
            message: "Assigned user not found"
          });
        }
      }


      // Create follow-up

      const result = await pool.query(
        `
        INSERT INTO follow_ups (
          patient_id,
          related_consultation_id,
          related_referral_id,
          assigned_to_user_id,
          reason,
          risk_category,
          follow_up_date,
          status
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          'upcoming'
        )
        RETURNING
          id,
          patient_id,
          related_consultation_id,
          related_referral_id,
          assigned_to_user_id,
          reason,
          risk_category,
          follow_up_date,
          status,
          completed_at,
          created_at,
          updated_at
        `,
        [
          patient_id,
          related_consultation_id || null,
          related_referral_id || null,
          assigned_to_user_id || null,
          reason || null,
          risk_category || null,
          follow_up_date
        ]
      );

      return res.status(201).json({
        status: "success",
        message: "Follow-up created successfully",
        data: result.rows[0]
      });

    } catch (error) {
      console.error(
        "Create follow-up error:",
        error.message
      );

      return res.status(500).json({
        status: "error",
        message: "Failed to create follow-up"
      });
    }
  }
);


// =====================================================
// 2. GET MY FOLLOW-UPS
// =====================================================
// GET /api/follow-ups/my

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
          f.id,
          f.patient_id,
          f.related_consultation_id,
          f.related_referral_id,
          f.assigned_to_user_id,
          f.reason,
          f.risk_category,
          f.follow_up_date,
          f.status,
          f.completed_at,
          f.created_at,
          f.updated_at,

          u.full_name AS assigned_to_name,
          u.role AS assigned_to_role

        FROM follow_ups f

        LEFT JOIN users u
          ON u.id = f.assigned_to_user_id

        WHERE f.patient_id = $1

        ORDER BY
          f.follow_up_date ASC,
          f.created_at DESC
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
        "Get my follow-ups error:",
        error.message
      );

      return res.status(500).json({
        status: "error",
        message: "Failed to fetch follow-ups"
      });
    }
  }
);


// =====================================================
// 3. GET FOLLOW-UP DETAILS
// =====================================================
// GET /api/follow-ups/:followUpId

router.get(
  "/:followUpId",
  authenticateToken,
  async (req, res) => {
    try {
      const { followUpId } = req.params;

      const result = await pool.query(
        `
        SELECT
          f.id,
          f.patient_id,
          f.related_consultation_id,
          f.related_referral_id,
          f.assigned_to_user_id,
          f.reason,
          f.risk_category,
          f.follow_up_date,
          f.status,
          f.completed_at,
          f.created_at,
          f.updated_at,

          p.full_name AS patient_name,
          p.patient_ref_code,

          u.full_name AS assigned_to_name,
          u.role AS assigned_to_role

        FROM follow_ups f

        JOIN patients p
          ON p.id = f.patient_id

        LEFT JOIN users u
          ON u.id = f.assigned_to_user_id

        WHERE f.id = $1
        `,
        [followUpId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Follow-up not found"
        });
      }

      const followUp = result.rows[0];


      // Patient authorization

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
          patientResult.rows[0].id !== followUp.patient_id
        ) {
          return res.status(403).json({
            status: "error",
            message: "You do not have permission to view this follow-up"
          });
        }
      }


      return res.status(200).json({
        status: "success",
        data: followUp
      });

    } catch (error) {
      console.error(
        "Get follow-up details error:",
        error.message
      );

      return res.status(500).json({
        status: "error",
        message: "Failed to fetch follow-up"
      });
    }
  }
);


// =====================================================
// 4. COMPLETE FOLLOW-UP
// =====================================================
// PATCH /api/follow-ups/:followUpId/complete

router.patch(
  "/:followUpId/complete",
  authenticateToken,
  allowRoles(
    "patient",
    "doctor",
    "frontline_worker",
    "facility_staff"
  ),
  async (req, res) => {
    try {
      const { followUpId } = req.params;

      const existingResult = await pool.query(
        `
        SELECT
          id,
          patient_id,
          status
        FROM follow_ups
        WHERE id = $1
        `,
        [followUpId]
      );

      if (existingResult.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Follow-up not found"
        });
      }

      if (existingResult.rows[0].status === "completed") {
        return res.status(400).json({
          status: "error",
          message: "Follow-up is already completed"
        });
      }


      const result = await pool.query(
        `
        UPDATE follow_ups
        SET
          status = 'completed',
          completed_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
        RETURNING
          id,
          patient_id,
          related_consultation_id,
          related_referral_id,
          assigned_to_user_id,
          reason,
          risk_category,
          follow_up_date,
          status,
          completed_at,
          created_at,
          updated_at
        `,
        [followUpId]
      );

      return res.status(200).json({
        status: "success",
        message: "Follow-up completed successfully",
        data: result.rows[0]
      });

    } catch (error) {
      console.error(
        "Complete follow-up error:",
        error.message
      );

      return res.status(500).json({
        status: "error",
        message: "Failed to complete follow-up"
      });
    }
  }
);


module.exports = router;