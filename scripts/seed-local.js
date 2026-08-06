// SAFE local seed — refuses to run against anything but a localhost Mongo.
// Seeds users (with capabilities), seller businesses, and a few ROC companies.
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const User = require("../models/User");
const Business = require("../models/Business");
const Company = require("../models/Company");

const uri = process.env.MONGO_URI || "";
if (!/127\.0\.0\.1|localhost/.test(uri)) {
  console.error("REFUSING TO SEED: MONGO_URI is not local:", uri);
  process.exit(1);
}

async function run() {
  await mongoose.connect(uri);
  await Promise.all([User.deleteMany({}), Business.deleteMany({}), Company.deleteMany({})]);

  const hash = (pw) => bcrypt.hashSync(pw, 10);

  const [admin, seller, buyer, ca, dual] = await User.create([
    { name: "Admin User", email: "admin@test.com", password: hash("Password@123"), role: "admin", isVerified: true, canBuy: true, canSell: true },
    { name: "Sam Seller", email: "seller@test.com", password: hash("Password@123"), role: "seller", isVerified: true, canBuy: false, canSell: true },
    { name: "Bina Buyer", email: "buyer@test.com", password: hash("Password@123"), role: "buyer", isVerified: true, canBuy: true, canSell: false },
    { name: "Chandra CA", email: "ca@test.com", password: hash("Password@123"), role: "ca", isVerified: true, canBuy: true, canSell: true },
    { name: "Second Seller", email: "seller2@test.com", password: hash("Password@123"), role: "seller", isVerified: true, canBuy: false, canSell: true },
  ]);

  await Business.create([
    {
      seller: seller._id, CIN: "U55100AN2009PTC000115", companyName: "U AND I RESORTS PRIVATE LIMITED",
      registrationNumber: "000115", registeredAddress: "HAVELOCK, PORT BLAIR, Andaman", subCategory: "Hospitality",
      categoryOfCompany: "Company limited by Shares", classOfCompany: "Private", authorizedCapital: 1000000, paidUpCapital: 989630,
      dateOfIncorporation: new Date("2009-06-18"), dateOfBalanceSheet: new Date("2023-03-31"), companyStatus: "Active",
      description: "A resort business in the Andaman islands.", stakePercentage: 40, closureTimeline: "3 months",
      verified: true, directors: [{ name: "Ravi Kumar", DIN: "01234567", role: "Director", isSignatory: true }],
      auctionDetails: [{ startingBidAmount: 50000, startTime: new Date(Date.now() - 86400000), endTime: new Date(Date.now() + 7 * 86400000) }],
    },
    {
      seller: seller._id, CIN: "U72900DL2015PTC111222", companyName: "V & N SMART WORLD PRIVATE LIMITED",
      registrationNumber: "111222", registeredAddress: "R-552, Shankar Road, New Delhi, 110060", subCategory: "Business Services",
      categoryOfCompany: "Company limited by Shares", classOfCompany: "Private", authorizedCapital: 5000000, paidUpCapital: 3200000,
      dateOfIncorporation: new Date("2015-01-19"), dateOfBalanceSheet: new Date("2023-03-31"), companyStatus: "Active",
      description: "A smart-tech services company.", stakePercentage: 26, closureTimeline: "6 months",
      verified: true, directors: [{ name: "Neha Singh", DIN: "07654321", role: "Director", isSignatory: true }],
      auctionDetails: [{ startingBidAmount: 120000, startTime: new Date(Date.now() - 86400000), endTime: new Date(Date.now() + 5 * 86400000) }],
    },
    {
      seller: dual._id, CIN: "U63040AN2012PTC000168", companyName: "ANDAMAN WORLD TRAVELS PRIVATE LIMITED",
      registrationNumber: "000168", registeredAddress: "Aberdeen Bazaar, Port Blair, Andaman", subCategory: "Transport, storage and Communications",
      categoryOfCompany: "Company limited by Shares", classOfCompany: "Private", authorizedCapital: 2000000, paidUpCapital: 1500000,
      dateOfIncorporation: new Date("2012-01-21"), dateOfBalanceSheet: new Date("2023-03-31"), companyStatus: "Active",
      description: "Travel and tourism services.", stakePercentage: 51, closureTimeline: "2 months",
      verified: true, directors: [], auctionDetails: [{ startingBidAmount: 90000, startTime: new Date(Date.now() - 86400000), endTime: new Date(Date.now() + 9 * 86400000) }],
    },
    {
      // an UNVERIFIED listing — should not appear in public browse
      seller: seller._id, CIN: "U99999DL2020PTC999999", companyName: "PENDING REVIEW PRIVATE LIMITED",
      registrationNumber: "999999", registeredAddress: "Somewhere, Delhi", subCategory: "Business Services",
      classOfCompany: "Private", authorizedCapital: 100000, paidUpCapital: 100000, companyStatus: "Active",
      description: "Awaiting admin verification.", verified: false, directors: [], auctionDetails: [],
    },
  ]);

  // A handful of ROC master-data companies for the All Companies tab.
  await Company.create([
    { cin: "U55100AN2009PTC000115", companyName: "U AND I RESORTS PRIVATE LIMITED", companyClass: "Private", authorizedCapital: 1000000, paidupCapital: 989630, registrationDate: "2009-06-18", registeredOfficeAddress: "HAVELOCK, PORT BLAIR, Andaman", companyStatus: "Active", stateCode: "AN", nicCode: "55100", industrialClassification: "Trading" },
    { cin: "U55200AN2021PTC005554", companyName: "JUNGLEVILLA RESORT & SPA PRIVATE LIMITED", companyClass: "Private", authorizedCapital: 2000000, paidupCapital: 1500000, registrationDate: "2021-10-13", registeredOfficeAddress: "Havelock, Andaman", companyStatus: "Active", stateCode: "AN", nicCode: "55200", industrialClassification: "Trading" },
    { cin: "U55209AN2018PTC005409", companyName: "CORAL ISLAND BEACH RESORT PRIVATE LIMITED", companyClass: "Private", authorizedCapital: 3000000, paidupCapital: 2500000, registrationDate: "2018-05-31", registeredOfficeAddress: "Neil Island, Andaman", companyStatus: "Active", stateCode: "AN", nicCode: "55209", industrialClassification: "Trading" },
    { cin: "U63031AN2019PTC005474", companyName: "INFO INDIA TOUR AND HOLIDAYS PRIVATE LIMITED", companyClass: "Private", authorizedCapital: 500000, paidupCapital: 400000, registrationDate: "2019-11-21", registeredOfficeAddress: "Port Blair, Andaman", companyStatus: "Active", stateCode: "AN", nicCode: "63031", industrialClassification: "Transport, storage and Communications" },
    { cin: "U63040AN1999PTC000061", companyName: "ANDAMAN TOURIST COTTAGE PRIVATE LIMITED", companyClass: "Private", authorizedCapital: 800000, paidupCapital: 600000, registrationDate: "1999-04-26", registeredOfficeAddress: "Port Blair, Andaman", companyStatus: "Strike Off", stateCode: "AN", nicCode: "63040", industrialClassification: "Transport, storage and Communications" },
    { cin: "U63040AN2012PTC000168", companyName: "ANDAMAN WORLD TRAVELS PRIVATE LIMITED", companyClass: "Private", authorizedCapital: 2000000, paidupCapital: 1500000, registrationDate: "2012-01-21", registeredOfficeAddress: "Aberdeen Bazaar, Port Blair, Andaman", companyStatus: "Active", stateCode: "AN", nicCode: "63040", industrialClassification: "Transport, storage and Communications" },
  ]);

  console.log("Seeded users:", (await User.countDocuments()), "businesses:", (await Business.countDocuments()), "companies:", (await Company.countDocuments()));
  console.log("Logins (all password 'Password@123'): admin@test.com, seller@test.com, buyer@test.com, ca@test.com, seller2@test.com");
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((e) => { console.error(e); process.exit(1); });
