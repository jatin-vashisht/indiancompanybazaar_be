/**
 * One-time migration: pull any existing business document files that live on
 * external URLs (Cloudinary, etc.) into the private S3 bucket, and replace
 * the stored `url` with an S3 `key`. After this, all file data is on S3.
 *
 * Usage: node migrateFilesToS3.js
 * Requires env: MONGO_URI, AWS_REGION, S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
 */
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");
const crypto = require("crypto");
dotenv.config();

const { PutObjectCommand } = require("@aws-sdk/client-s3");
const { s3, S3_BUCKET, isS3Configured } = require("./config/s3");
const Business = require("./models/Business");

const guessExt = (url, contentType) => {
  const fromUrl = path.extname(new URL(url).pathname);
  if (fromUrl) return fromUrl;
  if (/pdf/.test(contentType)) return ".pdf";
  if (/png/.test(contentType)) return ".png";
  if (/jpe?g/.test(contentType)) return ".jpg";
  return "";
};

async function main() {
  if (!isS3Configured) throw new Error("S3 is not configured (check AWS_* env vars)");
  await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

  const businesses = await Business.find({ "documents.0": { $exists: true } });
  let migrated = 0,
    skipped = 0,
    failed = 0;

  for (const biz of businesses) {
    let changed = false;
    for (const doc of biz.documents) {
      if (doc.key) {
        skipped++;
        continue;
      } // already on S3
      if (!doc.url) {
        skipped++;
        continue;
      }
      try {
        const resp = await fetch(doc.url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const contentType = resp.headers.get("content-type") || "application/octet-stream";
        const buf = Buffer.from(await resp.arrayBuffer());
        const ext = guessExt(doc.url, contentType);
        const safe = String(doc.name || "document")
          .replace(/[^a-zA-Z0-9-_]/g, "_")
          .slice(0, 40);
        const key = `business-documents/migrated/${biz._id}-${crypto
          .randomBytes(4)
          .toString("hex")}-${safe}${ext}`;

        await s3.send(
          new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: buf, ContentType: contentType })
        );

        doc.key = key;
        doc.url = undefined; // served via presigned URL now
        changed = true;
        migrated++;
        console.log(`✓ ${biz.companyName || biz._id}: ${doc.name} -> ${key}`);
      } catch (err) {
        failed++;
        console.warn(`✗ ${biz.companyName || biz._id}: ${doc.name} (${doc.url}) — ${err.message}`);
      }
    }
    if (changed) await biz.save();
  }

  console.log(`\n✅ Migration done. migrated: ${migrated}, skipped: ${skipped}, failed: ${failed}`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ Migration failed:", e.message);
  process.exit(1);
});
