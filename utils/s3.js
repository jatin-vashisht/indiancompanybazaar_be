// utils/s3.js — helpers for private S3 objects + presigned URLs
const { GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { s3, S3_BUCKET } = require("../config/s3");

// Generate a short-lived presigned GET URL for a private object key.
async function getPresignedUrl(key, expiresIn = 3600) {
  if (!key) return null;
  try {
    const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
    return await getSignedUrl(s3, command, { expiresIn });
  } catch (err) {
    console.error("Presign error for key", key, err.message);
    return null;
  }
}

async function deleteObject(key) {
  if (!key) return;
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  } catch (err) {
    console.error("S3 delete error for key", key, err.message);
  }
}

// Presign every document in a business's documents[] (adds a fresh `url`).
async function signBusinessDocuments(business) {
  if (!business || !Array.isArray(business.documents)) return business;
  const obj = typeof business.toObject === "function" ? business.toObject() : business;
  obj.documents = await Promise.all(
    obj.documents.map(async (doc) => ({
      ...doc,
      url: doc.key ? await getPresignedUrl(doc.key) : doc.url || null,
    }))
  );
  return obj;
}

module.exports = { getPresignedUrl, deleteObject, signBusinessDocuments };
