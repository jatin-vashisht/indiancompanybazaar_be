const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

const brandColor = '#0B1D3A';
const accentColor = '#C8A455';
const lightBg = '#FAF7F2';
const mutedText = '#6c757d';

function otpTemplate(otp) {
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#eeebe6;font-family:'Georgia','Times New Roman',serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#eeebe6;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 16px rgba(11,29,58,0.08);">
        <tr><td style="background-color:${brandColor};padding:36px 40px;text-align:center;">
          <h1 style="margin:0;color:${accentColor};font-size:30px;font-weight:700;letter-spacing:2px;">KAHEM INDIA</h1>
          <p style="margin:8px 0 0;color:rgba(255,255,255,0.55);font-size:11px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">India's Trusted Business Marketplace</p>
        </td></tr>
        <tr><td style="height:3px;background:linear-gradient(90deg,${accentColor} 0%,#e8d5a8 50%,${accentColor} 100%);"></td></tr>
        <tr><td style="padding:40px;font-family:Arial,'Helvetica Neue',sans-serif;">
          <h2 style="margin:0 0 8px;color:#1a1a2e;font-size:22px;font-family:'Georgia',serif;">Verify your email</h2>
          <p style="color:${mutedText};font-size:15px;margin:0 0 28px;line-height:1.6;">Use the code below to complete your registration on Kahem India.</p>
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
            <div style="background-color:${lightBg};border:2px dashed ${accentColor};border-radius:8px;padding:28px 0;margin:0 0 28px;text-align:center;">
              <p style="margin:0 0 8px;color:${mutedText};font-size:13px;text-transform:uppercase;letter-spacing:1px;">Your verification code</p>
              <span style="font-size:40px;font-weight:800;letter-spacing:10px;color:${brandColor};">${otp}</span>
              <p style="margin:12px 0 0;color:${mutedText};font-size:13px;">Expires in 5 minutes</p>
            </div>
          </td></tr></table>
          <div style="background-color:#f5f0e5;border-left:4px solid ${accentColor};padding:14px 18px;border-radius:0 6px 6px 0;margin-bottom:24px;">
            <p style="margin:0;color:#1a1a2e;font-size:14px;line-height:1.5;"><strong>Security tip:</strong> Never share this code. Kahem India staff will never ask for it.</p>
          </div>
          <p style="color:${mutedText};font-size:14px;margin:0;">Didn't sign up? You can safely ignore this email.</p>
        </td></tr>
        <tr><td style="background-color:${lightBg};padding:24px 40px;border-top:1px solid #e9e4da;text-align:center;">
          <p style="margin:0 0 6px;color:${mutedText};font-size:12px;font-family:Arial,sans-serif;">This is an automated email from Kahem India. Please do not reply.</p>
          <p style="margin:0;color:${mutedText};font-size:12px;font-family:Arial,sans-serif;">&copy; ${new Date().getFullYear()} Kahem India. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendOtpEmail(email, otp) {
  try {
    await transporter.sendMail({
      from: `"Kahem India" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: 'Your Kahem India verification code',
      html: otpTemplate(otp),
    });
    console.log(`OTP email sent to ${email}`);
    return true;
  } catch (error) {
    console.error('Failed to send OTP email:', error.message);
    return false;
  }
}

module.exports = sendOtpEmail;
