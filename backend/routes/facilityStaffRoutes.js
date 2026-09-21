
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

  // Fallback to first active facility
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
// FACILITY STAFF DASHBOARD
// =====================================================

router.get(
  "/dashboard",
  authenticateToken,
  allowRoles("facility_staff"),
  async (req, res) => {
    try {
      const userId = req.user.userId;

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

      // Fallback facility
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
        return res.status(404).json({
          status: "error",
          message: "Facility not found"
        });
      }

      const facility = facilityResult.rows[0];


      // -------------------------------------------------
      // UPCOMING APPOINTMENTS
      // -------------------------------------------------

      const upcomingResult = await pool.query(
        `
        SELECT
          a.id,
          a.scheduled_date,
          a.scheduled_time,
          a.status,
          a.priority,
          a.department,
          p.full_name AS patient_name,
          p.patient_ref_code,
          u.full_name AS doctor_name
        FROM appointments a
        JOIN patients p
          ON p.id = a.patient_id
        LEFT JOIN users u
          ON u.id = a.doctor_id
        WHERE a.facility_id = $1
          AND a.scheduled_date >= CURRENT_DATE
          AND a.status IN (
            'booked',
            'confirmed',
            'arrived'
          )
        ORDER BY
          a.scheduled_date,
          a.scheduled_time
        `,
        [facility.id]
      );


      // -------------------------------------------------
      // TODAY'S WAITING QUEUE
      // -------------------------------------------------

      const waitingQueueResult = await pool.query(
        `
        SELECT
          a.id,
          a.queue_number,
          a.scheduled_date,
          a.scheduled_time,
          a.status,
          a.priority,
          p.full_name AS patient_name,
          p.patient_ref_code,
          u.full_name AS doctor_name
        FROM appointments a
        JOIN patients p
          ON p.id = a.patient_id
        LEFT JOIN users u
          ON u.id = a.doctor_id
        WHERE a.facility_id = $1
          AND a.scheduled_date = CURRENT_DATE
          AND (
            a.status = 'in_queue'
            OR a.checked_in_at IS NOT NULL
          )
        ORDER BY
          a.queue_number NULLS LAST,
          a.scheduled_time
        `,
        [facility.id]
      );


      // -------------------------------------------------
      // ACTIVE CONSULTATIONS
      // -------------------------------------------------

      const activeConsultationsResult = await pool.query(
        `
        SELECT
          c.id,
          c.mode,
          c.status,
          c.symptoms,
          c.vitals,
          c.started_at,
          p.full_name AS patient_name,
          p.patient_ref_code,
          u.full_name AS doctor_name
        FROM consultations c
        JOIN patients p
          ON p.id = c.patient_id
        LEFT JOIN users u
          ON u.id = c.doctor_id
        WHERE c.facility_id = $1
          AND c.status = 'in_progress'
        ORDER BY
          c.started_at DESC NULLS LAST
        `,
        [facility.id]
      );


      // -------------------------------------------------
      // COMPLETED CONSULTATIONS
      // -------------------------------------------------

      const completedConsultationsResult = await pool.query(
        `
        SELECT
          c.id,
          c.mode,
          c.status,
          c.symptoms,
          c.vitals,
          c.started_at,
          c.completed_at,
          p.full_name AS patient_name,
          p.patient_ref_code,
          u.full_name AS doctor_name
        FROM consultations c
        JOIN patients p
          ON p.id = c.patient_id
        LEFT JOIN users u
          ON u.id = c.doctor_id
        WHERE c.facility_id = $1
          AND c.status = 'completed'
        ORDER BY
          c.completed_at DESC NULLS LAST
        `,
        [facility.id]
      );


      // -------------------------------------------------
      // RESPONSE
      // -------------------------------------------------

      res.json({
        status: "success",

        data: {
          facility,

          statistics: {
            upcomingAppointments:
              upcomingResult.rows.length,

            waitingQueue:
              waitingQueueResult.rows.length,

            activeConsultations:
              activeConsultationsResult.rows.length,

            completedConsultations:
              completedConsultationsResult.rows.length
          },

          upcomingAppointments:
            upcomingResult.rows,

          waitingQueue:
            waitingQueueResult.rows,

          activeConsultations:
            activeConsultationsResult.rows,

          completedConsultations:
            completedConsultationsResult.rows
        }
      });

    } catch (error) {
      console.error(
        "Facility staff dashboard error:",
        error
      );

      res.status(500).json({
        status: "error",
        message: "Failed to load facility staff dashboard"
      });
    }
  }
);


// =====================================================
// CONFIRM APPOINTMENT
// =====================================================

router.patch(
  "/appointments/:appointmentId/confirm",
  authenticateToken,
  allowRoles("facility_staff"),
  async (req, res) => {
    try {
      const { appointmentId } = req.params;

      const result = await pool.query(
        `
        UPDATE appointments
        SET
          status = 'confirmed',
          updated_at = NOW()
        WHERE id = $1
          AND status = 'booked'
        RETURNING *
        `,
        [appointmentId]
      );

      if (result.rows.length === 0) {
        return res.status(400).json({
          status: "error",
          message: "Appointment cannot be confirmed"
        });
      }

      res.json({
        status: "success",
        message: "Appointment confirmed successfully",
        data: result.rows[0]
      });

    } catch (error) {
      console.error(
        "Confirm appointment error:",
        error
      );

      res.status(500).json({
        status: "error",
        message: "Failed to confirm appointment"
      });
    }
  }
);


// =====================================================
// MARK APPOINTMENT AS ARRIVED
// =====================================================

router.patch(
  "/appointments/:appointmentId/arrived",
  authenticateToken,
  allowRoles("facility_staff"),
  async (req, res) => {
    try {
      const { appointmentId } = req.params;

      const result = await pool.query(
        `
        UPDATE appointments
        SET
          status = 'arrived',
          updated_at = NOW()
        WHERE id = $1
          AND status = 'confirmed'
        RETURNING *
        `,
        [appointmentId]
      );

      if (result.rows.length === 0) {
        return res.status(400).json({
          status: "error",
          message: "Appointment cannot be marked as arrived"
        });
      }

      res.json({
        status: "success",
        message: "Patient marked as arrived",
        data: result.rows[0]
      });

    } catch (error) {
      console.error(
        "Arrived appointment error:",
        error
      );

      res.status(500).json({
        status: "error",
        message: "Failed to update appointment"
      });
    }
  }
);


// =====================================================
// CHECK-IN APPOINTMENT
// =====================================================

router.patch(
  "/appointments/:appointmentId/check-in",
  authenticateToken,
  allowRoles("facility_staff"),
  async (req, res) => {

    const client = await pool.connect();

    try {
      const { appointmentId } = req.params;

      await client.query("BEGIN");


      // Get appointment
      const appointmentResult = await client.query(
        `
        SELECT
          a.*
        FROM appointments a
        WHERE a.id = $1
        FOR UPDATE
        `,
        [appointmentId]
      );

      if (appointmentResult.rows.length === 0) {

        await client.query("ROLLBACK");

        return res.status(404).json({
          status: "error",
          message: "Appointment not found"
        });
      }

      const appointment =
        appointmentResult.rows[0];


      // Validate status
      if (
        ![
          "booked",
          "confirmed",
          "arrived"
        ].includes(appointment.status)
      ) {

        await client.query("ROLLBACK");

        return res.status(400).json({
          status: "error",
          message:
            "Appointment cannot be checked in from its current status"
        });
      }


      // Generate next queue number
      const queueResult = await client.query(
        `
        SELECT
          COALESCE(MAX(queue_number), 0) + 1 AS next_queue
        FROM appointments
        WHERE facility_id = $1
          AND scheduled_date = $2
          AND queue_number IS NOT NULL
        `,
        [
          appointment.facility_id,
          appointment.scheduled_date
        ]
      );

      const nextQueueNumber =
        queueResult.rows[0].next_queue;


      // Update appointment
      const updateResult = await client.query(
        `
        UPDATE appointments
        SET
          status = 'in_queue',
          queue_number = $1,
          checked_in_at = NOW(),
          updated_at = NOW()
        WHERE id = $2
        RETURNING *
        `,
        [
          nextQueueNumber,
          appointmentId
        ]
      );


      await client.query("COMMIT");


      res.json({
        status: "success",
        message:
          "Patient checked in successfully",
        data: updateResult.rows[0]
      });

    } catch (error) {

      await client.query("ROLLBACK");

      console.error(
        "Check-in error:",
        error
      );

      res.status(500).json({
        status: "error",
        message:
          "Failed to check in patient"
      });

    } finally {

      client.release();

    }
  }
);


// =====================================================
// PATIENT SEARCH
// =====================================================

router.get(
  "/patients/search",
  authenticateToken,
  allowRoles("facility_staff"),
  async (req, res) => {

    try {

      // Support both ?q= and ?search=
      const search =
        req.query.q ||
        req.query.search ||
        "";

      if (!search.trim()) {

        return res.status(400).json({
          status: "error",
          message:
            "Search query is required"
        });
      }

      const searchTerm =
        `%${search.trim()}%`;


      const result = await pool.query(
        `
        SELECT
          p.id,
          p.patient_ref_code,
          p.full_name,
          p.date_of_birth,
          p.gender,
          p.approximate_age,
          p.phone_number,
          p.village,
          p.district,
          p.state,
          p.address,
          p.blood_group,
          p.preferred_language,
          p.is_active
        FROM patients p
        WHERE
          p.is_active = true
          AND (
            p.full_name ILIKE $1
            OR p.phone_number ILIKE $1
            OR p.patient_ref_code ILIKE $1
          )
        ORDER BY
          p.full_name
        LIMIT 20
        `,
        [searchTerm]
      );


      return res.json({
        status: "success",
        count: result.rows.length,
        data: result.rows
      });

    } catch (error) {

      console.error(
        "Patient search error:",
        error
      );

      return res.status(500).json({
        status: "error",
        message:
          "Failed to search patients"
      });
    }
  }
);


// =====================================================
// FACILITY STAFF PROFILE
// =====================================================

router.get(
  "/profile",
  authenticateToken,
  allowRoles("facility_staff"),
  async (req, res) => {

    try {

      const userId =
        req.user.userId;


      const result = await pool.query(
        `
        SELECT
          id,
          full_name,
          email,
          phone_number,
          role,
          preferred_language,
          is_active,
          created_at
        FROM users
        WHERE id = $1
        `,
        [userId]
      );


      if (result.rows.length === 0) {

        return res.status(404).json({
          status: "error",
          message:
            "Staff profile not found"
        });
      }


      res.json({
        status: "success",
        data: result.rows[0]
      });

    } catch (error) {

      console.error(
        "Facility staff profile error:",
        error
      );

      res.status(500).json({
        status: "error",
        message:
          "Failed to load staff profile"
      });
    }
  }
);


// =====================================================
// DIAGNOSTIC MANAGEMENT
// =====================================================


// -----------------------------------------------------
// GET FACILITY DIAGNOSTIC REQUESTS
// -----------------------------------------------------

router.get(
  "/facility/requests",
  authenticateToken,
  allowRoles("facility_staff"),
  async (req, res) => {

    try {

      const facility =
        await getStaffFacility(
          req.user.userId
        );


      if (!facility) {

        return res.status(404).json({
          status: "error",
          message:
            "Facility not found"
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
              'result_summary',
                drep.result_summary,
              'report_file_url',
                drep.report_file_url,
              'uploaded_by',
                drep.uploaded_by,
              'uploaded_at',
                drep.uploaded_at
            )
            FROM diagnostic_reports drep
            WHERE
              drep.diagnostic_request_id =
                dr.id
            ORDER BY
              drep.uploaded_at DESC
            LIMIT 1
          ) AS latest_report

        FROM diagnostic_requests dr

        JOIN patients p
          ON p.id = dr.patient_id

        LEFT JOIN facilities f
          ON f.id = dr.facility_id

        WHERE dr.facility_id = $1

        ORDER BY
          dr.requested_at DESC
        `,
        [facility.id]
      );


      res.json({
        status: "success",
        message:
          "Facility diagnostic requests retrieved successfully",

        facility: {
          id: facility.id,
          name: facility.name
        },

        data: result.rows
      });

    } catch (error) {

      console.error(
        "Facility diagnostic requests error:",
        error
      );

      res.status(500).json({
        status: "error",
        message:
          "Failed to load diagnostic requests"
      });
    }
  }
);


// -----------------------------------------------------
// UPDATE DIAGNOSTIC REQUEST STATUS
// -----------------------------------------------------

router.patch(
  "/facility/:requestId/status",
  authenticateToken,
  allowRoles("facility_staff"),
  async (req, res) => {

    try {

      const { requestId } =
        req.params;

      const { status } =
        req.body;


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
          message:
            "status is required"
        });
      }


      if (
        !allowedStatuses.includes(status)
      ) {

        return res.status(400).json({
          status: "error",
          message:
            "Invalid diagnostic status"
        });
      }


      const facility =
        await getStaffFacility(
          req.user.userId
        );


      if (!facility) {

        return res.status(404).json({
          status: "error",
          message:
            "Facility not found"
        });
      }


      const requestResult =
        await pool.query(
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


      if (
        requestResult.rows.length === 0
      ) {

        return res.status(404).json({
          status: "error",
          message:
            "Diagnostic request not found in your facility"
        });
      }


      const result =
        await pool.query(
          `
          UPDATE diagnostic_requests
          SET
            status = $1,
            completed_at =
              CASE
                WHEN $1 = 'completed'
                THEN NOW()
                ELSE completed_at
              END
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
        message:
          "Diagnostic request status updated successfully",
        data: result.rows[0]
      });

    } catch (error) {

      console.error(
        "Update diagnostic status error:",
        error
      );

      res.status(500).json({
        status: "error",
        message:
          "Failed to update diagnostic status"
      });
    }
  }
);


// -----------------------------------------------------
// GET FACILITY DIAGNOSTIC AVAILABILITY
// -----------------------------------------------------

router.get(
  "/facility/availability",
  authenticateToken,
  allowRoles("facility_staff"),
  async (req, res) => {

    try {

      const facility =
        await getStaffFacility(
          req.user.userId
        );


      if (!facility) {

        return res.status(404).json({
          status: "error",
          message:
            "Facility not found"
        });
      }


      const result =
        await pool.query(
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

          WHERE
            fda.facility_id = $1

          ORDER BY
            fda.test_name
          `,
          [facility.id]
        );


      res.json({
        status: "success",
        message:
          "Diagnostic availability retrieved successfully",

        facility: {
          id: facility.id,
          name: facility.name
        },

        data: result.rows
      });

    } catch (error) {

      console.error(
        "Diagnostic availability error:",
        error
      );

      res.status(500).json({
        status: "error",
        message:
          "Failed to load diagnostic availability"
      });
    }
  }
);


// -----------------------------------------------------
// UPDATE DIAGNOSTIC AVAILABILITY
// -----------------------------------------------------

router.patch(
  "/facility/availability/:availabilityId",
  authenticateToken,
  allowRoles("facility_staff"),
  async (req, res) => {

    try {

      const {
        availabilityId
      } = req.params;

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
          message:
            "status is required"
        });
      }


      if (
        !allowedStatuses.includes(status)
      ) {

        return res.status(400).json({
          status: "error",
          message:
            "Invalid availability status"
        });
      }


      const facility =
        await getStaffFacility(
          req.user.userId
        );


      if (!facility) {

        return res.status(404).json({
          status: "error",
          message:
            "Facility not found"
        });
      }


      const existingResult =
        await pool.query(
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


      if (
        existingResult.rows.length === 0
      ) {

        return res.status(404).json({
          status: "error",
          message:
            "Diagnostic availability record not found"
        });
      }


      const result =
        await pool.query(
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
        message:
          "Diagnostic availability updated successfully",
        data: result.rows[0]
      });

    } catch (error) {

      console.error(
        "Update diagnostic availability error:",
        error
      );

      res.status(500).json({
        status: "error",
        message:
          "Failed to update diagnostic availability"
      });
    }
  }
);


module.exports = router;


