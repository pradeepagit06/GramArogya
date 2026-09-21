const express = require("express");
const pool = require("../db");
const authenticateToken = require("../middleware/authMiddleware");

const router = express.Router();

// Get all notifications for logged-in user
router.get("/my", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        id,
        user_id,
        type,
        title,
        message,
        related_entity_type,
        related_entity_id,
        is_read,
        created_at
      FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [req.user.userId]
    );

    res.json({
      status: "success",
      count: result.rows.length,
      data: result.rows
    });

  } catch (error) {
    console.error("Get notifications error:", error.message);

    res.status(500).json({
      status: "error",
      message: "Failed to fetch notifications"
    });
  }
});


// Get unread notifications
router.get("/unread", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        id,
        user_id,
        type,
        title,
        message,
        related_entity_type,
        related_entity_id,
        is_read,
        created_at
      FROM notifications
      WHERE user_id = $1
        AND is_read = false
      ORDER BY created_at DESC
      `,
      [req.user.userId]
    );

    res.json({
      status: "success",
      count: result.rows.length,
      data: result.rows
    });

  } catch (error) {
    console.error("Get unread notifications error:", error.message);

    res.status(500).json({
      status: "error",
      message: "Failed to fetch unread notifications"
    });
  }
});


// Mark one notification as read
router.patch(
  "/:notificationId/read",
  authenticateToken,
  async (req, res) => {
    try {
      const { notificationId } = req.params;

      const result = await pool.query(
        `
        UPDATE notifications
        SET is_read = true
        WHERE id = $1
          AND user_id = $2
        RETURNING
          id,
          user_id,
          type,
          title,
          message,
          related_entity_type,
          related_entity_id,
          is_read,
          created_at
        `,
        [notificationId, req.user.userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Notification not found"
        });
      }

      res.json({
        status: "success",
        message: "Notification marked as read",
        data: result.rows[0]
      });

    } catch (error) {
      console.error("Mark notification read error:", error.message);

      res.status(500).json({
        status: "error",
        message: "Failed to update notification"
      });
    }
  }
);


// Mark all notifications as read
router.patch(
  "/read-all",
  authenticateToken,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        UPDATE notifications
        SET is_read = true
        WHERE user_id = $1
          AND is_read = false
        RETURNING id
        `,
        [req.user.userId]
      );

      res.json({
        status: "success",
        message: "All notifications marked as read",
        updated_count: result.rows.length
      });

    } catch (error) {
      console.error("Mark all notifications read error:", error.message);

      res.status(500).json({
        status: "error",
        message: "Failed to update notifications"
      });
    }
  }
);

module.exports = router;