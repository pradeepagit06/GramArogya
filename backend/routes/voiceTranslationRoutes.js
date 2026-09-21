const express = require("express");
const authenticateToken = require("../middleware/authMiddleware");

const router = express.Router();

const supportedLanguages = {
  en: "English",
  hi: "Hindi",
  mr: "Marathi"
};

router.post(
  "/translate",
  authenticateToken,
  async (req, res) => {
    try {
      const {
        text,
        source,
        target
      } = req.body;

      if (!text || !text.trim()) {
        return res.status(400).json({
          status: "error",
          message: "Text is required"
        });
      }

      if (!source || !target) {
        return res.status(400).json({
          status: "error",
          message: "Source and target languages are required"
        });
      }

      if (!supportedLanguages[source]) {
        return res.status(400).json({
          status: "error",
          message: "Unsupported source language"
        });
      }

      if (!supportedLanguages[target]) {
        return res.status(400).json({
          status: "error",
          message: "Unsupported target language"
        });
      }

      if (source === target) {
        return res.json({
          status: "success",
          message: "Translation not required",
          data: {
            originalText: text.trim(),
            translatedText: text.trim(),
            source,
            target
          }
        });
      }

      /*
       * Temporary demo translation.
       * Later this function can be connected to
       * Bhashini / Google Cloud Translation / another
       * approved translation service.
       */

      const demoTranslations = {
        "hello": {
          hi: "नमस्ते",
          mr: "नमस्कार"
        },
        "what is your name?": {
          hi: "आपका नाम क्या है?",
          mr: "तुमचं नाव काय आहे?"
        },
        "do you have fever?": {
          hi: "क्या आपको बुखार है?",
          mr: "तुम्हाला ताप आहे का?"
        },
        "please drink plenty of water and take rest.": {
          hi: "कृपया खूब पानी पिएं और आराम करें।",
          mr: "कृपया भरपूर पाणी प्या आणि विश्रांती घ्या."
        }
      };

      const normalizedText = text.trim().toLowerCase();

      let translatedText = null;

      if (
        demoTranslations[normalizedText] &&
        demoTranslations[normalizedText][target]
      ) {
        translatedText =
          demoTranslations[normalizedText][target];
      }

      if (!translatedText) {
        return res.json({
          status: "success",
          message: "Translation service ready, but no demo translation found",
          data: {
            originalText: text.trim(),
            translatedText: text.trim(),
            source,
            target,
            translated: false
          }
        });
      }

      res.json({
        status: "success",
        message: "Text translated successfully",
        data: {
          originalText: text.trim(),
          translatedText,
          source,
          target,
          translated: true
        }
      });

    } catch (error) {
      console.error(
        "Voice translation error:",
        error.message
      );

      res.status(500).json({
        status: "error",
        message: "Failed to translate text"
      });
    }
  }
);

router.get(
  "/languages",
  authenticateToken,
  (req, res) => {
    res.json({
      status: "success",
      data: supportedLanguages
    });
  }
);

module.exports = router;