const express = require('express');
const { registerUser, loginUser, currentUser, forgotPassword, resetPassword } = require('../controllers/userController');
const validateToken = require('../middleware/validateTokenHandler');

const router = express.Router();

router.post('/register', registerUser);

router.post('/login', loginUser);

router.get('/current', validateToken, currentUser);

router.post('/forgot-password', forgotPassword);

router.post('/reset-password/:token', resetPassword);

module.exports = router;