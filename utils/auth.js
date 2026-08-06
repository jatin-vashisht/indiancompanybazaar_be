// Shared auth helpers: token creation + cookie options, so login, verify-otp,
// set-role and the profile routes all issue tokens the same way.
const jwt = require("jsonwebtoken");

// Build the JWT payload from a user document. Capabilities travel in the token
// so middleware doesn't need an extra DB read on every request.
function tokenPayload(user) {
  return {
    id: user._id,
    email: user.email,
    role: user.role,
    canBuy: user.canBuy,
    canSell: user.canSell,
  };
}

function signToken(user) {
  return jwt.sign(tokenPayload(user), process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "3d",
  });
}

// httpOnly cookie so page JS can't read or forge the token. Secure is on in
// production; off locally over http (COOKIE_SECURE=false).
function authCookieOptions() {
  const secure = String(process.env.COOKIE_SECURE ?? "true") !== "false";
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? "none" : "lax",
    maxAge: 3 * 24 * 60 * 60 * 1000, // 3 days
    path: "/",
  };
}

const AUTH_COOKIE = "access_token";

module.exports = { signToken, tokenPayload, authCookieOptions, AUTH_COOKIE };
