// models/Bid.js
const mongoose = require("mongoose");

const bidSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: true,
    },
    buyer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    amount: { 
      type: Number, 
      required: true 
    },

    status: {
      type: String,
      enum: ["pending", "active", "accepted", "rejected", "won", "lost", "paid", "expired"],
      default: "pending",
    },

    isWon: {
      type: Boolean,
      default: false,
    },

    wonAt: Date,
  },
  { timestamps: true }
);

// 🧠 Auto update flags
bidSchema.pre("save", function (next) {
  if (["accepted", "paid", "won"].includes(this.status)) {
    this.isWon = true;
    if (!this.wonAt) this.wonAt = new Date();
  } else {
    this.isWon = false;
    this.wonAt = undefined;
  }
  next();
});

// 🧰 Return all won bids of a buyer
bidSchema.statics.findWonBids = function (buyerId) {
  return this.find({ buyer: buyerId, isWon: true })
    .populate("business", "companyName");
};

module.exports = mongoose.model("Bid", bidSchema);
