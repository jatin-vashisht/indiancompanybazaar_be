// config/s3.js — defensive: never throw at require time so a missing/typo'd
// env var can't crash the whole backend. s3 is null when not configured.
let S3Client;
try {
  ({ S3Client } = require("@aws-sdk/client-s3"));
} catch (e) {
  console.warn("⚠️  @aws-sdk/client-s3 not installed — run `npm install`. Uploads disabled.");
}

const S3_BUCKET = process.env.S3_BUCKET;
const isConfigured =
  !!S3Client &&
  !!S3_BUCKET &&
  !!process.env.AWS_REGION &&
  !!process.env.AWS_ACCESS_KEY_ID &&
  !!process.env.AWS_SECRET_ACCESS_KEY;

let s3 = null;
if (isConfigured) {
  s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
} else {
  console.warn("⚠️  S3 is not fully configured (region/bucket/keys). File uploads will be disabled.");
}

module.exports = { s3, S3_BUCKET, isS3Configured: isConfigured };
