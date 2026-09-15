const express = require("express");

const pool = require("../db");
const authenticateToken = require("../middleware/authMiddleware");
const allowRoles = require("../middleware/roleMiddleware");

const router = express.Router();


// =====================================================
// 1. GET MY HEALTH PROFILE
// =====================================================
// GET /api/health-profile

router.get(
  "/",
  authenticateToken,
  allowRoles("patient"),
  async (req, res) => {
    try {
      const patientResult = await pool.query(
        `
        SELECT
          id,
          full_name,
          patient_ref_code
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
          php.patient_id,
          p.full_name AS patient_name,
          p.patient_ref_code,
          p.gender,
          p.blood_group,
          php.existing_conditions,
          php.allergies,
          php.chronic_conditions,
          php.is_high_risk,
          php.risk_categories,
          php.current_risk_status,
          php.notes,
          php.updated_at
        FROM patient_health_profile php
        JOIN patients p
          ON p.id = php.patient_id
        WHERE php.patient_id = $1
        `,
        [patientId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Health profile not found"
        });
      }

      return res.status(200).json({
        status: "success",
        data: result.rows[0]
      });

    } catch (error) {
      console.error(
        "Get health profile error:",
        error.message
      );

      return res.status(500).json({
        status: "error",
        message: "Failed to fetch health profile"
      });
    }
  }
);


// =====================================================
// 2. CREATE OR UPDATE MY HEALTH PROFILE
// =====================================================
// PUT /api/health-profile

router.put(
  "/",
  authenticateToken,
  allowRoles("patient"),
  async (req, res) => {
    try {
      const {
        existing_conditions,
        allergies,
        chronic_conditions,
        is_high_risk,
        risk_categories,
        current_risk_status,
        notes
      } = req.body;

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


      const allowedRiskCategories = [
        "maternal",
        "child",
        "chronic",
        "elderly",
        "other"
      ];

      if (risk_categories) {
        if (!Array.isArray(risk_categories)) {
          return res.status(400).json({
            status: "error",
            message: "risk_categories must be an array"
          });
        }

        const invalidCategories = risk_categories.filter(
          category => !allowedRiskCategories.includes(category)
        );

        if (invalidCategories.length > 0) {
          return res.status(400).json({
            status: "error",
            message: "Invalid risk category found",
            invalid_categories: invalidCategories
          });
        }
      }


      const allowedPriorityLevels = [
        "low",
        "normal",
        "high",
        "critical"
      ];

      if (
        current_risk_status &&
        !allowedPriorityLevels.includes(current_risk_status)
      ) {
        return res.status(400).json({
          status: "error",
          message: "Invalid current_risk_status"
        });
      }


      const result = await pool.query(
        `
        INSERT INTO patient_health_profile (
          patient_id,
          existing_conditions,
          allergies,
          chronic_conditions,
          is_high_risk,
          risk_categories,
          current_risk_status,
          notes,
          updated_at
        )
        VALUES (
          $1,
          $2::jsonb,
          $3::jsonb,
          $4::jsonb,
          $5,
          $6::risk_category[],
          $7::priority_level,
          $8,
          NOW()
        )
        ON CONFLICT (patient_id)
        DO UPDATE SET
          existing_conditions = EXCLUDED.existing_conditions,
          allergies = EXCLUDED.allergies,
          chronic_conditions = EXCLUDED.chronic_conditions,
          is_high_risk = EXCLUDED.is_high_risk,
          risk_categories = EXCLUDED.risk_categories,
          current_risk_status = EXCLUDED.current_risk_status,
          notes = EXCLUDED.notes,
          updated_at = NOW()

        RETURNING
          patient_id,
          existing_conditions,
          allergies,
          chronic_conditions,
          is_high_risk,
          risk_categories,
          current_risk_status,
          notes,
          updated_at
        `,
        [
          patientId,
          JSON.stringify(existing_conditions || []),
          JSON.stringify(allergies || []),
          JSON.stringify(chronic_conditions || []),
          is_high_risk || false,
          risk_categories || [],
          current_risk_status || null,
          notes || null
        ]
      );

      return res.status(200).json({
        status: "success",
        message: "Health profile updated successfully",
        data: result.rows[0]
      });

    } catch (error) {
      console.error(
        "Update health profile error:",
        error.message
      );

      return res.status(500).json({
        status: "error",
        message: "Failed to update health profile"
      });
    }
  }
);


// =====================================================
// 3. GET PATIENT HEALTH PROFILE
// =====================================================
// GET /api/health-profile/patient/:patientId

router.get(
  "/patient/:patientId",
  authenticateToken,
  allowRoles(
    "doctor",
    "frontline_worker",
    "facility_staff",
    "district_admin"
  ),
  async (req, res) => {
    try {
      const { patientId } = req.params;

      const result = await pool.query(
        `
        SELECT
          php.patient_id,
          p.full_name AS patient_name,
          p.patient_ref_code,
          p.date_of_birth,
          p.approximate_age,
          p.gender,
          p.phone_number,
          p.village,
          p.district,
          p.state,
          p.blood_group,

          php.existing_conditions,
          php.allergies,
          php.chronic_conditions,
          php.is_high_risk,
          php.risk_categories,
          php.current_risk_status,
          php.notes,
          php.updated_at

        FROM patient_health_profile php

        JOIN patients p
          ON p.id = php.patient_id

        WHERE php.patient_id = $1
          AND p.is_active = true
        `,
        [patientId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Patient health profile not found"
        });
      }

      return res.status(200).json({
        status: "success",
        data: result.rows[0]
      });

    } catch (error) {
      console.error(
        "Get patient health profile error:",
        error.message
      );

      return res.status(500).json({
        status: "error",
        message: "Failed to fetch patient health profile"
      });
    }
  }
);


module.exports = router;