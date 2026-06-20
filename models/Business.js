const mongoose = require("mongoose");

// 🔹 Directors Schema
const directorSchema = new mongoose.Schema({
  name: { type: String, required: true },
  DIN: { type: String },
  role: { type: String },
  appointedOn: { type: Date },
  isSignatory: { type: Boolean, default: false },
});

// 🔹 Document Schema
const documentSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ["image", "financial", "itr", "certificate", "additional"],
    required: true,
  },
  name: { type: String, required: true },
  url: { type: String, required: true }, // Cloudinary / Supabase URL
  uploadedAt: { type: Date, default: Date.now },
});

// 🔹 Important Dates Schema
const importantDatesSchema = new mongoose.Schema({
  agmDate: { type: Date },
  balanceSheetFilingDate: { type: Date },
  annualReturnFilingDate: { type: Date },
});

// 🔹 Auction Details Schema
const auctionDetailsSchema = new mongoose.Schema({
  startingBidAmount: { type: Number, required: true },
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now }
});

// 🔹 Main Business Listing Schema
const businessListingSchema = new mongoose.Schema(
  {
    // ✅ Company Info
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    CIN: { type: String, required: true },
    companyName: { type: String, required: true },
    ROC: { type: String },
    registrationNumber: { type: String, required: true },
    registeredAddress: { type: String },
    subCategory: { type: String },
    classOfCompany: { type: String },
    categoryOfCompany: { type: String },
    numberOfEmployees: {
  type: Number,
  required: false,   // or false if optional
},

    // ✅ Listing Info
    listedInStockExchange: { type: Boolean, default: false },
    listedStockExchange: { type: String },

    // ✅ Financial Info
    authorizedCapital: { type: Number },
    paidUpCapital: { type: Number },

    // ✅ Dates
    dateOfIncorporation: { type: Date },
    dateOfBalanceSheet: { type: Date },
    importantDates: importantDatesSchema,
    

    // ✅ Directors / Signatories
    directors: [directorSchema],

    // ✅ Auction Details (managed separately via /auction route)
    auctionDetails: [auctionDetailsSchema],

    // ✅ Uploaded Documents (managed separately via /documents route)
    documents: [documentSchema],

    // ✅ Status & Description
    companyStatus: {
      type: String,
      enum: ["Active", "Inactive", "Strike Off", "Liquidated"],
      default: "Active",
    },
    description: { type: String },

    // Listing-form details (shown on the Browse Companies card)
    stakePercentage: { type: Number },
    closureTimeline: { type: String },

    verified: {
    type: Boolean,
    default: false, // initially unverified
  },
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User", // admin who verified
  },
  verifiedAt: { type: Date },
  highestBid: {
  type: Number,
  default: 0,
},

highestBidder: {
  type: mongoose.Schema.Types.ObjectId,
  ref: "User",
},
  

    // ✅ Metadata
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
  
);


businessListingSchema.set("toJSON", { virtuals: true });
businessListingSchema.set("toObject", { virtuals: true });


module.exports = mongoose.model("Business", businessListingSchema, "businesses");

