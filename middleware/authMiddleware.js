const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { AUTH_COOKIE } = require("../utils/auth");

// Read the token from the httpOnly cookie first, then fall back to the
// Authorization header (kept during the sessionStorage→cookie migration).
function extractToken(req) {
  if (req.cookies && req.cookies[AUTH_COOKIE]) return req.cookies[AUTH_COOKIE];
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) return authHeader.split(" ")[1];
  return null;
}

exports.authenticate = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ error: "No token provided" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded || !decoded.id) {
      return res.status(401).json({ error: "Invalid token" });
    }

    // Attach the live user (source of truth for role/capabilities).
    const user = await User.findById(decoded.id).select("-password");
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error("❌ Auth error:", err.message);
    res.status(401).json({ error: "Invalid or expired token" });
  }
};

// Attaches req.user when a valid token is present, but never rejects — for
// public endpoints that reveal more to authenticated viewers (e.g. owners see
// their own CIN/address; guests get the sanitized shape).
exports.optionalAuth = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) return next();
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded && decoded.id) {
      req.user = await User.findById(decoded.id).select("-password");
    }
  } catch {
    // ignore bad/expired token on a public route
  }
  next();
};

exports.authorize = (...roles) => {
  return (req, res, next) => {
    const userRole = req.user?.role?.toLowerCase();
    if (!roles.map((r) => r.toLowerCase()).includes(userRole)) {
      return res.status(403).json({ message: "Access denied: insufficient permissions" });
    }
    next();
  };
};

// Capability guards — prefer these over role equality for buy/sell actions.
exports.requireCapability = (cap) => {
  return (req, res, next) => {
    if (!req.user || !req.user[cap]) {
      const action = cap === "canSell" ? "sell/list" : "buy/bid";
      return res.status(403).json({ message: `Your account is not enabled to ${action}. Register for it first.` });
    }
    next();
  };
};
