// Signup OTPs are delivered over Brevo's transactional email API so they leave
// a verified kahemindia.com sender rather than a personal Gmail account. This
// matches how the website contact form sends. Credentials come from env only.
const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

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

/**
 * Sends the signup verification code.
 * Returns true on success, false on failure — callers (POST /register and
 * POST /resend-otp) branch on this, so the contract is unchanged from the
 * previous nodemailer implementation.
 */
async function sendOtpEmail(email, otp) {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;

  if (!apiKey || !senderEmail) {
    console.error(
      '[otp] Brevo is not configured — set BREVO_API_KEY and BREVO_SENDER_EMAIL.'
    );
    return false;
  }

  try {
    const res = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: {
          email: senderEmail,
          name: process.env.BREVO_SENDER_NAME || 'Kahem India',
        },
        to: [{ email }],
        subject: 'Your Kahem India verification code',
        htmlContent: otpTemplate(otp),
      }),
      // Don't let a hung provider hold the signup request open indefinitely.
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      // Log the provider's own reason — the previous implementation collapsed
      // every failure into a bare false, which made outages undiagnosable.
      const detail = await res.text().catch(() => '');
      console.error(
        `[otp] Brevo rejected the send to ${email}: ${res.status} ${detail.slice(0, 300)}`
      );
      return false;
    }

    console.log(`OTP email sent to ${email}`);
    return true;
  } catch (error) {
    console.error(`[otp] Failed to send OTP email to ${email}:`, error.message);
    return false;
  }
}

module.exports = sendOtpEmail;
