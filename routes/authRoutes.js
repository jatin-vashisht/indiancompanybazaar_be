const express = require('express');
const router = express.Router();
const { register, login } = require('../controllers/authController');
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const authenticate = require("../middleware/authMiddleware").authenticate;
const { signToken, authCookieOptions, AUTH_COOKIE } = require("../utils/auth");

const User = require("../models/User");

// Capabilities implied by a chosen role. A buyer can buy; a seller can sell;
// a CA can do both. Admin gets both too. "user" is a not-yet-onboarded buyer.
function capsForRole(role) {
  switch (role) {
    case "seller": return { canBuy: false, canSell: true };
    case "ca": return { canBuy: true, canSell: true };
    case "admin": return { canBuy: true, canSell: true };
    case "buyer":
    case "user":
    default: return { canBuy: true, canSell: false };
  }
}

// Shape the user object returned to the client (never includes password).
function publicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    canBuy: user.canBuy,
    canSell: user.canSell,
    phone: user.phone || null,
    address: user.address || null,
  };
}

// Protect middleware (check token and attach user)
const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer")) {
    const token = authHeader.split(" ")[1];
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select("-password");
      if (!req.user) {
        return res.status(401).json({ message: "User not found" });
      }
      next();
    } catch (err) {
      return res.status(401).json({ message: "Invalid token" });
    }
  } else {
    return res.status(401).json({ message: "No token provided" });
  }
};

// Verify role middleware
const verifyRole = (roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Access denied for this role" });
    }
    next();
  };
};


router.get("/verify/:token", async (req, res) => {
  try {
    const decoded = jwt.verify(req.params.token, process.env.JWT_SECRET);
    const user = await User.findOne({ email: decoded.email });
    if (!user) return res.status(400).json({ message: "Invalid token" });

    user.isVerified = true;
    user.verificationToken = undefined;
    await user.save();

    res.status(200).json({ message: "Email verified successfully!" });
  } catch (err) {
    res.status(400).json({ message: "Verification link invalid or expired." });
  }
});

// 🔁 Resend OTP
router.post("/resend-otp", async (req, res) => {
  const { email } = req.body;
  const pending = await PendingUser.findOne({ email });
  if (!pending) return res.status(400).json({ error: "No pending registration found" });

  const newOtp = Math.floor(100000 + Math.random() * 900000).toString();
  pending.otp = newOtp;
  pending.expiresAt = Date.now() + 5 * 60 * 1000;
  await pending.save();

  const emailResult = await sendOtpEmail(email, newOtp);
  if (!emailResult) return res.status(500).json({ error: "Failed to resend OTP" });

  res.status(200).json({ message: "New OTP sent to email" });
});



const PendingUser = require("../models/pendingUser");
const sendOtpEmail = require("../utils/sendEmailOtp");

// ====================
// 📧 Register with OTP
// ====================
router.post("/register", async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password)
    return res.status(400).json({ error: "All fields are required" });

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser)
      return res.status(400).json({ error: "Email already registered" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 min expiry

    await PendingUser.deleteMany({ email });
    await PendingUser.create({
      name,
      email,
      password: hashedPassword,
      otp,
      expiresAt,
      role: role || "user",
    });

    const sent = await sendOtpEmail(email, otp);
    if (!sent) return res.status(500).json({ error: "Failed to send OTP" });

    res.status(200).json({ message: "OTP sent to email" });
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ error: "Server error" });
  }
});
/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     description: Creates a pending user and sends OTP email for verification.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: OTP sent to email
 *       400:
 *         description: Missing or invalid input
 */


// ====================
// 🔐 Verify OTP
// ====================
/**
 * @swagger
 * /api/auth/verify-otp:
 *   post:
 *     summary: Verify OTP and complete registration
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - otp
 *             properties:
 *               email:
 *                 type: string
 *              
 *               otp:
 *                 type: string
 * 
 *     responses:
 *       201:
 *         description: User verified and registered
 *       400:
 *         description: Invalid or expired OTP
 *       500:
 *         description: Internal server error
 */

router.post("/verify-otp", async (req, res) => {
  const { email, otp } = req.body;

  try {
    const pending = await PendingUser.findOne({ email });
    if (!pending) return res.status(400).json({ error: "No pending registration" });
    if (pending.otp !== otp) return res.status(400).json({ error: "Invalid OTP" });
    if (Date.now() > pending.expiresAt)
      return res.status(400).json({ error: "OTP expired" });

    const caps = capsForRole(pending.role);
    const user = new User({
      name: pending.name,
      email: pending.email,
      password: pending.password,
      role: pending.role,
      canBuy: caps.canBuy,
      canSell: caps.canSell,
      isVerified: true,
    });

    await user.save();
    await PendingUser.deleteOne({ _id: pending._id });

    // Auto-login on successful verification: issue token + httpOnly cookie.
    const token = signToken(user);
    res.cookie(AUTH_COOKIE, token, authCookieOptions());
    res.status(201).json({
      message: "User verified and registered successfully",
      token,
      user: publicUser(user),
    });
  } catch (err) {
    console.error("Verification error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ====================
// 🔑 Login
// ====================
/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login with email and password
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successful login
 *       400:
 *         description: Invalid credentials
 */
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email }).select("+password");
    if (!user) return res.status(400).json({ error: "User not found" });

    if (!user.isVerified)
      return res.status(403).json({ error: "Please verify your email before logging in" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: "Password mismatch" });

    // Token carries role + capabilities; also set as an httpOnly cookie.
    const token = signToken(user);
    res.cookie(AUTH_COOKIE, token, authCookieOptions());

    res.status(200).json({
      message: "Login successful",
      token,
      user: publicUser(user),
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error" });
  }
});


/**
 * @swagger
 * /api/auth/set-role:
 *   post:
 *     summary: Set user role by email
 *     description: Updates the user's role and returns a new JWT token.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - role
 *             properties:
 *               email:
 *                 type: string
 *                 example: "string2@gmail.com"
 *               role:
 *                 type: string
 *                 enum: [buyer, seller, investor, ca, admin]
 *                 example: "ca"
 *     responses:
 *       200:
 *         description: Role updated successfully and token returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Role updated successfully"
 *                 token:
 *                   type: string
 *                   example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       example: "69079b94ac836a0bca6ad7fb"
 *                     name:
 *                       type: string
 *                       example: "string"
 *                     email:
 *                       type: string
 *                       example: "string2@gmail.com"
 *                     role:
 *                       type: string
 *                       example: "ca"
 */


// Onboarding role selection. NOW AUTHENTICATED — it acts on the caller's own
// account (never an email from the body) and refuses privileged roles, so it
// can't be used to self-promote to admin/ca. buyer/seller only.
router.post("/set-role", authenticate, async (req, res) => {
  try {
    const { role } = req.body;
    const ALLOWED = ["buyer", "seller"];
    if (!role || !ALLOWED.includes(role)) {
      return res.status(400).json({ error: "Role must be one of: buyer, seller" });
    }

    const caps = capsForRole(role);
    req.user.role = role;
    req.user.canBuy = caps.canBuy;
    req.user.canSell = caps.canSell;
    await req.user.save();

    const token = signToken(req.user);
    res.cookie(AUTH_COOKIE, token, authCookieOptions());
    res.status(200).json({
      message: "Role updated successfully",
      token,
      user: publicUser(req.user),
    });
  } catch (err) {
    console.error("Set role error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// A8 — Register for the OTHER capability (buyer↔seller) without changing the
// user's primary role or granting privileged access. Additive only.
router.post("/register-capability", authenticate, async (req, res) => {
  try {
    const { capability } = req.body; // "buyer" | "seller"
    if (!["buyer", "seller"].includes(capability)) {
      return res.status(400).json({ error: "capability must be 'buyer' or 'seller'" });
    }
    if (capability === "buyer") req.user.canBuy = true;
    if (capability === "seller") req.user.canSell = true;
    await req.user.save();

    const token = signToken(req.user);
    res.cookie(AUTH_COOKIE, token, authCookieOptions());
    res.status(200).json({
      message: `You can now ${capability === "seller" ? "sell/list" : "buy/bid"} as well.`,
      token,
      user: publicUser(req.user),
    });
  } catch (err) {
    console.error("register-capability error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Current user (identity source for a cookie-only frontend).
router.get("/me", authenticate, async (req, res) => {
  res.status(200).json({ user: publicUser(req.user) });
});

// Update editable profile fields on the caller's own account.
router.put("/profile", authenticate, async (req, res) => {
  try {
    const { name, phone, address } = req.body;
    if (typeof name === "string" && name.trim()) req.user.name = name.trim();
    if (typeof phone === "string") {
      const digits = phone.replace(/\D/g, "");
      // Optional, but if given must be exactly 10 digits.
      if (digits && digits.length !== 10) {
        return res.status(400).json({ error: "Phone number must be exactly 10 digits" });
      }
      req.user.phone = digits;
    }
    if (typeof address === "string") req.user.address = address.trim();
    await req.user.save();
    res.status(200).json({ message: "Profile updated", user: publicUser(req.user) });
  } catch (err) {
    console.error("profile update error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Change password: verify the current one, then store a new bcrypt hash.
router.post("/change-password", authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new password are required" });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters" });
    }
    const user = await User.findById(req.user._id).select("+password");
    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) return res.status(400).json({ error: "Current password is incorrect" });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.status(200).json({ message: "Password changed successfully" });
  } catch (err) {
    console.error("change-password error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Logout: clear the auth cookie.
router.post("/logout", (req, res) => {
  res.clearCookie(AUTH_COOKIE, { ...authCookieOptions(), maxAge: undefined });
  res.status(200).json({ message: "Logged out" });
});















// Buyer dashboard
router.get("/buyer/dashboard", protect, verifyRole(["buyer"]), (req, res) => {
  res.json({ message: "Welcome Buyer Dashboard" });
});

// Seller dashboard
router.get("/seller/dashboard", protect, verifyRole(["seller"]), (req, res) => {
  res.json({ message: "Welcome Seller Dashboard" });
});

// CA dashboard
router.get("/ca/dashboard", protect, verifyRole(["ca"]), (req, res) => {
  res.json({ message: "Welcome CA Dashboard" });
});


module.exports = router;
