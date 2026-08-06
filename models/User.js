const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, required: true, unique: true },
  password: String,
  role: { type: String, enum: ["user","buyer", "seller", "ca", "admin"], default: "buyer" },
  // Capabilities decide what a user can DO, independent of their display role.
  // This is what lets a buyer also sell (and vice-versa) without abusing the
  // "ca" role. Defaults mirror a plain buyer.
  canBuy: { type: Boolean, default: true },
  canSell: { type: Boolean, default: false },
  // Profile fields (collected post-signup via the Settings page).
  phone: { type: String },
  address: { type: String },
  isVerified: { type: Boolean, default: false },
  verificationToken: String
});
// userSchema.pre('save', async function(next){ if(!this.isModified('password')) return next(); const salt= await bcrypt.genSalt(10); this.password = await bcrypt.hash(this.password, salt); next(); });
userSchema.methods.comparePassword = function(candidate){ return bcrypt.compare(candidate, this.password); }
module.exports = mongoose.model('User', userSchema);
