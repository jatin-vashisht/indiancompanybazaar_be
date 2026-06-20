// middleware/upload.js — uploads to a PRIVATE S3 bucket via multer-s3.
// Defensive: if S3 isn't configured (or deps missing), fall back to a stub
// that rejects uploads with a clear error instead of crashing the server.
const multer = require("multer");
const crypto = require("crypto");
const path = require("path");
const { s3, S3_BUCKET, isS3Configured } = require("../config/s3");

let multerS3 = null;
try {
  multerS3 = require("multer-s3");
} catch (e) {
  console.warn("⚠️  multer-s3 not installed — run `npm install`. Uploads disabled.");
}

const ALLOWED = [".jpg", ".jpeg", ".png", ".pdf", ".doc", ".docx"];

let upload;

if (isS3Configured && multerS3) {
  upload = multer({
    storage: multerS3({
      s3,
      bucket: S3_BUCKET,
      contentType: multerS3.AUTO_CONTENT_TYPE,
      // No ACL — bucket stays private; files served via presigned URLs.
      metadata: (req, file, cb) => cb(null, { fieldName: file.fieldname }),
      key: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const base = path
          .basename(file.originalname, ext)
          .replace(/[^a-zA-Z0-9-_]/g, "_")
          .slice(0, 40);
        const unique = crypto.randomBytes(8).toString("hex");
        cb(null, `business-documents/${Date.now()}-${unique}-${base}${ext}`);
      },
    }),
    limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (ALLOWED.includes(ext)) cb(null, true);
      else cb(new Error(`Unsupported file type: ${ext}`));
    },
  });
} else {
  // Fallback stub: parse nothing, return 503 so the route fails cleanly.
  const noop = (req, res) =>
    res.status(503).json({ message: "File uploads are not configured (S3 unavailable)." });
  upload = {
    single: () => noop,
    array: () => noop,
    fields: () => noop,
    any: () => noop,
  };
}

module.exports = upload;
