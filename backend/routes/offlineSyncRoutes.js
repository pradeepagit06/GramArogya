const express = require("express");
const router = express.Router();

const pool = require("../db");
const authenticateToken = require("../middleware/authMiddleware");

// Allowed PostgreSQL enum values
const allowedOperations = [
  "insert",
  "update",
  "delete"
];

// POST /api/offline-sync/queue
// Add an offline operation to the sync queue
router.post("/queue", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const {
      entity_type,
      entity_local_id,
      operation,
      payload,
      created_offline_at
    } = req.body;

    // Validate required fields
    if (
      !entity_type ||
      !entity_local_id ||
      !operation ||
      payload === undefined ||
      !created_offline_at
    ) {
      return res.status(400).json({
        status: "error",
        message:
          "entity_type, entity_local_id, operation, payload and created_offline_at are required"
      });
    }

    // Validate operation
    if (!allowedOperations.includes(operation)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid operation",
        allowed_operations: allowedOperations
      });
    }

    // Insert into offline sync queue
    const result = await pool.query(
      `
      INSERT INTO offline_sync_queue
      (
        user_id,
        entity_type,
        entity_local_id,
        operation,
        payload,
        created_offline_at
      )
      VALUES
      ($1, $2, $3, $4, $5, $6)
      RETURNING
        id,
        user_id,
        entity_type,
        entity_local_id,
        operation,
        payload,
        is_synced,
        sync_error,
        created_offline_at,
        synced_at,
        created_at
      `,
      [
        userId,
        entity_type,
        entity_local_id,
        operation,
        JSON.stringify(payload),
        created_offline_at
      ]
    );

    return res.status(201).json({
      status: "success",
      message: "Offline record added to sync queue",
      data: result.rows[0]
    });

  } catch (error) {
    console.error("Offline sync queue error:", error.message);

    return res.status(500).json({
      status: "error",
      message: "Failed to add offline record to sync queue"
    });
  }
});


// GET /api/offline-sync/pending
// Get pending offline records for logged-in user
router.get("/pending", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `
      SELECT
        id,
        user_id,
        entity_type,
        entity_local_id,
        operation,
        payload,
        is_synced,
        sync_error,
        created_offline_at,
        synced_at,
        created_at
      FROM offline_sync_queue
      WHERE user_id = $1
        AND is_synced = false
      ORDER BY created_offline_at ASC
      `,
      [userId]
    );

    return res.status(200).json({
      status: "success",
      count: result.rows.length,
      data: result.rows
    });

  } catch (error) {
    console.error("Pending offline sync error:", error.message);

    return res.status(500).json({
      status: "error",
      message: "Failed to fetch pending offline records"
    });
  }
});


// PATCH /api/offline-sync/:syncId/sync
// Mark an offline record as successfully synced
router.patch("/:syncId/sync", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { syncId } = req.params;

    const result = await pool.query(
      `
      UPDATE offline_sync_queue
      SET
        is_synced = true,
        sync_error = NULL,
        synced_at = NOW()
      WHERE id = $1
        AND user_id = $2
      RETURNING
        id,
        user_id,
        entity_type,
        entity_local_id,
        operation,
        payload,
        is_synced,
        sync_error,
        created_offline_at,
        synced_at,
        created_at
      `,
      [syncId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "Offline sync record not found"
      });
    }

    return res.status(200).json({
      status: "success",
      message: "Offline record marked as synced",
      data: result.rows[0]
    });

  } catch (error) {
    console.error("Mark sync error:", error.message);

    return res.status(500).json({
      status: "error",
      message: "Failed to mark offline record as synced"
    });
  }
});


// GET /api/offline-sync/status
// Get sync summary for logged-in user
router.get("/status", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `
      SELECT
        COUNT(*)::int AS total_records,
        COUNT(*) FILTER (
          WHERE is_synced = false
        )::int AS pending_records,
        COUNT(*) FILTER (
          WHERE is_synced = true
        )::int AS synced_records,
        COUNT(*) FILTER (
          WHERE sync_error IS NOT NULL
        )::int AS failed_records
      FROM offline_sync_queue
      WHERE user_id = $1
      `,
      [userId]
    );

    return res.status(200).json({
      status: "success",
      data: result.rows[0]
    });

  } catch (error) {
    console.error("Offline sync status error:", error.message);

    return res.status(500).json({
      status: "error",
      message: "Failed to fetch offline sync status"
    });
  }
});


module.exports = router;