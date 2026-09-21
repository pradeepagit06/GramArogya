const express = require("express");
const pool = require("../db");
const authenticateToken = require("../middleware/authMiddleware");
const allowRoles = require("../middleware/roleMiddleware");

const router = express.Router();

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
        action,
        entity_type,
        entity_id,
        details
      } = req.body;

      if (!action || !entity_type) {
        return res.status(400).json({
          status: "error",
          message: "action and entity_type are required"
        });
      }

      const result = await pool.query(
        `INSERT INTO audit_logs
        (
          user_id,
          action,
          entity_type,
          entity_id,
          ip_address,
          details
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *`,
        [
          req.user.userId,
          action,
          entity_type,
          entity_id || null,
          req.ip || null,
          details || {}
        ]
      );

      res.status(201).json({
        status: "success",
        message: "Audit log created successfully",
        data: result.rows[0]
      });

    } catch (error) {
      console.error(
        "Create audit log error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message: "Failed to create audit log"
      });
    }
  }
);

router.get(
  "/my",
  authenticateToken,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT *
         FROM audit_logs
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [req.user.userId]
      );

      res.json({
        status: "success",
        count: result.rows.length,
        data: result.rows
      });

    } catch (error) {
      console.error(
        "Get my audit logs error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message: "Failed to fetch audit logs"
      });
    }
  }
);

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
        `SELECT
           a.*,
           u.full_name AS user_name,
           u.role AS user_role
         FROM audit_logs a
         LEFT JOIN users u
           ON a.user_id = u.id
         ORDER BY a.created_at DESC`
      );

      res.json({
        status: "success",
        count: result.rows.length,
        data: result.rows
      });

    } catch (error) {
      console.error(
        "Get all audit logs error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message: "Failed to fetch all audit logs"
      });
    }
  }
);

router.get(
  "/:auditId",
  authenticateToken,
  async (req, res) => {
    try {
      const { auditId } = req.params;

      const result = await pool.query(
        `SELECT
           a.*,
           u.full_name AS user_name,
           u.role AS user_role
         FROM audit_logs a
         LEFT JOIN users u
           ON a.user_id = u.id
         WHERE a.id = $1`,
        [auditId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Audit log not found"
        });
      }

      res.json({
        status: "success",
        data: result.rows[0]
      });

    } catch (error) {
      console.error(
        "Get audit log error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message: "Failed to fetch audit log"
      });
    }
  }
);

module.exports = router;