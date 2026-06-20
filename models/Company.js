const mongoose = require("mongoose");

/**
 * Company master data, ingested from the ROC state CSV exports
 * (see importCompanies.js). Backs GET /api/business/all-companies (list)
 * and GET /api/business/companies/:cin (detail).
 *
 * Stores ALL fields from the ROC CSVs so the detail page can show full
 * details. No secondary index on companyName — on the free Atlas tier such
 * an index over ~617k long strings is what blew the 512MB quota; the list
 * endpoint sorts by _id and search uses a regex scan.
 *
 * Field names are clean here; the API layer maps the seven legacy fields to
 * the exact keys the frontend list expects (e.g. "Company Name", "﻿CIN").
 */
const companySchema = new mongoose.Schema(
  {
    cin: { type: String },
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

module.exports = mongoose.models.Company || mongoose.model("Company", companySchema);
