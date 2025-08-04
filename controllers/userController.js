const asyncHandler = require('express-async-handler');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto'); 
const User = require('../models/userModel');
const sendEmail = require('../utils/sendEmail');

//@desc Register a user
//@route POST /api/users/register
//@access public
const registerUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400);
    throw new Error('Email and password are mandatory');
  }

  const userAvailable = await User.findOne({ email });
  if (userAvailable) {
    res.status(400);
    throw new Error('User already registered');
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 10);
  console.log('Hashed password is:', hashedPassword);

  const user = await User.create({
    email,
    password: hashedPassword,
  });

  console.log(`User created: ${user}`);
  if (user) {
    res.status(201).json({ _id: user.id, email: user.email });
  } else {
    res.status(400);
    throw new Error('User data is not valid');
  }
});

//@desc Login a user
//@route POST /api/users/login
//@access public
const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400);
    throw new Error('Email and password are mandatory');
  }

  const user = await User.findOne({ email });

  // Compare password with hashed password
  if (user && (await bcrypt.compare(password, user.password))) {
    const accessToken = jwt.sign(
      {
        user: {
          email: user.email,
          id: user.id,
        },
      },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: '15m' }
    );
    res.status(200).json({ accessToken });
  } else {
    res.status(401);
    throw new Error('Email or password is not valid');
  }
});

//@desc Current user info
//@route POST /api/users/current
//@access private
const currentUser = asyncHandler(async (req, res) => {
  res.json(req.user);
});










//Add forgot and reset passwords HERE
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body
  
  if (!email) {
    res.status(400);
    throw new Error('Email is mandatory');
  }

  const user = await User.findOne({ email });
  if (!user) {
    res.status(404);
    throw new Error('No user found with that email address');
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  console.log('🔑 ORIGINAL TOKEN (use this for testing):', resetToken);

  const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

  user.resetPasswordToken = hashedToken;
  user.resetPasswordExpires = Date.now() + 10 * 60 * 1000;

  await user.save({ validateBeforeSave: false });

  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

  const message = `
    <h2>Password Reset Request</h2>
    <p>You have requested a password reset. Please click the link below to reset your password:</p>
    <a href="${resetUrl}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">Reset Password</a>
    <p>This link will expire in 10 minutes.</p>
    <p>If you didn't request this, please ignore this email.</p>
  `;

  try {
    await sendEmail({
      email: user.email,
      subject: 'Password Reset Request',
      message
    });

    console.log(`Password reset email sent to: ${user.email}`);
    res.status(200).json({
      message: 'Password reset email sent successfully',
      email: user.email
    });
  } catch (emailError) {
    console.log('Email sending failed:', emailError);
    
    // Clear reset token if email fails
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save({ validateBeforeSave: false });

    res.status(500);
    throw new Error('Email could not be sent. Please try again later.');
  }
});


const resetPassword = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { password, confirmPassword } = req.body;

  console.log('1. Token received:', token);

  if (!password || !confirmPassword) {
    res.status(400);
    throw new Error('Password and confirm password are mandatory');
  }

  if (password !== confirmPassword) {
    res.status(400);
    throw new Error('Passwords do not match');
  }

  if (password.length < 6) {
    res.status(400);
    throw new Error('Password must be at least 6 characters long');
  }

  // Hash the token to compare with stored hashed token
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  console.log('2. Hash of received token:', hashedToken);

  // Find user with valid reset token and check expiration
  const user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpires: { $gt: Date.now() }
  });

  if (user) {
    console.log('3. Stored hash in DB:', user.resetPasswordToken);
  } else {
    console.log('3. No user found with that hash');
  }

  if (!user) {
    res.status(400);
    throw new Error('Invalid or expired reset token');
  }

  // Hash new password
  const hashedPassword = await bcrypt.hash(password, 10);
  console.log('New hashed password created');

  // Set new password and clear reset token fields
  user.password = hashedPassword;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  
  await user.save();

  console.log(`Password reset successful for user: ${user.email}`);
  res.status(200).json({ 
    message: 'Password reset successful',
    email: user.email 
  });
});







module.exports = { 
  registerUser, 
  loginUser, 
  currentUser, 
  forgotPassword,
  resetPassword
};