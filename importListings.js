/**
 * Seed the "Browse Companies" tab (GET /api/business) with the 5 companies
 * from KahemIndia_Company_Listing_Form.xlsx.
 *
 * Each listing is upserted into the `businesses` collection as a verified
 * listing, enriched from the `companies` collection (ROC master data) by CIN
 * for incorporation date, status, address, capital, sector, etc. All other
 * businesses are set verified:false so only these show for buyers (admins/CA
 * still see everything). Non-destructive and re-runnable.
 *
 * Usage: node importListings.js     (or: npm run import:listings)
 */
const mongoose = require("mongoose");
const dotenv = require("dotenv");
dotenv.config();

const Company = require("./models/Company");
const Business = require("./models/Business");

// Source data from the listing form (only these fields were filled in).
const LISTINGS = [
  { cin: "U52590DL2018PTC334496", companyName: "WENXU IMPEX (I) PRIVATE LIMITED", startingBid: 500000, stake: 100, timeline: "1 month" },
  { cin: "U74999DL2019PTC346712", companyName: "AMEVA CORPORATE SUPPORT AND ENGINEERING SERVICES PRIVATE LIMITED", startingBid: 400000, stake: 100, timeline: "1 month" },
  { cin: "U63030DL2021PTC381086", companyName: "BLUEKO LOGISTICS PRIVATE LIMITED", startingBid: 600000, stake: 100, timeline: "1 month" },
  { cin: "U74999DL2016PTC303978", companyName: "SISDY ESTYLO PRIVATE LIMITED", startingBid: 800000, stake: 100, timeline: "1 month" },
  { cin: "U72200DL2021PTC375885", companyName: "V & N SMART WORLD PRIVATE LIMITED", startingBid: 45000000, stake: 100, timeline: "6 Month" },
];

// "1 month" / "6 Month" -> number of days
function timelineToDays(t) {
  const m = String(t || "").match(/(\d+)\s*month/i);
  return m ? parseInt(m[1], 10) * 30 : 30;
}

const titleCase = (s) =>
  String(s || "").replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set in .env");
  await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

  const seller = await mongoose.connection.db
    .collection("users")
    .findOne({ role: "seller" });
  if (!seller) throw new Error("No seller user found to own the listings");

  const now = new Date();
  const upsertedIds = [];

  for (const item of LISTINGS) {
    const c = (await Company.findOne({ cin: item.cin }).lean()) || {};
    const endTime = new Date(now.getTime() + timelineToDays(item.timeline) * 24 * 60 * 60 * 1000);

    const doc = {
      seller: seller._id,
      CIN: item.cin,
      companyName: item.companyName,
      registrationNumber: item.cin,
      ROC: c.rocCode || "",
      registeredAddress: c.registeredOfficeAddress || "",
      // The card derives "sector" from category/subCategory/classOfCompany;
      // put the ROC industry there so it reads meaningfully.
      categoryOfCompany: c.industrialClassification || c.category || "",
      subCategory: c.industrialClassification || c.subCategory || "",
      classOfCompany: c.companyClass || "",
      listedInStockExchange: false,
      authorizedCapital: c.authorizedCapital ?? undefined,
      paidUpCapital: c.paidupCapital ?? undefined,
      dateOfIncorporation: c.registrationDate ? new Date(c.registrationDate) : undefined,
      companyStatus: c.companyStatus || "Active",
      description:
        `${item.stake}% stake available for sale. ` +
        `Expected closure timeline: ${item.timeline}. ` +
        (c.industrialClassification ? `Industry: ${c.industrialClassification}. ` : "") +
        (c.stateCode ? `Registered in ${titleCase(c.stateCode)}.` : ""),
      auctionDetails: [
        { startingBidAmount: item.startingBid, startTime: now, endTime, createdAt: now },
      ],
      verified: true,
      updatedAt: now,
    };

    const res = await Business.findOneAndUpdate(
      { CIN: item.cin, seller: seller._id },
      { $set: doc, $setOnInsert: { createdAt: now } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    upsertedIds.push(res._id);
    console.log(`✓ ${item.companyName} (${item.cin}) -> ${res._id}`);
  }

  // Show ONLY these listings in Browse Companies: hide every other business
  // from buyers (admins/CA still see all). Reversible (sets a flag).
  const hidden = await Business.updateMany(
    { _id: { $nin: upsertedIds } },
    { $set: { verified: false } }
  );
  console.log(`\nHid ${hidden.modifiedCount} other business(es) from Browse Companies.`);
  console.log(`✅ Done. ${upsertedIds.length} verified listings are now live.`);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Listings import failed:", err.message);
  process.exit(1);
});
