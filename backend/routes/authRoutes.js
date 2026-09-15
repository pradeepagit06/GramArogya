const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const pool = require("../db");
const authenticateToken = require("../middleware/authMiddleware");
const allowRoles = require("../middleware/roleMiddleware");

const router = express.Router();

// ========================================
// REGISTER
// ========================================
router.post("/register", async (req, res) => {
  try {
    const {
      full_name,
      email,
      phone_number,
      password,
      role
    } = req.body;

    if (!full_name || !password) {
      return res.status(400).json({
        status: "error",
        message: "Full name and password are required"
      });
    }

    if (!email && !phone_number) {
      return res.status(400).json({
        status: "error",
        message: "Email or phone number is required"
      });
    }

    if (email) {
      const existingEmail = await pool.query(
        "SELECT id FROM users WHERE email = $1",
        [email]
      );

      if (existingEmail.rows.length > 0) {
        return res.status(409).json({
          status: "error",
          message: "Email already registered"
        });
      }
    }

    if (phone_number) {
      const existingPhone = await pool.query(
        "SELECT id FROM users WHERE phone_number = $1",
        [phone_number]
      );

      if (existingPhone.rows.length > 0) {
        return res.status(409).json({
          status: "error",
          message: "Phone number already registered"
        });
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users
       (role, full_name, phone_number, email, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING
         id,
         role,
         full_name,
         phone_number,
         email,
         preferred_language,
         is_phone_verified,
         is_email_verified,
         is_active,
         created_at`,
      [
        role || "patient",
        full_name,
        phone_number || null,
        email || null,
        passwordHash
      ]
    );

    res.status(201).json({
      status: "success",
      message: "User registered successfully",
      user: result.rows[0]
    });

  } catch (error) {
    console.error("Registration error:", error.message);

    res.status(500).json({
      status: "error",
      message: "Registration failed"
    });
  }
});

// ========================================
// LOGIN
// ========================================
router.post("/login", async (req, res) => {
  try {
    const {
      email,
      password
    } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        status: "error",
        message: "Email and password are required"
      });
    }

    const result = await pool.query(
      `SELECT
        id,
        role,
        full_name,
        phone_number,
        email,
        password_hash,
        preferred_language,
        is_active
       FROM users
       WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        status: "error",
        message: "Invalid email or password"
      });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(403).json({
        status: "error",
        message: "Account is inactive"
      });
    }

    const passwordMatch = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!passwordMatch) {
      return res.status(401).json({
        status: "error",
        message: "Invalid email or password"
      });
    }

    const token = jwt.sign(
      {
        userId: user.id,
        role: user.role
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d"
      }
    );

    await pool.query(
      `UPDATE users
       SET last_login_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [user.id]
    );

    res.json({
      status: "success",
      message: "Login successful",
      token: token,
      user: {
        id: user.id,
        role: user.role,
        full_name: user.full_name,
        phone_number: user.phone_number,
        email: user.email,
        preferred_language: user.preferred_language
      }
    });

  } catch (error) {
    console.error("Login error:", error.message);

    res.status(500).json({
      status: "error",
      message: "Login failed"
    });
  }
});

// ========================================
// GET CURRENT AUTHENTICATED USER
// ========================================
router.get("/me", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        id,
        role,
        full_name,
        phone_number,
        email,
        preferred_language,
        is_phone_verified,
        is_email_verified,
        is_active,
        profile_photo_url,
        last_login_at,
        created_at
       FROM users
       WHERE id = $1`,
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "User not found"
      });
    }

    res.json({
      status: "success",
      message: "Authenticated user details",
      user: result.rows[0]
    });

  } catch (error) {
    console.error("Get user error:", error.message);

    res.status(500).json({
      status: "error",
      message: "Failed to get user details"
    });
  }
});

// ========================================
// PATIENT ONLY API
// ========================================
router.get(
  "/patient-only",
  authenticateToken,
  allowRoles("patient"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
          id,
          role,
          full_name,
          phone_number,
          email,
          preferred_language,
          is_phone_verified,
          is_email_verified
         FROM users
         WHERE id = $1`,
        [req.user.userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Patient not found"
        });
      }

      res.json({
        status: "success",
        message: "Patient access granted",
        patient: result.rows[0]
      });

    } catch (error) {
      console.error("Patient API error:", error.message);

      res.status(500).json({
        status: "error",
        message: "Failed to load patient data"
      });
    }
  }
);

module.exports = router;

