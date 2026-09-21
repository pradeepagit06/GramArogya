const express = require("express");
const pool = require("../db");

const authenticateToken = require("../middleware/authMiddleware");
const allowRoles = require("../middleware/roleMiddleware");

const router = express.Router();

/*
  CREATE REFERRAL
  Allowed: doctor, facility_staff
*/
router.post(
  "/create",
  authenticateToken,
  allowRoles("doctor", "facility_staff"),
  async (req, res) => {
    try {
      const {
        patient_id,
        consultation_id,
        receiving_facility_id,
        required_department,
        reason,
        priority,
        notes
      } = req.body;

      if (!patient_id || !reason) {
        return res.status(400).json({
          status: "error",
          message: "patient_id and reason are required"
        });
      }

      const validPriorities = [
        "low",
        "normal",
        "high",
        "urgent"
      ];

      const selectedPriority = priority || "normal";

      if (!validPriorities.includes(selectedPriority)) {
        return res.status(400).json({
          status: "error",
          message: "Invalid priority"
        });
      }

      const patientResult = await pool.query(
        `
        SELECT id, patient_ref_code
        FROM patients
        WHERE id = $1
        `,
        [patient_id]
      );

      if (patientResult.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Patient not found"
        });
      }

      let referringFacilityId = null;

      if (req.user.role === "facility_staff") {
        const staffFacilityResult = await pool.query(
          `
          SELECT f.id
          FROM facilities f
          JOIN patients p
            ON p.registered_at_facility = f.id
          WHERE p.registered_by_user_id = $1
          LIMIT 1
          `,
          [req.user.userId]
        );

        if (staffFacilityResult.rows.length > 0) {
          referringFacilityId = staffFacilityResult.rows[0].id;
        } else {
          const fallbackFacility = await pool.query(
            `
            SELECT id
            FROM facilities
            WHERE is_active = true
            ORDER BY created_at
            LIMIT 1
            `
          );

          if (fallbackFacility.rows.length > 0) {
            referringFacilityId = fallbackFacility.rows[0].id;
          }
        }
      }

      let receivingFacilityId = receiving_facility_id || null;

      if (!receivingFacilityId) {
        const facilityResult = await pool.query(
          `
          SELECT id
          FROM facilities
          WHERE is_active = true
          ORDER BY created_at
          LIMIT 1
          `
        );

        if (facilityResult.rows.length > 0) {
          receivingFacilityId = facilityResult.rows[0].id;
        }
      }

      const result = await pool.query(
        `
        INSERT INTO referrals (
          patient_id,
          consultation_id,
          referring_user_id,
          referring_facility_id,
          receiving_facility_id,
          required_department,
          reason,
          priority,
          status,
          notes
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7::priority_level,
          'created'::referral_status,
          $8
        )
        RETURNING *
        `,
        [
          patient_id,
          consultation_id || null,
          req.user.userId,
          referringFacilityId,
          receivingFacilityId,
          required_department || null,
          reason,
          selectedPriority,
          notes || null
        ]
      );

      return res.status(201).json({
        status: "success",
        message: "Referral created successfully",
        data: result.rows[0]
      });

    } catch (error) {
      console.error(
        "Create referral error:",
        error.message
      );

      return res.status(500).json({
        status: "error",
        message: "Failed to create referral"
      });
    }
  }
);


/*
  GET MY REFERRALS
  Patient only
*/
router.get(
  "/my",
  authenticateToken,
  allowRoles("patient"),
  async (req, res) => {
    try {
      const userId = req.user.userId;

      const result = await pool.query(
        `
        SELECT
          r.id,
          r.patient_id,
          p.patient_ref_code,
          r.consultation_id,
          r.required_department,
          r.reason,
          r.priority,
          r.status,
          r.notes,
          r.created_at,
          r.updated_at,
          rf.name AS referring_facility_name,
          rc.name AS receiving_facility_name
        FROM referrals r
        JOIN patients p
          ON p.id = r.patient_id
        LEFT JOIN facilities rf
          ON rf.id = r.referring_facility_id
        LEFT JOIN facilities rc
          ON rc.id = r.receiving_facility_id
        JOIN users u
          ON u.id = p.user_id
        WHERE u.id = $1
        ORDER BY r.created_at DESC
        `,
        [userId]
      );

      return res.json({
        status: "success",
        message: "Patient referrals retrieved successfully",
        data: result.rows
      });

    } catch (error) {
      console.error(
        "Get patient referrals error:",
        error.message
      );

      return res.status(500).json({
        status: "error",
        message: "Failed to retrieve referrals"
      });
    }
  }
);


/*
  GET INCOMING REFERRALS
  Facility Staff
*/
router.get(
  "/facility/incoming",
  authenticateToken,
  allowRoles("facility_staff"),
  async (req, res) => {
    try {
      const facilityResult = await pool.query(
        `
        SELECT
          id,
          name
        FROM facilities
        WHERE is_active = true
        ORDER BY created_at
        LIMIT 1
        `
      );

      if (facilityResult.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "No active facility found"
        });
      }

      const facility = facilityResult.rows[0];

      const result = await pool.query(
        `
        SELECT
          r.id,
          r.patient_id,
          p.patient_ref_code,
          u.full_name AS patient_name,
          p.phone_number,
          r.required_department,
          r.reason,
          r.priority,
          r.status,
          r.notes,
          r.created_at,
          rf.name AS referring_facility_name
        FROM referrals r
        JOIN patients p
          ON p.id = r.patient_id
        LEFT JOIN users u
          ON u.id = p.user_id
        LEFT JOIN facilities rf
          ON rf.id = r.referring_facility_id
        WHERE r.receiving_facility_id = $1
        ORDER BY r.created_at DESC
        `,
        [facility.id]
      );

      return res.json({
        status: "success",
        message: "Incoming referrals retrieved successfully",
        facility,
        data: result.rows
      });

    } catch (error) {
      console.error(
        "Get incoming referrals error:",
        error.message
      );

      return res.status(500).json({
        status: "error",
        message: "Failed to retrieve incoming referrals"
      });
    }
  }
);


/*
  GET SINGLE REFERRAL
*/
router.get(
  "/:referralId",
  authenticateToken,
  async (req, res) => {
    try {
      const { referralId } = req.params;

      const result = await pool.query(
        `
        SELECT
          r.*,
          p.patient_ref_code,
          u.full_name AS patient_name,
          rf.name AS referring_facility_name,
          rc.name AS receiving_facility_name
        FROM referrals r
        JOIN patients p
          ON p.id = r.patient_id
        LEFT JOIN users u
          ON u.id = p.user_id
        LEFT JOIN facilities rf
          ON rf.id = r.referring_facility_id
        LEFT JOIN facilities rc
          ON rc.id = r.receiving_facility_id
        WHERE r.id = $1
        `,
        [referralId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Referral not found"
        });
      }

      return res.json({
        status: "success",
        data: result.rows[0]
      });

    } catch (error) {
      console.error(
        "Get referral error:",
        error.message
      );

      return res.status(500).json({
        status: "error",
        message: "Failed to retrieve referral"
      });
    }
  }
);


/*
  UPDATE REFERRAL STATUS
  Facility Staff
*/
router.patch(
  "/facility/:referralId/status",
  authenticateToken,
  allowRoles("facility_staff"),
  async (req, res) => {
    try {
      const { referralId } = req.params;
      const { status } = req.body;

      const validStatuses = [
        "created",
        "sent",
        "received",
        "accepted",
        "scheduled",
        "patient_arrived",
        "completed",
        "cancelled"
      ];

      if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({
          status: "error",
          message: "Invalid referral status"
        });
      }

      const result = await pool.query(
        `
        UPDATE referrals
        SET
          status = $1::referral_status,
          updated_at = now()
        WHERE id = $2
        RETURNING *
        `,
        [status, referralId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Referral not found"
        });
      }

      return res.json({
        status: "success",
        message: "Referral status updated successfully",
        data: result.rows[0]
      });

    } catch (error) {
      console.error(
        "Update referral status error:",
        error.message
      );

      return res.status(500).json({
        status: "error",
        message: "Failed to update referral status"
      });
    }
  }
);


module.exports = router;

