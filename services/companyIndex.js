/**
 * In-memory company index backed by the scraped JSONL on S3.
 *
 * Replaces the MongoDB `companies` collection as the data source for the
 * All-Companies list + detail routes. It loads every state folder under
 * s3://<bucket>/<prefix>/json/<state>/*.jsonl, MERGES them into one dataset,
 * and serves paginated + searchable results from memory.
 *
 * Design notes:
 * - LEAN projection only (the fields the frontend list/detail need), so ~500k
 *   companies fit in a few hundred MB.
 * - INCREMENTAL refresh: each chunk file is immutable once full, so on refresh
 *   we only download files that are new or have grown (by size), upserting into
 *   the live maps. This avoids doubling memory (no full rebuild) and is cheap.
 * - Records are stored once in `byCin`; `byId` and `sorted` hold references.
 */
const crypto = require("crypto");
const readline = require("readline");
const { S3Client, ListObjectsV2Command, GetObjectCommand, SelectObjectContentCommand } = require("@aws-sdk/client-s3");

const BUCKET = process.env.S3_BUCKET || "kahemindia";
const PREFIX = (process.env.S3_PREFIX || "scrapper-data").replace(/\/+$/, "") + "/json/";
const REGION = process.env.AWS_REGION || "ap-south-1";
const REFRESH_MS = (parseInt(process.env.COMPANY_INDEX_REFRESH_MIN || "30", 10) || 30) * 60 * 1000;

const s3 = new S3Client({ region: REGION });

let byCin = new Map();          // cin -> lean record
let byId = new Map();           // id  -> lean record (id = short hash of cin, keeps CIN out of URLs)
let sorted = [];                // records sorted by cin, for stable pagination
const loadedFiles = new Map();  // s3 key -> size already ingested (skip unchanged)
const keys = [];                // interned S3 keys (so each lean record only stores an int index)
const keyToIdx = new Map();
let ready = false;
let loadingPromise = null;

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function idFor(cin) {
  return crypto.createHash("sha1").update(cin).digest("hex").slice(0, 16);
}

// Map a raw JSONL record (CSV fields + tofler-enriched fields) to the lean
// shape the frontend needs. Prefer the enriched (tofler) value, fall back to
// the original CSV field.
function project(rec, stateFolder) {
  const cin = String(rec.CIN || rec.cin || "").trim();
  if (!cin) return null;
  const companyName = String(rec.CompanyName || rec.company_name || "").trim();
  return {
    id: idFor(cin),
    cin,
    companyName,
    nameLower: companyName.toLowerCase(),
    nicCode: rec.nic_code || rec.NIC_Code || "",
    registrationDate: rec.date_of_incorporation || rec.CompanyRegistrationdate_date || "",
    companyStatus: rec.status || rec.CompanyStatus || "",
    industrialClassification: rec.industry || rec.CompanyIndustrialClassification || "",
    stateCode: rec.CompanyStateCode || stateFolder || "",
    listingStatus: rec.listing_status || rec.Listingstatus || "",
    companyClass: rec.company_class || rec.CompanyClass || "",
    authorizedCapital: toNum(rec.authorized_capital != null ? rec.authorized_capital : rec.AuthorizedCapital),
    paidupCapital: toNum(rec.paid_up_capital != null ? rec.paid_up_capital : rec.PaidupCapital),
  };
}

function stateFromKey(key) {
  const rest = key.slice(PREFIX.length).split("/");
  return rest.length > 1 ? rest[0] : "";
}

async function listJsonlFiles() {
  const files = [];
  let token;
  do {
    const out = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET, Prefix: PREFIX, ContinuationToken: token,
    }));
    for (const o of out.Contents || []) {
      if (o.Key.endsWith(".jsonl")) files.push({ key: o.Key, size: o.Size });
    }
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
  return files;
}

async function loadFile(key) {
  const stateFolder = stateFromKey(key);
  let ki = keyToIdx.get(key);
  if (ki === undefined) { ki = keys.length; keys.push(key); keyToIdx.set(key, ki); }
  const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const rl = readline.createInterface({ input: out.Body, crlfDelay: Infinity });
  let n = 0;
  for await (const line of rl) {
    const s = line.trim();
    if (!s) continue;
    let rec;
    try { rec = JSON.parse(s); } catch { continue; }
    const p = project(rec, stateFolder);
    if (!p) continue;
    p.k = ki;              // which S3 file this record lives in (for on-demand detail)
    byCin.set(p.cin, p);   // upsert — latest occurrence of a CIN wins
    byId.set(p.id, p);
    n++;
  }
  return n;
}

// Fetch the FULL enriched record (all fields incl. directors) on demand by
// streaming the one chunk file it lives in and scanning for the CIN line. Keeps
// the in-memory index lean while the detail page gets everything. (S3 Select is
// not available on this bucket, so we use plain GetObject + a cheap substring
// pre-filter before parsing.)
async function fetchFullRecord(key, cin) {
  const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const rl = readline.createInterface({ input: out.Body, crlfDelay: Infinity });
  let found = null;
  for await (const line of rl) {
    if (!line || line.indexOf(cin) === -1) continue; // skip parse unless CIN present
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (String(r.CIN || r.cin || "") === cin) { found = r; break; }
  }
  rl.close();
  if (out.Body && typeof out.Body.destroy === "function") out.Body.destroy();
  return found;
}

async function getFullRecord(leanRec) {
  if (!leanRec) return null;
  const key = keys[leanRec.k];
  if (!key) return null;
  try {
    return await fetchFullRecord(key, leanRec.cin);
  } catch (e) {
    console.error("[companyIndex] full-record fetch failed for", leanRec.cin, "-", e.message);
    return null;
  }
}

async function refresh() {
  const files = await listJsonlFiles();
  let changed = false;
  for (const f of files) {
    if (loadedFiles.get(f.key) === f.size) continue; // unchanged chunk -> skip
    await loadFile(f.key);
    loadedFiles.set(f.key, f.size);
    changed = true;
  }
  if (changed || sorted.length !== byCin.size) {
    sorted = Array.from(byCin.values()).sort((a, b) =>
      a.cin < b.cin ? -1 : a.cin > b.cin ? 1 : 0
    );
  }
  ready = true;
  return { files: files.length, companies: byCin.size };
}

// First caller awaits the in-flight load; subsequent calls are instant.
function ensureLoaded() {
  if (ready) return Promise.resolve();
  if (!loadingPromise) {
    loadingPromise = refresh().catch((e) => { loadingPromise = null; throw e; });
  }
  return loadingPromise;
}

// Kick off initial load + periodic background refresh (call once at boot).
function start() {
  ensureLoaded()
    .then((r) => console.log(`[companyIndex] loaded ${r.companies} companies from ${r.files} S3 files`))
    .catch((e) => console.error("[companyIndex] initial load failed:", e.message));
  setInterval(() => {
    refresh()
      .then((r) => console.log(`[companyIndex] refreshed: ${r.companies} companies, ${r.files} files`))
      .catch((e) => console.error("[companyIndex] refresh failed:", e.message));
  }, REFRESH_MS).unref();
}

function query({ page = 1, limit = 20, search = "" }) {
  let list = sorted;
  const q = String(search || "").trim().toLowerCase();
  if (q) list = list.filter((r) => r.nameLower.includes(q));
  const total = list.length;
  const totalPages = Math.ceil(total / limit) || 0;
  const startIdx = (page - 1) * limit;
  return { items: list.slice(startIdx, startIdx + limit), total, totalPages };
}

module.exports = {
  start,
  ensureLoaded,
  query,
  getByCin: (cin) => byCin.get(String(cin || "").trim()),
  getById: (id) => byId.get(String(id || "").trim()),
  // Full enriched record (directors, ROC, category, AGM, etc.) for the detail page.
  getFullByCin: (cin) => getFullRecord(byCin.get(String(cin || "").trim())),
  getFullById: (id) => getFullRecord(byId.get(String(id || "").trim())),
  stats: () => ({ ready, companies: byCin.size, files: loadedFiles.size }),
};
