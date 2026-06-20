const Business = require("../models/Business");
const Bid = require("../models/Bid");
const Company = require("../models/Company");
const { signBusinessDocuments } = require("../utils/s3");

/**
 * @desc Register a new business (only Seller or CA can do this)
 * @route POST /api/business/register
 * @access Private (Seller, CA)
 */
// controllers/businessController.js
const registerBusiness = async (req, res) => {
  try {
    console.log("🟢 Register Business called by:", req.user?.email);

    // ✅ Check if logged in
    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: "Unauthorized - User not found in token" });
    }

    // ✅ Ensure only sellers can register a business
    if (req.user.role !== "seller") {
      return res.status(403).json({ message: "Only sellers can register a business" });
    }

    // ✅ Create business record and link to seller
    const business = await Business.create({
      ...req.body,
      seller: req.user._id, // 👈 FIX: use seller instead of userId
      verified: false,      // always false initially
    });

    // ✅ Return structured JSON response
    res.status(201).json({
      message: "Business registered successfully!",
      business: business.toObject({ getters: true, versionKey: false }),
    });

  } catch (error) {
    console.error("❌ Business Registration Error:", error);
    res.status(500).json({
      message: "Server error while registering business",
      error: error.message,
    });
  }
};






// 💰 Add auction details
const addAuctionDetails = async (req, res) => {
  try {
    const { businessId } = req.params;
    const { startingBidAmount, startTime, endTime } = req.body;

    // Find business
    const business = await Business.findById(businessId);

    if (!business) {
      return res.status(404).json({ message: "Business not found" });
    }

    // Add auction details
    business.auctionDetails = {
      startingBidAmount,
      startTime,
      endTime,
    };

    // Ensure verified exists (default false)
    if (business.verified === undefined) {
      business.verified = false;
    }

    // Save updated business
    const updatedBusiness = await business.save();

    // 🔹 Convert to plain object so all fields (like verified) show up
    const plainBusiness = updatedBusiness.toObject({ getters: true, versionKey: false });

    // Respond
    res.status(200).json({
      message: "Auction details added successfully!",
      business: plainBusiness,
    });

  } catch (error) {
    console.error("Error adding auction details:", error);
    res.status(500).json({ message: "Server error" });
  }
};




// 📂 Upload business documents
// Map incoming document categories to the schema enum.
const DOC_TYPE_MAP = {
  images: "image",
  image: "image",
  financial: "financial",
  financialstatements: "financial",
  itr: "itr",
  incometaxreturns: "itr",
  certificate: "certificate",
  certificates: "certificate",
  additional: "additional",
};

const uploadBusinessDocuments = async (req, res) => {
  try {
    const { businessId } = req.params;

    const business = await Business.findById(businessId);
    if (!business) {
      return res.status(404).json({ message: "Business not found" });
    }

    if (req.file) {
      // multer-s3 uploaded the file to the private bucket; store its key.
      const rawType = String(req.body.type || "additional").toLowerCase();
      business.documents.push({
        type: DOC_TYPE_MAP[rawType] || "additional",
        name: req.body.name || req.file.originalname,
        key: req.file.key,
      });
      await business.save();
    } else if (req.body.documents) {
      // Legacy path: pre-built document objects in the body.
      const docs =
        typeof req.body.documents === "string"
          ? JSON.parse(req.body.documents)
          : req.body.documents;
      if (Array.isArray(docs) && docs.length > 0) {
        business.documents.push(...docs);
        await business.save();
      }
    }

    const signed = await signBusinessDocuments(business);
    res.json({
      message: "Documents uploaded successfully!",
      business: signed,
    });
  } catch (error) {
    console.error("Error uploading documents:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// 📋 Get all businesses
const getAllBusinesses = async (req, res) => {
  try {
    console.log("🔍 Fetching businesses for:", req.user?.role || "Public");

    let filter = { verified: true }; // Default → only verified

    // ✅ If logged in and user is admin or CA, show all
    if (req.user && ["admin", "ca"].includes(req.user.role)) {
      filter = {}; // Show all businesses
    }

    // ✅ Fetch businesses with filters
const businesses = await Business.find(filter)
  .sort({ createdAt: -1 })
  .populate("seller", "name email role"); // FIXED
 // show basic user info

    // ✅ Return response
    res.status(200).json({
      success: true,
      count: businesses.length,
      businesses,
    });
  } catch (error) {
    console.error("Error fetching businesses:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching businesses",
      error: error.message,
    });
  }
};


const getUnverifiedBusinesses = async (req, res) => {
  try {
    console.log("🔍 Fetching unverified businesses for:", req.user?.email);

    // ✅ Allow only admin or CA
    if (!req.user || !["admin", "ca"].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden — Only Admin or CA can view unverified businesses",
      });
    }

    // ✅ Find unverified businesses
const unverified = await Business.find({ verified: false })
  .sort({ createdAt: -1 })
  .populate("seller", "name email role"); // FIXED


    res.status(200).json({
      success: true,
      count: unverified.length,
      unverified,
    });
  } catch (error) {
    console.error("Error fetching unverified businesses:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching unverified businesses",
      error: error.message,
    });
  }
};


// 🔍 Get single business by ID

const getBusinessById = async (req, res) => {
  try {
    const { businessId } = req.params;

    const business = await Business.findById(businessId)
      .populate("seller", "name email");

    if (!business) {
      return res.status(404).json({ message: "Business not found" });
    }

    // 💡 Load all bids (optional for frontend history)
    const bids = await Bid.find({ business: businessId })
      .populate("buyer", "name email")
      .sort({ amount: -1 });

    // ⭐ STEP 3 — use highestBid saved in business
    const currentHighestBid = business.highestBid || 0;

    // ⭐ STEP 3 — next minimum bid
    const minimumNextBid = currentHighestBid + 1000;

    // ⭐ Get starting price safely
    const startingPrice =
      business.auctionDetails?.[0]?.startingBidAmount || 0;

    // Presign any S3 document keys into short-lived URLs.
    const signedBusiness = await signBusinessDocuments(business);

    return res.status(200).json({
      success: true,
      business: signedBusiness,
      bids,
      currentHighestBid,
      minimumNextBid,
      startingPrice,
    });

  } catch (error) {
    console.error("Error fetching business:", error);
    res.status(500).json({ message: error.message });
  }
};




// ❌ Delete a business
const deleteBusiness = async (req, res) => {
  try {
    const { businessId } = req.params;
    const business = await Business.findByIdAndDelete(businessId);

    if (!business) {
      return res.status(404).json({ message: "Business not found" });
    }

    res.json({ message: "Business deleted successfully!" });
  } catch (error) {
    console.error("Error deleting business:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Escape user input before using it inside a RegExp.
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Map a Company document to the exact keys the frontend ("All Companies"
// tab) expects, including the legacy BOM-prefixed "CIN" key, plus the full
// set of ROC fields so the detail page can show everything.
const toFrontendShape = (c) => ({
  "﻿CIN": c.cin || "",
  "Company Name": c.companyName || "",
  "NIC Code": c.nicCode || "",
  "Company Registration Date": c.registrationDate || "",
  "Company Status": c.companyStatus || "",
  "Company Industrial Classification": c.industrialClassification || "",
  "Company State Code": c.stateCode || "",
  // Additional fields kept within the free-tier budget:
  "Company Class": c.companyClass || "",
  "Authorized Capital": c.authorizedCapital ?? null,
  "Paidup Capital": c.paidupCapital ?? null,
  "Registered Office Address": c.registeredOfficeAddress || "",
});

const getCSVCompanies = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "20", 10) || 20));
    const search = (req.query.search || "").trim();

    const filter = search
      ? { companyName: { $regex: escapeRegex(search), $options: "i" } }
      : {};

    // estimatedDocumentCount is O(1) for the unfiltered case (~1M docs).
    const total = search
      ? await Company.countDocuments(filter)
      : await Company.estimatedDocumentCount();

    const totalPages = Math.ceil(total / limit);

    // Sort by _id (default index) — there is no companyName index on the
    // free tier, and sorting on an unindexed field over ~1M docs would fail.
    const docs = await Company.find(filter)
      .sort({ _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const companies = docs.map(toFrontendShape);

    return res.json({
      success: true,
      total,
      page,
      limit,
      totalPages,
      nextPage: page < totalPages ? page + 1 : null,
      prevPage: page > 1 ? page - 1 : null,
      companies,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// GET /api/business/companies/:cin — fetch a single ROC company by CIN so the
// detail page works on direct load/refresh (not only via the list).
const getCompanyByCin = async (req, res) => {
  try {
    const cin = decodeURIComponent(req.params.cin || "").trim();
    if (!cin) return res.status(400).json({ success: false, message: "CIN is required" });

    const doc = await Company.findOne({ cin }).lean();
    if (!doc) return res.status(404).json({ success: false, message: "Company not found" });

    return res.json({ success: true, company: toFrontendShape(doc) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};



module.exports = {
  getCompanyByCin,
  registerBusiness,
  addAuctionDetails,
  uploadBusinessDocuments,
  getAllBusinesses,
  getBusinessById,
  deleteBusiness,
  getCSVCompanies,
};
