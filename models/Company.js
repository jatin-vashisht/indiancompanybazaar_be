const mongoose = require("mongoose");

/**
 * Company master data, ingested from the ROC state CSV exports
 * (see importCompanies.js). This collection backs the
 * GET /api/business/all-companies endpoint ("All Companies" tab).
 *
 * Field names are kept clean here; the API layer maps them to the
 * exact keys the frontend expects (e.g. "Company Name", "﻿CIN").
 */
const companySchema = new mongoose.Schema(
  {
    cin: { type: String, index: true },
    companyName: { type: String },
    rocCode: { type: String },
    category: { type: String },
    subCategory: { type: String },
    companyClass: { type: String },
    authorizedCapital: { type: Number },
    paidupCapital: { type: Number },
    registrationDate: { type: String },
    registeredOfficeAddress: { type: String },
    listingStatus: { type: String },
    companyStatus: { type: String },
    stateCode: { type: String },
    indianForeign: { type: String },
    nicCode: { type: String },
    industrialClassification: { type: String },
  },
  { collection: "companies", timestamps: false }
);

// Supports the default alphabetical sort + prefix search; regex "contains"
// search also benefits from a smaller working set than a full scan.
companySchema.index({ companyName: 1 });

module.exports = mongoose.models.Company || mongoose.model("Company", companySchema);
