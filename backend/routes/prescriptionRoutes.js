const express = require("express");

const pool = require("../db");
const authenticateToken = require("../middleware/authMiddleware");
const allowRoles = require("../middleware/roleMiddleware");

const router = express.Router();


// ========================================
// CREATE PRESCRIPTION
// ========================================

router.post(
  "/create",
  authenticateToken,
  allowRoles("doctor"),
  async (req, res) => {
    try {
      const {
        consultation_id,
        patient_id,
        additional_advice,
        medicines
      } = req.body;

      if (!consultation_id || !patient_id) {
        return res.status(400).json({
          status: "error",
          message: "consultation_id and patient_id are required"
        });
      }

      if (!Array.isArray(medicines) || medicines.length === 0) {
        return res.status(400).json({
          status: "error",
          message: "At least one medicine is required"
        });
      }

      // Check consultation
      const consultationResult = await pool.query(
        `SELECT
          id,
          patient_id,
          doctor_id,
          status
         FROM consultations
         WHERE id = $1`,
        [consultation_id]
      );

      if (consultationResult.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Consultation not found"
        });
      }

      const consultation = consultationResult.rows[0];

      // Check patient
      if (consultation.patient_id !== patient_id) {
        return res.status(400).json({
          status: "error",
          message: "Patient does not match consultation"
        });
      }

      // Check doctor
      if (consultation.doctor_id !== req.user.userId) {
        return res.status(403).json({
          status: "error",
          message: "You are not the doctor assigned to this consultation"
        });
      }

      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        // Create prescription
        const prescriptionResult = await client.query(
          `INSERT INTO prescriptions
          (
            consultation_id,
            patient_id,
            doctor_id,
            additional_advice
          )
          VALUES
          ($1, $2, $3, $4)
          RETURNING
            id,
            consultation_id,
            patient_id,
            doctor_id,
            additional_advice,
            created_at`,
          [
            consultation_id,
            patient_id,
            req.user.userId,
            additional_advice || null
          ]
        );

        const prescription = prescriptionResult.rows[0];

        // Add medicines
        const createdMedicines = [];

        for (const medicine of medicines) {
          if (!medicine.medicine_name) {
            throw new Error(
              "medicine_name is required for every medicine"
            );
          }

          const medicineResult = await client.query(
            `INSERT INTO prescription_items
            (
              prescription_id,
              medicine_name,
              dosage,
              frequency,
              duration,
              instructions
            )
            VALUES
            ($1, $2, $3, $4, $5, $6)
            RETURNING
              id,
              prescription_id,
              medicine_name,
              dosage,
              frequency,
              duration,
              instructions`,
            [
              prescription.id,
              medicine.medicine_name,
              medicine.dosage || null,
              medicine.frequency || null,
              medicine.duration || null,
              medicine.instructions || null
            ]
          );

          createdMedicines.push(medicineResult.rows[0]);
        }

        await client.query("COMMIT");

        res.status(201).json({
          status: "success",
          message: "Prescription created successfully",
          prescription: prescription,
          medicines: createdMedicines
        });

      } catch (error) {
        await client.query("ROLLBACK");
        throw error;

      } finally {
        client.release();
      }

    } catch (error) {
      console.error(
        "Create prescription error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message: "Failed to create prescription"
      });
    }
  }
);


// ========================================
// GET MY PRESCRIPTIONS
// ========================================

router.get(
  "/my",
  authenticateToken,
  allowRoles("patient"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
          pr.id,
          pr.consultation_id,
          pr.patient_id,
          pr.doctor_id,
          d.full_name AS doctor_name,
          pr.additional_advice,
          pr.created_at
         FROM prescriptions pr
         LEFT JOIN users d
           ON d.id = pr.doctor_id
         INNER JOIN patients p
           ON p.id = pr.patient_id
         WHERE p.user_id = $1
         ORDER BY pr.created_at DESC`,
        [req.user.userId]
      );

      const prescriptions = [];

      for (const prescription of result.rows) {
        const medicinesResult = await pool.query(
          `SELECT
            id,
            prescription_id,
            medicine_name,
            dosage,
            frequency,
            duration,
            instructions
           FROM prescription_items
           WHERE prescription_id = $1
           ORDER BY medicine_name ASC`,
          [prescription.id]
        );

        prescriptions.push({
          ...prescription,
          medicines: medicinesResult.rows
        });
      }

      res.json({
        status: "success",
        message: "Prescriptions retrieved successfully",
        prescriptions: prescriptions
      });

    } catch (error) {
      console.error(
        "Get prescriptions error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message: "Failed to retrieve prescriptions"
      });
    }
  }
);


// ========================================
// GET SINGLE PRESCRIPTION
// ========================================

router.get(
  "/:prescriptionId",
  authenticateToken,
  allowRoles("patient"),
  async (req, res) => {
    try {
      const { prescriptionId } = req.params;

      const result = await pool.query(
        `SELECT
          pr.id,
          pr.consultation_id,
          pr.patient_id,
          pr.doctor_id,
          d.full_name AS doctor_name,
          pr.additional_advice,
          pr.created_at
         FROM prescriptions pr
         LEFT JOIN users d
           ON d.id = pr.doctor_id
         INNER JOIN patients p
           ON p.id = pr.patient_id
         WHERE pr.id = $1
           AND p.user_id = $2`,
        [
          prescriptionId,
          req.user.userId
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Prescription not found"
        });
      }

      const prescription = result.rows[0];

      const medicinesResult = await pool.query(
        `SELECT
          id,
          prescription_id,
          medicine_name,
          dosage,
          frequency,
          duration,
          instructions
         FROM prescription_items
         WHERE prescription_id = $1
         ORDER BY medicine_name ASC`,
        [prescription.id]
      );

      res.json({
        status: "success",
        message: "Prescription retrieved successfully",
        prescription: prescription,
        medicines: medicinesResult.rows
      });

    } catch (error) {
      console.error(
        "Get single prescription error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message: "Failed to retrieve prescription"
      });
    }
  }
);


module.exports = router;