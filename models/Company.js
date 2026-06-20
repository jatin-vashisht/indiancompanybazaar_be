const mongoose = require("mongoose");

/**
 * Company master data, ingested from the ROC state CSV exports
 * (see importCompanies.js). Backs GET /api/business/all-companies (list)
 * and GET /api/business/companies/:cin (detail).
 *
 * The full 16-field dataset for ~617k rows measures ~515MB on Atlas's quota,
 * which exceeds the free tier (512MB). So we keep the most useful fields
 * (identity, dates, status, sector, location, both capitals, class) and drop
 * the low-value ROC classification fields (category, subCategory, rocCode,
 * listingStatus, indianForeign). Upgrade the Atlas tier to store all 16.
 *
 * No secondary index on companyName (an index over ~617k long strings is what
 * blew the quota); the list endpoint sorts by _id and search uses a regex scan.
 *
 * Field names are clean here; the API layer maps them to the exact keys the
 * frontend list expects (e.g. "Company Name", "﻿CIN").
 */
const companySchema = new mongoose.Schema(
  {
    cin: { type: String },
    companyName: { type: String },
    companyClass: { type: String },
    authorizedCapital: { type: Number },
    paidupCapital: { type: Number },
    registrationDate: { type: String },
    registeredOfficeAddress: { type: String },
    companyStatus: { type: String },
    stateCode: { type: String },
    nicCode: { type: String },
    industrialClassification: { type: String },
  },
  { collection: "companies", timestamps: false }
);

module.exports = mongoose.models.Company || mongoose.model("Company", companySchema);
