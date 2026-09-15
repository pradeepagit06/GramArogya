const express = require("express");
const pool = require("../db");
const authenticateToken = require("../middleware/authMiddleware");

const router = express.Router();


// Get all published health education content
router.get("/all", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        id,
        category,
        title_en,
        title_hi,
        title_mr,
        body_en,
        body_hi,
        body_mr,
        audio_url_en,
        audio_url_hi,
        audio_url_mr,
        media_url,
        is_published,
        created_at
      FROM health_education_content
      WHERE is_published = true
      ORDER BY created_at DESC
      `
    );

    res.json({
      status: "success",
      count: result.rows.length,
      data: result.rows
    });

  } catch (error) {
    console.error("Get health education error:", error.message);

    res.status(500).json({
      status: "error",
      message: "Failed to fetch health education content"
    });
  }
});


// Get content by category
router.get("/category/:category", authenticateToken, async (req, res) => {
  try {
    const { category } = req.params;

    const result = await pool.query(
      `
      SELECT
        id,
        category,
        title_en,
        title_hi,
        title_mr,
        body_en,
        body_hi,
        body_mr,
        audio_url_en,
        audio_url_hi,
        audio_url_mr,
        media_url,
        is_published,
        created_at
      FROM health_education_content
      WHERE category = $1
        AND is_published = true
      ORDER BY created_at DESC
      `,
      [category]
    );

    res.json({
      status: "success",
      count: result.rows.length,
      data: result.rows
    });

  } catch (error) {
    console.error("Get category content error:", error.message);

    res.status(500).json({
      status: "error",
      message: "Failed to fetch category content"
    });
  }
});


// Get single health education content
router.get("/:contentId", authenticateToken, async (req, res) => {
  try {
    const { contentId } = req.params;

    const result = await pool.query(
      `
      SELECT
        id,
        category,
        title_en,
        title_hi,
        title_mr,
        body_en,
        body_hi,
        body_mr,
        audio_url_en,
        audio_url_hi,
        audio_url_mr,
        media_url,
        is_published,
        created_at
      FROM health_education_content
      WHERE id = $1
        AND is_published = true
      `,
      [contentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "Health education content not found"
      });
    }

    res.json({
      status: "success",
      data: result.rows[0]
    });

  } catch (error) {
    console.error("Get health education details error:", error.message);

    res.status(500).json({
      status: "error",
      message: "Failed to fetch health education content"
    });
  }
});


// Search health education content
router.get("/search/content", authenticateToken, async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim() === "") {
      return res.status(400).json({
        status: "error",
        message: "Search query is required"
      });
    }

    const searchTerm = `%${q.trim()}%`;

    const result = await pool.query(
      `
      SELECT
        id,
        category,
        title_en,
        title_hi,
        title_mr,
        body_en,
        body_hi,
        body_mr,
        media_url,
        created_at
      FROM health_education_content
      WHERE is_published = true
        AND (
          title_en ILIKE $1
          OR title_hi ILIKE $1
          OR title_mr ILIKE $1
          OR body_en ILIKE $1
          OR body_hi ILIKE $1
          OR body_mr ILIKE $1
          OR category ILIKE $1
        )
      ORDER BY created_at DESC
      `,
      [searchTerm]
    );

    res.json({
      status: "success",
      count: result.rows.length,
      data: result.rows
    });

  } catch (error) {
    console.error("Search health education error:", error.message);

    res.status(500).json({
      status: "error",
      message: "Failed to search health education content"
    });
  }
});


module.exports = router;