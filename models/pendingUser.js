const mongoose = require("mongoose");

const pendingUserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  otp: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  role: { type: String, default: "user" },
  phone: { type: String },
});

module.exports = mongoose.model("PendingUser", pendingUserSchema);
