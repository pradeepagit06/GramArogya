const pool = require("./db");

async function testDatabase() {
  try {
    const result = await pool.query("SELECT NOW()");

    console.log("✅ Database connected successfully!");
    console.log("Server time:", result.rows[0].now);
  } catch (error) {
    console.error("❌ Database connection failed:");
    console.error(error.message);
  } finally {
    await pool.end();
  }
}

testDatabase();