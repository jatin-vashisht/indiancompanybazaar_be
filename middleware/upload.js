// middleware/upload.js — uploads to a PRIVATE S3 bucket via multer-s3
const multer = require("multer");
const multerS3 = require("multer-s3");
const crypto = require("crypto");
const path = require("path");
const { s3, S3_BUCKET } = require("../config/s3");

const ALLOWED = [".jpg", ".jpeg", ".png", ".pdf", ".doc", ".docx"];

const upload = multer({
  storage: multerS3({
    s3,
    bucket: S3_BUCKET,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    // No ACL — the bucket stays private; files are served via presigned URLs.
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

module.exports = upload;
