const asyncHandler = require('express-async-handler');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto'); // ADD THIS IMPORT
const nodemailer = require('nodemailer'); // ADD THIS IMPORT
const User = require('../models/userModel');

// ADD EMAIL TRANSPORTER SETUP
const createEmailTransporter = () => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn('Email credentials not configured - forgot password will not work');
    return null;
  }
  
  return nodemailer.createTransporter({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
};

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

// ADD THIS NEW FUNCTION FOR FORGOT PASSWORD
//@desc Send password reset email
//@route POST /api/users/forgot-password
//@access public
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    res.status(400);
    throw new Error('Email is required');
  }

  // Check if user exists
  const user = await User.findOne({ email });
  if (!user) {
    // Don't reveal if user exists or not for security
    res.status(200).json({ 
      message: 'If an account with that email exists, password reset instructions have been sent.' 
    });
    return;
  }

  // Generate reset token
  const resetToken = crypto.randomBytes(32).toString('hex');
  const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
  
  // Save reset token to user (expires in 1 hour)
  user.resetPasswordToken = resetTokenHash;
  user.resetPasswordExpires = Date.now() + 60 * 60 * 1000; // 1 hour
  await user.save();

  // Create email transporter
  const transporter = createEmailTransporter();
  if (!transporter) {
    res.status(500);
    throw new Error('Email service not configured');
  }

  // Create reset URL - UPDATE THIS WITH YOUR FRONTEND URL
  const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;

  // Email content
  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: user.email,
    subject: 'Password Reset Request - Class Tracker',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #A23A56;">Password Reset Request</h2>
        
        <p>Hi there,</p>
        
        <p>You requested a password reset for your Class Tracker account. Click the button below to reset your password:</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" 
             style="background: linear-gradient(to right, #A23A56, #B8456E); 
                    color: white; 
                    padding: 12px 30px; 
                    text-decoration: none; 
                    border-radius: 8px; 
                    font-weight: bold;
                    display: inline-block;">
            Reset My Password
          </a>
        </div>
        
        <p>Or copy and paste this link into your browser:</p>
        <p style="background-color: #f5f5f5; padding: 10px; border-radius: 4px; word-break: break-all;">
          ${resetUrl}
        </p>
        
        <p style="color: #666; font-size: 14px;">
          This link will expire in 1 hour for security reasons.
        </p>
        
        <p style="color: #666; font-size: 14px;">
          If you didn't request this password reset, please ignore this email.
        </p>
        
        <hr style="border: 1px solid #eee; margin: 30px 0;">
        <p style="color: #999; font-size: 12px;">
          Class Tracker - ASU Class Monitoring System
        </p>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Password reset email sent to ${email}`);
    
    res.status(200).json({ 
      message: 'Password reset instructions have been sent to your email address.' 
    });
  } catch (error) {
    // Clear the reset token if email fails
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    
    console.error('Error sending password reset email:', error);
    res.status(500);
    throw new Error('Error sending password reset email');
  }
});

// ADD THIS NEW FUNCTION FOR RESET PASSWORD
//@desc Reset password with token
//@route POST /api/users/reset-password
//@access public
const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    res.status(400);
    throw new Error('Token and new password are required');
  }

  // Hash the token to compare with stored hash
  const resetTokenHash = crypto.createHash('sha256').update(token).digest('hex');

  // Find user with valid reset token
  const user = await User.findOne({
    resetPasswordToken: resetTokenHash,
    resetPasswordExpires: { $gt: Date.now() }
  });

  if (!user) {
    res.status(400);
    throw new Error('Invalid or expired reset token');
  }

  // Hash new password
  const hashedPassword = await bcrypt.hash(password, 10);

  // Update user password and clear reset token
  user.password = hashedPassword;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  await user.save();

  console.log(`Password reset successful for user: ${user.email}`);
  
  res.status(200).json({ 
    message: 'Password reset successful. You can now log in with your new password.' 
  });
});

// UPDATE THE EXPORTS TO INCLUDE NEW FUNCTIONS
module.exports = { 
  registerUser, 
  loginUser, 
  currentUser, 
  forgotPassword, 
  resetPassword 
};