const mongoose = require("mongoose");

/**
 * Company master data, ingested from the ROC state CSV exports
 * (see importCompanies.js). Backs GET /api/business/all-companies.
 *
 * SLIM schema: only the fields the "All Companies" UI actually renders are
 * stored, to keep the dataset (~1M rows) within the free Atlas tier (512MB).
 * No secondary index on companyName (it would be too large for the free
 * tier) — the endpoint sorts by _id (insertion order) and uses a regex
 * scan for name search.
 *
 * Field names are clean here; the API layer maps them to the exact keys the
 * frontend expects (e.g. "Company Name", "﻿CIN").
 */
const companySchema = new mongoose.Schema(
  {
    cin: { type: String },
    companyName: { type: String },
    nicCode: { type: String },
    registrationDate: { type: String },
    companyStatus: { type: String },
    industrialClassification: { type: String },
    stateCode: { type: String },
  },
  { collection: "companies", timestamps: false }
);

module.exports = mongoose.models.Company || mongoose.model("Company", companySchema);
