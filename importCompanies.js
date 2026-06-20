/**
 * Ingest ROC company master data (state-wise CSV exports) into MongoDB.
 *
 * Usage:
 *   node importCompanies.js
 *   DATA_DIR=/path/to/csvs node importCompanies.js
 *
 * - Reads every *.csv in DATA_DIR (default: ~/Desktop/personal/icb_data)
 * - Clears the existing `companies` collection, then streams + batch-inserts
 *   all rows (memory-safe, handles the 129MB delhi.csv)
 * - Backs the GET /api/business/all-companies endpoint.
 *
 * Re-runnable: it always wipes the collection first, so it "removes the
 * current listing and adds this".
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const csv = require("csv-parser");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
dotenv.config();

const Company = require("./models/Company");

const DATA_DIR =
  process.env.DATA_DIR || path.join(os.homedir(), "Desktop", "personal", "icb_data");
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "2000", 10);
// Stop before the free Atlas tier's 512MB ceiling so a re-run can never
// block writes on the production cluster. Measured as logical dataSize +
// indexSize (what Atlas counts toward the quota).
const MAX_LOGICAL_MB = parseInt(process.env.MAX_LOGICAL_MB || "480", 10);

const clean = (v) => (v === undefined || v === null ? undefined : String(v).trim() || undefined);
const toNumber = (v) => {
  if (v === undefined || v === null || String(v).trim() === "") return undefined;
  const n = parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
};

// Map a CSV row (headers BOM-stripped + trimmed) to a full Company document.
function mapRow(row) {
  return {
    cin: clean(row["CIN"]),
    companyName: clean(row["CompanyName"]),
    rocCode: clean(row["CompanyROCcode"]),
    category: clean(row["CompanyCategory"]),
    subCategory: clean(row["CompanySubCategory"]),
    companyClass: clean(row["CompanyClass"]),
    authorizedCapital: toNumber(row["AuthorizedCapital"]),
    paidupCapital: toNumber(row["PaidupCapital"]),
    registrationDate: clean(row["CompanyRegistrationdate_date"]),
    registeredOfficeAddress: clean(row["Registered_Office_Address"]),
    listingStatus: clean(row["Listingstatus"]),
    companyStatus: clean(row["CompanyStatus"]),
    stateCode: clean(row["CompanyStateCode"]),
    indianForeign: clean(row["CompanyIndian/Foreign Company"]),
    nicCode: clean(row["nic_code"]),
    industrialClassification: clean(row["CompanyIndustrialClassification"]),
  };
}

// Logical storage used (MB), as Atlas counts it toward the quota.
async function usedMB() {
  const s = await mongoose.connection.db.stats();
  return (s.dataSize + s.indexSize) / (1024 * 1024);
}

class QuotaReached extends Error {}

function importFile(filePath) {
  return new Promise((resolve, reject) => {
    let batch = [];
    let inserted = 0;
    let pending = Promise.resolve();

    const stream = fs.createReadStream(filePath).pipe(
      csv({
        // Strip BOM and surrounding whitespace from header names so e.g.
        // "﻿CIN" and " CIN " both resolve to "CIN".
        mapHeaders: ({ header }) => header.replace(/^﻿/, "").trim(),
      })
    );

    let batchesSinceCheck = 0;
    const flush = async (rows) => {
      if (!rows.length) return;
      await Company.insertMany(rows, { ordered: false });
      inserted += rows.length;
      process.stdout.write(`\r   ${path.basename(filePath)}: ${inserted} rows`);
      // Every ~20k rows, verify we're still safely under the tier quota.
      if (++batchesSinceCheck >= 10) {
        batchesSinceCheck = 0;
        const mb = await usedMB();
        if (mb >= MAX_LOGICAL_MB) {
          throw new QuotaReached(`Storage guard tripped at ${mb.toFixed(0)}MB (limit ${MAX_LOGICAL_MB}MB)`);
        }
      }
    };

    let stopped = false;
    const fail = (err) => {
      if (stopped) return;
      stopped = true;
      stream.destroy();
      if (err instanceof QuotaReached) {
        process.stdout.write("\n");
        resolve({ inserted, quotaReached: true });
      } else {
        reject(err);
      }
    };

    stream.on("data", (row) => {
      if (stopped) return;
      const doc = mapRow(row);
      if (!doc.cin && !doc.companyName) return; // skip blank/garbage lines
      batch.push(doc);
      if (batch.length >= BATCH_SIZE) {
        const rows = batch;
        batch = [];
        stream.pause();
        pending = pending
          .then(() => flush(rows))
          .then(() => !stopped && stream.resume())
          .catch(fail);
      }
    });

    stream.on("end", () => {
      pending
        .then(() => flush(batch))
        .then(() => {
          if (stopped) return;
          process.stdout.write("\n");
          resolve({ inserted, quotaReached: false });
        })
        .catch(fail);
    });

    stream.on("error", fail);
  });
}

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set in .env");
  if (!fs.existsSync(DATA_DIR)) throw new Error(`DATA_DIR not found: ${DATA_DIR}`);

  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.toLowerCase().endsWith(".csv"))
    .map((f) => path.join(DATA_DIR, f));

  if (!files.length) throw new Error(`No CSV files in ${DATA_DIR}`);

  console.log(`Connecting to MongoDB...`);
  await mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  console.log(`Clearing existing companies collection...`);
  await Company.deleteMany({});

  console.log(`Importing ${files.length} CSV file(s) from ${DATA_DIR}\n`);
  let grandTotal = 0;
  let hitQuota = false;
  for (const file of files) {
    const { inserted, quotaReached } = await importFile(file);
    grandTotal += inserted;
    if (quotaReached) {
      hitQuota = true;
      break;
    }
  }

  const finalMB = await usedMB();
  if (hitQuota) {
    console.log(
      `\n⚠️  Stopped early at the storage guard (${finalMB.toFixed(0)}MB). ` +
        `Imported ${grandTotal} companies before reaching the free-tier limit.`
    );
  } else {
    console.log(`\n✅ Done. Imported ${grandTotal} companies (${finalMB.toFixed(0)}MB used).`);
  }
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("\n❌ Import failed:", err.message);
  process.exit(1);
});
