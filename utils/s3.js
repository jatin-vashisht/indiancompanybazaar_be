// utils/s3.js — helpers for private S3 objects + presigned URLs.
// Defensive: never throw at require; degrade gracefully when S3 is off.
const { s3, S3_BUCKET, isS3Configured } = require("../config/s3");

let GetObjectCommand, DeleteObjectCommand, getSignedUrl;
try {
  ({ GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3"));
  ({ getSignedUrl } = require("@aws-sdk/s3-request-presigner"));
} catch (e) {
  /* AWS SDK not installed — helpers below no-op */
}

// Presigned GET URL for a private object key (null if S3 unavailable).
async function getPresignedUrl(key, expiresIn = 3600) {
  if (!key || !isS3Configured || !s3 || !getSignedUrl) return null;
  try {
    const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
    return await getSignedUrl(s3, command, { expiresIn });
  } catch (err) {
    console.error("Presign error for key", key, err.message);
    return null;
  }
}

async function deleteObject(key) {
  if (!key || !isS3Configured || !s3 || !DeleteObjectCommand) return;
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  } catch (err) {
    console.error("S3 delete error for key", key, err.message);
  }
}

// Presign every document in a business's documents[] (adds a fresh `url`).
async function signBusinessDocuments(business) {
  if (!business) return business;
  const obj = typeof business.toObject === "function" ? business.toObject() : business;
  if (!Array.isArray(obj.documents)) return obj;
  obj.documents = await Promise.all(
    obj.documents.map(async (doc) => ({
      ...doc,
      url: doc.key ? (await getPresignedUrl(doc.key)) || doc.url || null : doc.url || null,
    }))
  );
  return obj;
}

module.exports = { getPresignedUrl, deleteObject, signBusinessDocuments };
