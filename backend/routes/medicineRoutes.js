const express = require("express");

const pool = require("../db");
const authenticateToken = require("../middleware/authMiddleware");
const allowRoles = require("../middleware/roleMiddleware");

const router = express.Router();


// =====================================================
// 1. UPDATE MEDICINE AVAILABILITY
// =====================================================
// Allowed roles:
// - facility_staff
// - district_admin
//
// POST /api/medicines/update
//
// Body:
// {
//   "facility_id": "facility-uuid",
//   "medicine_name": "Paracetamol 500mg",
//   "status": "available"
// }

router.post(
  "/update",
  authenticateToken,
  allowRoles("facility_staff", "district_admin"),
  async (req, res) => {
    try {
      const {
        facility_id,
        medicine_name,
        status
      } = req.body;

      if (!facility_id || !medicine_name || !status) {
        return res.status(400).json({
          status: "error",
          message: "facility_id, medicine_name and status are required"
        });
      }

      const allowedStatuses = [
        "available",
        "limited",
        "out_of_stock"
      ];

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          status: "error",
          message:
            "Invalid status. Use available, limited or out_of_stock"
        });
      }

      // Check facility exists
      const facilityResult = await pool.query(
        `
        SELECT id, name
        FROM facilities
        WHERE id = $1
          AND is_active = true
        `,
        [facility_id]
      );

      if (facilityResult.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Facility not found"
        });
      }

      // Insert or update medicine availability
      const result = await pool.query(
        `
        INSERT INTO facility_medicine_availability
        (
          facility_id,
          medicine_name,
          status,
          updated_by,
          updated_at
        )
        VALUES
        ($1, $2, $3, $4, NOW())

        ON CONFLICT (facility_id, medicine_name)
        DO UPDATE SET
          status = EXCLUDED.status,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()

        RETURNING
          id,
          facility_id,
          medicine_name,
          status,
          updated_by,
          updated_at
        `,
        [
          facility_id,
          medicine_name.trim(),
          status,
          req.user.id
        ]
      );

      return res.status(200).json({
        status: "success",
        message: "Medicine availability updated successfully",
        data: result.rows[0]
      });

    } catch (error) {
      console.error(
        "Medicine availability update error:",
        error.message
      );

      return res.status(500).json({
        status: "error",
        message: "Failed to update medicine availability"
      });
    }
  }
);


// =====================================================
// 2. GET ALL MEDICINES IN A FACILITY
// =====================================================
// GET /api/medicines/facility/:facilityId

router.get(
  "/facility/:facilityId",
  authenticateToken,
  async (req, res) => {
    try {
      const { facilityId } = req.params;

      const facilityResult = await pool.query(
        `
        SELECT id, name
        FROM facilities
        WHERE id = $1
          AND is_active = true
        `,
        [facilityId]
      );

      if (facilityResult.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Facility not found"
        });
      }

      const result = await pool.query(
        `
        SELECT
          fma.id,
          fma.facility_id,
          fma.medicine_name,
          fma.status,
          fma.updated_by,
          fma.updated_at,
          f.name AS facility_name
        FROM facility_medicine_availability fma
        JOIN facilities f
          ON f.id = fma.facility_id
        WHERE fma.facility_id = $1
        ORDER BY fma.medicine_name ASC
        `,
        [facilityId]
      );

      return res.status(200).json({
        status: "success",
        count: result.rows.length,
        facility: facilityResult.rows[0],
        data: result.rows
      });

    } catch (error) {
      console.error(
        "Get facility medicines error:",
        error.message
      );

      return res.status(500).json({
        status: "error",
        message: "Failed to fetch medicine availability"
      });
    }
  }
);


// =====================================================
// 3. SEARCH MEDICINE
// =====================================================
// GET /api/medicines/search?medicine_name=Paracetamol

router.get(
  "/search",
  authenticateToken,
  async (req, res) => {
    try {
      const { medicine_name } = req.query;

      if (!medicine_name) {
        return res.status(400).json({
          status: "error",
          message: "medicine_name query parameter is required"
        });
      }

      const result = await pool.query(
        `
        SELECT
          fma.id,
          fma.facility_id,
          fma.medicine_name,
          fma.status,
          fma.updated_at,
          f.name AS facility_name,
          f.district,
          f.state,
          f.village_area,
          f.address,
          f.contact_phone
        FROM facility_medicine_availability fma
        JOIN facilities f
          ON f.id = fma.facility_id
        WHERE
          fma.medicine_name ILIKE $1
          AND f.is_active = true
        ORDER BY
          CASE
            WHEN fma.status = 'available' THEN 1
            WHEN fma.status = 'limited' THEN 2
            WHEN fma.status = 'out_of_stock' THEN 3
            ELSE 4
          END,
          f.name ASC
        `,
        [`%${medicine_name}%`]
      );

      return res.status(200).json({
        status: "success",
        count: result.rows.length,
        data: result.rows
      });

    } catch (error) {
      console.error(
        "Medicine search error:",
        error.message
      );

      return res.status(500).json({
        status: "error",
        message: "Failed to search medicine"
      });
    }
  }
);


// =====================================================
// 4. GET ALL MEDICINE AVAILABILITY
// =====================================================
// GET /api/medicines/all

router.get(
  "/all",
  authenticateToken,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT
          fma.id,
          fma.facility_id,
          fma.medicine_name,
          fma.status,
          fma.updated_by,
          fma.updated_at,
          f.name AS facility_name,
          f.district,
          f.state,
          f.village_area
        FROM facility_medicine_availability fma
        JOIN facilities f
          ON f.id = fma.facility_id
        WHERE f.is_active = true
        ORDER BY
          f.name ASC,
          fma.medicine_name ASC
        `
      );

      return res.status(200).json({
        status: "success",
        count: result.rows.length,
        data: result.rows
      });

    } catch (error) {
      console.error(
        "Get all medicines error:",
        error.message
      );

      return res.status(500).json({
        status: "error",
        message: "Failed to fetch medicine availability"
      });
    }
  }
);


// =====================================================
// EXPORT ROUTER
// =====================================================

module.exports = router;
      
