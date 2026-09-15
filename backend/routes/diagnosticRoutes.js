const express = require("express");

const pool = require("../db");
const authenticateToken = require("../middleware/authMiddleware");
const allowRoles = require("../middleware/roleMiddleware");

const router = express.Router();


// =====================================================
// HELPER - GET FACILITY FOR LOGGED-IN FACILITY STAFF
// =====================================================

async function getStaffFacility(userId) {
  let facilityResult = await pool.query(
    `
    SELECT f.*
    FROM facilities f
    JOIN patients p
      ON p.registered_at_facility = f.id
    WHERE p.registered_by_user_id = $1
    LIMIT 1
    `,
    [userId]
  );

  if (facilityResult.rows.length === 0) {
    facilityResult = await pool.query(
      `
      SELECT *
      FROM facilities
      WHERE is_active = true
      ORDER BY created_at
      LIMIT 1
      `
    );
  }

  if (facilityResult.rows.length === 0) {
    return null;
  }

  return facilityResult.rows[0];
}


// =====================================================
// PATIENT - REQUEST DIAGNOSTIC TEST
// =====================================================

router.post(
  "/request",
  authenticateToken,
  allowRoles("patient"),
  async (req, res) => {
    try {
      const {
        consultation_id,
        facility_id,
        test_name
      } = req.body;

      if (!test_name) {
        return res.status(400).json({
          status: "error",
          message: "test_name is required"
        });
      }

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

      if (consultation_id) {
        const consultationResult = await pool.query(
          `
          SELECT id, patient_id
          FROM consultations
          WHERE id = $1
          `,
          [consultation_id]
        );

        if (consultationResult.rows.length === 0) {
          return res.status(404).json({
            status: "error",
            message: "Consultation not found"
          });
        }

        if (
          consultationResult.rows[0].patient_id !== patientId
        ) {
          return res.status(403).json({
            status: "error",
            message: "Consultation does not belong to this patient"
          });
        }
      }

      if (facility_id) {
        const facilityResult = await pool.query(
          `
          SELECT id
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
      }

      const result = await pool.query(
        `
        INSERT INTO diagnostic_requests
        (
          patient_id,
          consultation_id,
          requested_by,
          facility_id,
          test_name
        )
        VALUES
        ($1, $2, $3, $4, $5)
        RETURNING
          id,
          patient_id,
          consultation_id,
          requested_by,
          facility_id,
          test_name,
          status,
          requested_at,
          completed_at
        `,
        [
          patientId,
          consultation_id || null,
          req.user.userId,
          facility_id || null,
          test_name
        ]
      );

      res.status(201).json({
        status: "success",
        message: "Diagnostic test requested successfully",
        diagnostic_request: result.rows[0]
      });

    } catch (error) {
      console.error(
        "Diagnostic request error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message: "Failed to create diagnostic request"
      });
    }
  }
);


// =====================================================
// PATIENT - GET MY DIAGNOSTIC REQUESTS
// =====================================================

router.get(
  "/my",
  authenticateToken,
  allowRoles("patient"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT
          dr.id,
          dr.patient_id,
          dr.consultation_id,
          dr.facility_id,
          f.name AS facility_name,
          dr.test_name,
          dr.status,
          dr.requested_at,
          dr.completed_at
        FROM diagnostic_requests dr
        LEFT JOIN facilities f
          ON f.id = dr.facility_id
        INNER JOIN patients p
          ON p.id = dr.patient_id
        WHERE p.user_id = $1
        ORDER BY dr.requested_at DESC
        `,
        [req.user.userId]
      );

      res.json({
        status: "success",
        message: "Diagnostic requests retrieved successfully",
        diagnostic_requests: result.rows
      });

    } catch (error) {
      console.error(
        "Get diagnostic requests error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message: "Failed to retrieve diagnostic requests"
      });
    }
  }
);


// =====================================================
// PATIENT - GET SINGLE DIAGNOSTIC REQUEST + REPORT
// =====================================================

router.get(
  "/:requestId",
  authenticateToken,
  allowRoles("patient"),
  async (req, res) => {
    try {
      const { requestId } = req.params;

      const requestResult = await pool.query(
        `
        SELECT
          dr.id,
          dr.patient_id,
          dr.consultation_id,
          dr.facility_id,
          f.name AS facility_name,
          dr.test_name,
          dr.status,
          dr.requested_at,
          dr.completed_at
        FROM diagnostic_requests dr
        LEFT JOIN facilities f
          ON f.id = dr.facility_id
        INNER JOIN patients p
          ON p.id = dr.patient_id
        WHERE dr.id = $1
          AND p.user_id = $2
        `,
        [
          requestId,
          req.user.userId
        ]
      );

      if (requestResult.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Diagnostic request not found"
        });
      }

      const reportResult = await pool.query(
        `
        SELECT
          id,
          diagnostic_request_id,
          result_summary,
          report_file_url,
          uploaded_by,
          uploaded_at
        FROM diagnostic_reports
        WHERE diagnostic_request_id = $1
        ORDER BY uploaded_at DESC
        `,
        [requestId]
      );

      res.json({
        status: "success",
        message: "Diagnostic request retrieved successfully",
        diagnostic_request: requestResult.rows[0],
        reports: reportResult.rows
      });

    } catch (error) {
      console.error(
        "Get diagnostic request error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message: "Failed to retrieve diagnostic request"
      });
    }
  }
);


// =====================================================
// FACILITY STAFF - GET DIAGNOSTIC REQUESTS
// =====================================================

router.get(
  "/facility/requests",
  authenticateToken,
  allowRoles("facility_staff"),
  async (req, res) => {
    try {
      const facility = await getStaffFacility(req.user.userId);

      if (!facility) {
        return res.status(404).json({
          status: "error",
          message: "Facility not found"
        });
      }

      const result = await pool.query(
        `
        SELECT
          dr.id,
          dr.patient_id,
          p.full_name AS patient_name,
          p.patient_ref_code,
          p.gender,
          p.approximate_age,
          p.phone_number,
          dr.consultation_id,
          dr.test_name,
          dr.status,
          dr.requested_at,
          dr.completed_at,
          dr.facility_id,
          f.name AS facility_name,

          (
            SELECT json_build_object(
              'id', drep.id,
              'result_summary', drep.result_summary,
              'report_file_url', drep.report_file_url,
              'uploaded_by', drep.uploaded_by,
              'uploaded_at', drep.uploaded_at
            )
            FROM diagnostic_reports drep
            WHERE drep.diagnostic_request_id = dr.id
            ORDER BY drep.uploaded_at DESC
            LIMIT 1
          ) AS latest_report

        FROM diagnostic_requests dr

        JOIN patients p
          ON p.id = dr.patient_id

        LEFT JOIN facilities f
          ON f.id = dr.facility_id

        WHERE dr.facility_id = $1

        ORDER BY dr.requested_at DESC
        `,
        [facility.id]
      );

      res.json({
        status: "success",
        message: "Facility diagnostic requests retrieved successfully",
        facility: {
          id: facility.id,
          name: facility.name
        },
        data: result.rows
      });

    } catch (error) {
      console.error(
        "Facility diagnostic requests error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message: "Failed to load diagnostic requests"
      });
    }
  }
);


// =====================================================
// FACILITY STAFF - UPDATE DIAGNOSTIC STATUS
// =====================================================

router.patch(
  "/facility/:requestId/status",
  authenticateToken,
  allowRoles("facility_staff"),
  async (req, res) => {
    try {
      const { requestId } = req.params;
      const { status } = req.body;

      const allowedStatuses = [
        "requested",
        "scheduled",
        "sample_collected",
        "in_progress",
        "completed",
        "cancelled"
      ];

      if (!status) {
        return res.status(400).json({
          status: "error",
          message: "status is required"
        });
      }

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          status: "error",
          message: "Invalid diagnostic status"
        });
      }

      const facility = await getStaffFacility(req.user.userId);

      if (!facility) {
        return res.status(404).json({
          status: "error",
          message: "Facility not found"
        });
      }

      const requestResult = await pool.query(
        `
        SELECT
          id,
          patient_id,
          facility_id,
          test_name,
          status
        FROM diagnostic_requests
        WHERE id = $1
          AND facility_id = $2
        `,
        [
          requestId,
          facility.id
        ]
      );

      if (requestResult.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Diagnostic request not found in your facility"
        });
      }

      const completedAt =
        status === "completed"
          ? "NOW()"
          : "completed_at";

      const result = await pool.query(
        `
        UPDATE diagnostic_requests
        SET
          status = $1,
          completed_at = ${completedAt}
        WHERE id = $2
          AND facility_id = $3
        RETURNING
          id,
          patient_id,
          consultation_id,
          facility_id,
          test_name,
          status,
          requested_at,
          completed_at
        `,
        [
          status,
          requestId,
          facility.id
        ]
      );

      res.json({
        status: "success",
        message: "Diagnostic request status updated successfully",
        data: result.rows[0]
      });

    } catch (error) {
      console.error(
        "Update diagnostic status error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message: "Failed to update diagnostic status"
      });
    }
  }
);


// =====================================================
// FACILITY STAFF - GET DIAGNOSTIC AVAILABILITY
// =====================================================

router.get(
  "/facility/availability",
  authenticateToken,
  allowRoles("facility_staff"),
  async (req, res) => {
    try {
      const facility = await getStaffFacility(req.user.userId);

      if (!facility) {
        return res.status(404).json({
          status: "error",
          message: "Facility not found"
        });
      }

      const result = await pool.query(
        `
        SELECT
          fda.id,
          fda.facility_id,
          fda.test_name,
          fda.status,
          fda.unavailable_reason,
          fda.updated_by,
          fda.updated_at,
          f.name AS facility_name
        FROM facility_diagnostic_availability fda
        JOIN facilities f
          ON f.id = fda.facility_id
        WHERE fda.facility_id = $1
        ORDER BY fda.test_name
        `,
        [facility.id]
      );

      res.json({
        status: "success",
        message: "Diagnostic availability retrieved successfully",
        facility: {
          id: facility.id,
          name: facility.name
        },
        data: result.rows
      });

    } catch (error) {
      console.error(
        "Diagnostic availability error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message: "Failed to load diagnostic availability"
      });
    }
  }
);


// =====================================================
// FACILITY STAFF - UPDATE DIAGNOSTIC AVAILABILITY
// =====================================================

router.patch(
  "/facility/availability/:availabilityId",
  authenticateToken,
  allowRoles("facility_staff"),
  async (req, res) => {
    try {
      const { availabilityId } = req.params;

      const {
        status,
        unavailable_reason
      } = req.body;

      const allowedStatuses = [
        "available",
        "low_stock",
        "out_of_stock",
        "limited",
        "unavailable",
        "temporarily_unavailable"
      ];

      if (!status) {
        return res.status(400).json({
          status: "error",
          message: "status is required"
        });
      }

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          status: "error",
          message: "Invalid availability status"
        });
      }

      const facility = await getStaffFacility(req.user.userId);

      if (!facility) {
        return res.status(404).json({
          status: "error",
          message: "Facility not found"
        });
      }

      const existingResult = await pool.query(
        `
        SELECT
          id,
          facility_id,
          test_name
        FROM facility_diagnostic_availability
        WHERE id = $1
          AND facility_id = $2
        `,
        [
          availabilityId,
          facility.id
        ]
      );

      if (existingResult.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Diagnostic availability record not found"
        });
      }

      const result = await pool.query(
        `
        UPDATE facility_diagnostic_availability
        SET
          status = $1,
          unavailable_reason = $2,
          updated_by = $3,
          updated_at = NOW()
        WHERE id = $4
          AND facility_id = $5
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
          status,
          unavailable_reason || null,
          req.user.userId,
          availabilityId,
          facility.id
        ]
      );

      res.json({
        status: "success",
        message: "Diagnostic availability updated successfully",
        data: result.rows[0]
      });

    } catch (error) {
      console.error(
        "Update diagnostic availability error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message: "Failed to update diagnostic availability"
      });
    }
  }
);


// =====================================================
// FACILITY STAFF / DOCTOR - UPLOAD DIAGNOSTIC REPORT
// =====================================================

router.post(
  "/:requestId/report",
  authenticateToken,
  allowRoles("doctor", "facility_staff"),
  async (req, res) => {
    try {
      const { requestId } = req.params;

      const {
        result_summary,
        report_file_url
      } = req.body;

      const requestResult = await pool.query(
        `
        SELECT
          id,
          patient_id,
          facility_id,
          status
        FROM diagnostic_requests
        WHERE id = $1
        `,
        [requestId]
      );

      if (requestResult.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Diagnostic request not found"
        });
      }

      if (!result_summary && !report_file_url) {
        return res.status(400).json({
          status: "error",
          message: "result_summary or report_file_url is required"
        });
      }

      // Facility staff can upload only for their own facility
      if (req.user.role === "facility_staff") {
        const facility = await getStaffFacility(req.user.userId);

        if (!facility) {
          return res.status(404).json({
            status: "error",
            message: "Facility not found"
          });
        }

        if (
          requestResult.rows[0].facility_id !== facility.id
        ) {
          return res.status(403).json({
            status: "error",
            message: "This diagnostic request does not belong to your facility"
          });
        }
      }

      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        const reportResult = await client.query(
          `
          INSERT INTO diagnostic_reports
          (
            diagnostic_request_id,
            result_summary,
            report_file_url,
            uploaded_by
          )
          VALUES
          ($1, $2, $3, $4)
          RETURNING
            id,
            diagnostic_request_id,
            result_summary,
            report_file_url,
            uploaded_by,
            uploaded_at
          `,
          [
            requestId,
            result_summary || null,
            report_file_url || null,
            req.user.userId
          ]
        );

        await client.query(
          `
          UPDATE diagnostic_requests
          SET
            status = 'completed',
            completed_at = NOW()
          WHERE id = $1
          `,
          [requestId]
        );

        await client.query("COMMIT");

        res.status(201).json({
          status: "success",
          message: "Diagnostic report uploaded successfully",
          report: reportResult.rows[0]
        });

      } catch (error) {
        await client.query("ROLLBACK");
        throw error;

      } finally {
        client.release();
      }

    } catch (error) {
      console.error(
        "Upload diagnostic report error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message: "Failed to upload diagnostic report"
      });
    }
  }
);


module.exports = router;