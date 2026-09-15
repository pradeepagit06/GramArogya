const express = require("express");
const router = express.Router();

const pool = require("../db");
const authenticateToken = require("../middleware/authMiddleware");
const allowRoles = require("../middleware/roleMiddleware");

const allowedStatuses = [
  "available",
  "low_stock",
  "out_of_stock",
  "limited",
  "unavailable",
  "temporarily_unavailable"
];


// POST /api/diagnostic-availability/update
// Facility staff / district admin can add or update test availability
router.post(
  "/update",
  authenticateToken,
  allowRoles("facility_staff", "district_admin"),
  async (req, res) => {
    try {
      const {
        facility_id,
        test_name,
        status,
        unavailable_reason
      } = req.body;

      if (!facility_id || !test_name || !status) {
        return res.status(400).json({
          status: "error",
          message:
            "facility_id, test_name and status are required"
        });
      }

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          status: "error",
          message: "Invalid diagnostic availability status",
          allowed_statuses: allowedStatuses
        });
      }

      // Check facility
      const facilityCheck = await pool.query(
        `
        SELECT id, name
        FROM facilities
        WHERE id = $1
          AND is_active = true
        `,
        [facility_id]
      );

      if (facilityCheck.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Active facility not found"
        });
      }

      // Insert or update existing test availability
      const result = await pool.query(
        `
        INSERT INTO facility_diagnostic_availability
        (
          facility_id,
          test_name,
          status,
          unavailable_reason,
          updated_by,
          updated_at
        )
        VALUES
        ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (facility_id, test_name)
        DO UPDATE SET
          status = EXCLUDED.status,
          unavailable_reason = EXCLUDED.unavailable_reason,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
        RETURNING
          id,
          facility_id,
          test_name,
          status,
          unavailable_reason,
          updated_by,
          updated_at
        `,
        [
          facility_id,
          test_name,
          status,
          unavailable_reason || null,
          req.user.userId
        ]
      );

      return res.status(200).json({
        status: "success",
        message: "Diagnostic availability updated",
        data: result.rows[0]
      });

    } catch (error) {
      console.error(
        "Diagnostic availability update error:",
        error.message
      );

      return res.status(500).json({
        status: "error",
        message: "Failed to update diagnostic availability"
      });
    }
  }
);


// GET /api/diagnostic-availability/facility/:facilityId
// Get all diagnostic tests available at a facility
router.get(
  "/facility/:facilityId",
  authenticateToken,
  async (req, res) => {
    try {
      const { facilityId } = req.params;

      const result = await pool.query(
        `
        SELECT
          fda.id,
          fda.facility_id,
          f.name AS facility_name,
          fda.test_name,
          fda.status,
          fda.unavailable_reason,
          fda.updated_at
        FROM facility_diagnostic_availability fda
        JOIN facilities f
          ON f.id = fda.facility_id
        WHERE fda.facility_id = $1
        ORDER BY fda.test_name ASC
        `,
        [facilityId]
      );

      return res.status(200).json({
        status: "success",
        count: result.rows.length,
        data: result.rows
      });

    } catch (error) {
      console.error(
        "Facility diagnostic availability error:",
        error.message
      );

      return res.status(500).json({
        status: "error",
        message: "Failed to fetch diagnostic availability"
      });
    }
  }
);


// GET /api/diagnostic-availability/search?test_name=...
// Search which facilities provide a particular test
router.get(
  "/search",
  authenticateToken,
  async (req, res) => {
    try {
      const { test_name } = req.query;

      if (!test_name) {
        return res.status(400).json({
          status: "error",
          message: "test_name query parameter is required"
        });
      }

      const result = await pool.query(
        `
        SELECT
          fda.id,
          fda.facility_id,
          f.name AS facility_name,
          f.type AS facility_type,
          f.district,
          f.state,
          f.village_area,
          f.address,
          f.contact_phone,
          fda.test_name,
          fda.status,
          fda.unavailable_reason,
          fda.updated_at
        FROM facility_diagnostic_availability fda
        JOIN facilities f
          ON f.id = fda.facility_id
        WHERE LOWER(fda.test_name) LIKE LOWER($1)
        ORDER BY
          CASE
            WHEN fda.status = 'available' THEN 1
            WHEN fda.status = 'limited' THEN 2
            WHEN fda.status = 'low_stock' THEN 3
            WHEN fda.status = 'temporarily_unavailable' THEN 4
            WHEN fda.status = 'out_of_stock' THEN 5
            ELSE 6
          END,
          f.name ASC
        `,
        [`%${test_name}%`]
      );

      return res.status(200).json({
        status: "success",
        count: result.rows.length,
        data: result.rows
      });

    } catch (error) {
      console.error(
        "Diagnostic search error:",
        error.message
      );

      return res.status(500).json({
        status: "error",
        message: "Failed to search diagnostic availability"
      });
    }
  }
);


// GET /api/diagnostic-availability/all
// Get all diagnostic availability records
router.get(
  "/all",
  authenticateToken,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT
          fda.id,
          fda.facility_id,
          f.name AS facility_name,
          f.type AS facility_type,
          f.district,
          f.state,
          fda.test_name,
          fda.status,
          fda.unavailable_reason,
          fda.updated_at
        FROM facility_diagnostic_availability fda
        JOIN facilities f
          ON f.id = fda.facility_id
        ORDER BY
          f.name ASC,
          fda.test_name ASC
        `
      );

      return res.status(200).json({
        status: "success",
        count: result.rows.length,
        data: result.rows
      });

    } catch (error) {
      console.error(
        "All diagnostic availability error:",
        error.message
      );

      return res.status(500).json({
        status: "error",
        message: "Failed to fetch diagnostic availability"
      });
    }
  }
);


// GET /api/diagnostic-availability/:availabilityId
// Get one diagnostic availability record
router.get(
  "/:availabilityId",
  authenticateToken,
  async (req, res) => {
    try {
      const { availabilityId } = req.params;

      const result = await pool.query(
        `
        SELECT
          fda.id,
          fda.facility_id,
          f.name AS facility_name,
          f.type AS facility_type,
          f.district,
          f.state,
          f.village_area,
          f.address,
          f.contact_phone,
          fda.test_name,
          fda.status,
          fda.unavailable_reason,
          fda.updated_by,
          fda.updated_at
        FROM facility_diagnostic_availability fda
        JOIN facilities f
          ON f.id = fda.facility_id
        WHERE fda.id = $1
        `,
        [availabilityId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Diagnostic availability record not found"
        });
      }

      return res.status(200).json({
        status: "success",
        data: result.rows[0]
      });

    } catch (error) {
      console.error(
        "Diagnostic availability details error:",
        error.message
      );

      return res.status(500).json({
        status: "error",
        message: "Failed to fetch diagnostic availability"
      });
    }
  }
);


module.exports = router;