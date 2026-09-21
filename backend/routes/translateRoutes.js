const express = require("express");

const router = express.Router();

router.post("/", async (req, res) => {

  try {

    const { text, source, target } = req.body;

    if (!text || !source || !target) {

      return res.status(400).json({
        status: "error",
        message: "text, source and target are required"
      });

    }

    if (source === target) {

      return res.json({
        status: "success",
        translatedText: text
      });

    }

    const languagePair = `${source}|${target}`;

    const url =
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${languagePair}`;

    const response = await fetch(url);

    if (!response.ok) {

      throw new Error("Translation service unavailable");

    }

    const data = await response.json();

    const translatedText =
      data?.responseData?.translatedText;

    if (!translatedText) {

      throw new Error("No translation returned");

    }

    return res.json({

      status: "success",

      source,

      target,

      originalText: text,

      translatedText

    });

  } catch (error) {

    console.error(
      "Translation error:",
      error.message
    );

    return res.status(500).json({

      status: "error",

      message: "Translation failed"

    });

  }

});

module.exports = router;