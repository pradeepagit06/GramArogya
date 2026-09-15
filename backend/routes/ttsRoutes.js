const express = require("express");

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const { text, lang } = req.body;

    if (!text || !lang) {
      return res.status(400).json({
        status: "error",
        message: "text and lang are required"
      });
    }

    const allowedLanguages = ["en", "hi", "mr"];

    if (!allowedLanguages.includes(lang)) {
      return res.status(400).json({
        status: "error",
        message: "Unsupported language"
      });
    }

    const ttsUrl =
      "https://translate.google.com/translate_tts" +
      "?ie=UTF-8" +
      "&client=tw-ob" +
      "&tl=" +
      encodeURIComponent(lang) +
      "&q=" +
      encodeURIComponent(text);

    const response = await fetch(ttsUrl, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    if (!response.ok) {
      throw new Error(
        "TTS service returned status " + response.status
      );
    }

    const audioBuffer = Buffer.from(
      await response.arrayBuffer()
    );

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader(
      "Content-Length",
      audioBuffer.length.toString()
    );
    res.setHeader("Cache-Control", "no-cache");

    return res.send(audioBuffer);

  } catch (error) {
    console.error("TTS error:", error.message);

    return res.status(500).json({
      status: "error",
      message: "Text to speech failed"
    });
  }
});

module.exports = router;
