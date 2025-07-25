// Updated classRoutes.js
const express = require('express');
const router = express.Router();
const {
  getClasses,
  createClass,
  getClass,
  updateClass,
  deleteClass,
  lookupClass,
  getNotificationStats
} = require('../controllers/classController');
const validateToken = require('../middleware/validateTokenHandler');

router.use(validateToken);

router.route("/lookup").post(lookupClass);
router.route("/notifications/stats").get(getNotificationStats);
router.route("/").get(getClasses).post(createClass);
router.route("/:id").get(getClass).put(updateClass).delete(deleteClass);

module.exports = router;