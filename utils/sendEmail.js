const nodemailer = require('nodemailer');

const sendEmail = async (options) => {
  // Create transporter
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST, // e.g., smtp.gmail.com
    port: process.env.SMTP_PORT, // e.g., 587
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_EMAIL,
      pass: process.env.SMTP_PASS
    }
  });

  // Email options
  const mailOptions = {
    from: `${process.env.FROM_NAME} <${process.env.FROM_EMAIL}>`,
    to: options.email,
    subject: options.subject,
    html: options.message
  };

  // Send email
  const info = await transporter.sendMail(mailOptions);
  console.log('Message sent: %s', info.messageId);
};

module.exports = sendEmail;