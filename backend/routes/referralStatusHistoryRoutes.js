const express = require("express");
const pool = require("../db");
const authenticateToken = require("../middleware/authMiddleware");
const allowRoles = require("../middleware/roleMiddleware");

const router = express.Router();

const allowedStatuses = [
  "created",
  "sent",
  "received",
  "accepted",
  "scheduled",
  "patient_arrived",
  "completed",
  "cancelled"
];

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
        referral_id,
        status,
        remarks
      } = req.body;

      if (!referral_id || !status) {
        return res.status(400).json({
          status: "error",
          message: "referral_id and status are required"
        });
      }

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          status: "error",
          message: "Invalid referral status"
        });
      }

      const referralResult = await pool.query(
        `SELECT id
         FROM referrals
         WHERE id = $1`,
        [referral_id]
      );

      if (referralResult.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Referral not found"
        });
      }

      const result = await pool.query(
        `INSERT INTO referral_status_history
        (
          referral_id,
          status,
          changed_by,
          remarks
        )
        VALUES ($1, $2, $3, $4)
        RETURNING *`,
        [
          referral_id,
          status,
          req.user.userId,
          remarks || null
        ]
      );

      await pool.query(
        `UPDATE referrals
         SET status = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [
          status,
          referral_id
        ]
      );

      res.status(201).json({
        status: "success",
        message: "Referral status updated successfully",
        data: result.rows[0]
      });

    } catch (error) {
      console.error(
        "Create referral status history error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message: "Failed to update referral status"
      });
    }
  }
);

router.get(
  "/referral/:referralId",
  authenticateToken,
  async (req, res) => {
    try {
      const { referralId } = req.params;

      const result = await pool.query(
        `SELECT
           h.*,
           u.full_name AS changed_by_name,
           u.role AS changed_by_role
         FROM referral_status_history h
         LEFT JOIN users u
           ON h.changed_by = u.id
         WHERE h.referral_id = $1
         ORDER BY h.changed_at ASC`,
        [referralId]
      );

      res.json({
        status: "success",
        count: result.rows.length,
        data: result.rows
      });

    } catch (error) {
      console.error(
        "Get referral status history error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message: "Failed to fetch referral status history"
      });
    }
  }
);

router.get(
  "/:historyId",
  authenticateToken,
  async (req, res) => {
    try {
      const { historyId } = req.params;

      const result = await pool.query(
        `SELECT
           h.*,
           u.full_name AS changed_by_name,
           u.role AS changed_by_role
         FROM referral_status_history h
         LEFT JOIN users u
           ON h.changed_by = u.id
         WHERE h.id = $1`,
        [historyId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Referral status history record not found"
        });
      }

      res.json({
        status: "success",
        data: result.rows[0]
      });

    } catch (error) {
      console.error(
        "Get referral status history details error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message: "Failed to fetch status history"
      });
    }
  }
);

module.exports = router;