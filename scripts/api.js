#!/usr/bin/env node
// api.js — queryable index over the OpenAPI spec.
//
// The spec is generated fresh from the @swagger JSDoc blocks in routes/*.js on
// every run, so it can never drift from the code. Nothing is checked in.
//
//   node scripts/api.js list                    one line per endpoint
//   node scripts/api.js list auth               ...filtered by tag/path substring
//   node scripts/api.js show POST /api/auth/login
//   node scripts/api.js search razorpay         match path, summary, description
//   node scripts/api.js schema Business         one component schema
//   node scripts/api.js json [> spec.json]      the whole spec, if you really want it
//
// Designed so an AI agent reads ~600 tokens to see every route, then ~300 more
// for the one endpoint it actually needs.

const path = require("path");
const swaggerJsDoc = require("swagger-jsdoc");

const ROOT = path.resolve(__dirname, "..");

function buildSpec() {
  return swaggerJsDoc({
    definition: {
      openapi: "3.0.0",
      info: {
        title: "Kahem India API",
        version: "1.0.0",
        description: "India's Trusted Business Marketplace",
      },
      servers: [
        { url: "https://api.kahemindia.com", description: "Production" },
        { url: "http://localhost:5000", description: "Local" },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
            description: "Authorization: Bearer <jwt>",
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    apis: [path.join(ROOT, "routes", "*.js")],
  });
}

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

function operations(spec) {
  const out = [];
  for (const [p, item] of Object.entries(spec.paths || {})) {
    for (const method of METHODS) {
      if (item[method]) out.push({ method, path: p, op: item[method] });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

// Resolve $ref chains so `show` prints real shapes, not pointers.
function deref(node, spec, seen = new Set(), depth = 0) {
  if (node == null || typeof node !== "object" || depth > 12) return node;
  if (typeof node.$ref === "string") {
    const ref = node.$ref;
    if (seen.has(ref)) return { $circular: ref };
    const target = ref
      .replace(/^#\//, "")
      .split("/")
      .reduce((acc, key) => (acc == null ? acc : acc[decodeURIComponent(key.replace(/~1/g, "/").replace(/~0/g, "~"))]), spec);
    if (target === undefined) return { $unresolved: ref };
    return deref(target, spec, new Set([...seen, ref]), depth + 1);
  }
  if (Array.isArray(node)) return node.map((n) => deref(n, spec, seen, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = deref(v, spec, seen, depth + 1);
  return out;
}

function authOf(op, spec) {
  const sec = op.security !== undefined ? op.security : spec.security;
  if (!sec || sec.length === 0) return "public";
  const names = sec.flatMap((s) => Object.keys(s)).filter(Boolean);
  return names.length ? names.join("+") : "public";
}

// --- commands ----------------------------------------------------------------

function cmdList(spec, filter) {
  const rows = operations(spec).filter((r) => {
    if (!filter) return true;
    const hay = `${r.path} ${(r.op.tags || []).join(" ")} ${r.op.summary || ""}`.toLowerCase();
    return hay.includes(filter.toLowerCase());
  });
  if (!rows.length) return console.log(filter ? `no endpoints matching "${filter}"` : "no endpoints");
  const width = Math.max(...rows.map((r) => r.method.length + r.path.length + 1));
  for (const r of rows) {
    const sig = `${r.method.toUpperCase()} ${r.path}`;
    const auth = authOf(r.op, spec);
    const summary = r.op.summary || r.op.description?.split("\n")[0] || "";
    console.log(`${sig.padEnd(width)}  [${auth}] ${summary}`);
  }
  console.log(`\n${rows.length} endpoint(s). Detail: node scripts/api.js show <METHOD> <path>`);
}

function cmdShow(spec, method, target) {
  if (!method || !target) {
    console.error("usage: node scripts/api.js show <METHOD> <path>");
    process.exit(1);
  }
  const wanted = method.toLowerCase();
  const rows = operations(spec).filter(
    (r) => r.method === wanted && (r.path === target || r.path.toLowerCase() === target.toLowerCase())
  );
  if (!rows.length) {
    // Score candidates by how many path segments they share with the query, so a
    // near-miss like /api/buyer/bids still surfaces /api/buyer/my-bids.
    const segs = target.toLowerCase().split("/").filter(Boolean);
    const near = operations(spec)
      .map((r) => {
        const rsegs = r.path.toLowerCase().split("/").filter(Boolean);
        const score = segs.reduce(
          (n, s) => n + (rsegs.some((rs) => rs === s || rs.includes(s) || s.includes(rs)) ? 1 : 0),
          0
        );
        return { ...r, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || a.path.length - b.path.length)
      .slice(0, 5);
    console.error(`no ${method.toUpperCase()} ${target}`);
    if (near.length) {
      console.error("\ndid you mean:");
      for (const n of near) console.error(`  ${n.method.toUpperCase()} ${n.path}`);
    }
    process.exit(1);
  }

  const { op, path: p } = rows[0];
  const out = [];
  out.push(`${wanted.toUpperCase()} ${p}`);
  if (op.summary) out.push(op.summary);
  if (op.description && op.description !== op.summary) out.push(op.description.trim());
  out.push(`auth:   ${authOf(op, spec)}`);
  if (op.tags?.length) out.push(`tags:   ${op.tags.join(", ")}`);
  out.push(`server: ${spec.servers?.[0]?.url || "-"}`);

  const params = deref(op.parameters || [], spec);
  if (params.length) {
    out.push("\nparameters:");
    for (const prm of params) {
      const req = prm.required ? "required" : "optional";
      const type = prm.schema?.type || prm.schema?.oneOf ? JSON.stringify(prm.schema?.type || prm.schema) : "any";
      const enums = prm.schema?.enum ? ` enum=${JSON.stringify(prm.schema.enum)}` : "";
      const def = prm.schema?.default !== undefined ? ` default=${JSON.stringify(prm.schema.default)}` : "";
      out.push(`  ${prm.in.padEnd(6)} ${prm.name}  ${type} (${req})${enums}${def}${prm.description ? ` — ${prm.description}` : ""}`);
    }
  }

  if (op.requestBody) {
    const body = deref(op.requestBody, spec);
    const req = body.required ? "required" : "optional";
    out.push(`\nrequestBody (${req}):`);
    for (const [mime, media] of Object.entries(body.content || {})) {
      out.push(`  ${mime}`);
      out.push(indent(JSON.stringify(media.schema, null, 2), 4));
      if (media.example) out.push(`  example:\n${indent(JSON.stringify(media.example, null, 2), 4)}`);
    }
  }

  if (op.responses) {
    out.push("\nresponses:");
    for (const [code, res0] of Object.entries(op.responses)) {
      const res = deref(res0, spec);
      out.push(`  ${code}  ${res.description || ""}`);
      for (const [mime, media] of Object.entries(res.content || {})) {
        if (media.schema) out.push(indent(`${mime}: ${JSON.stringify(media.schema)}`, 6));
      }
    }
  }

  out.push(`\ncurl:\n  ${curlFor(spec, wanted, p, op)}`);
  console.log(out.join("\n"));
}

function curlFor(spec, method, p, op) {
  const base = spec.servers?.[1]?.url || spec.servers?.[0]?.url || "http://localhost:5000";
  const withPath = p.replace(/\{(\w+)\}/g, ":$1");
  const parts = [`curl -X ${method.toUpperCase()} '${base}${withPath}'`];
  if (authOf(op, spec) !== "public") parts.push(`-H 'Authorization: Bearer $TOKEN'`);
  if (op.requestBody) {
    const mimes = Object.keys(deref(op.requestBody, spec).content || {});
    if (mimes.includes("multipart/form-data")) parts.push(`-F 'field=@/path/to/file'`);
    else parts.push(`-H 'Content-Type: application/json' -d '{...}'`);
  }
  return parts.join(" \\\n    ");
}

function cmdSearch(spec, term) {
  if (!term) {
    console.error("usage: node scripts/api.js search <term>");
    process.exit(1);
  }
  const q = term.toLowerCase();
  const rows = operations(spec).filter((r) =>
    JSON.stringify({ p: r.path, o: r.op }).toLowerCase().includes(q)
  );
  if (!rows.length) return console.log(`no match for "${term}"`);
  for (const r of rows) {
    console.log(`${r.method.toUpperCase()} ${r.path}  [${authOf(r.op, spec)}] ${r.op.summary || ""}`);
  }
  console.log(`\n${rows.length} match(es).`);
}

function cmdSchema(spec, name) {
  const schemas = spec.components?.schemas || {};
  if (!name) {
    const keys = Object.keys(schemas);
    return console.log(keys.length ? keys.join("\n") : "no component schemas defined in the JSDoc blocks");
  }
  const key = Object.keys(schemas).find((k) => k.toLowerCase() === name.toLowerCase());
  if (!key) {
    console.error(`no schema "${name}". available: ${Object.keys(schemas).join(", ") || "(none)"}`);
    process.exit(1);
  }
  console.log(`${key}:`);
  console.log(JSON.stringify(deref(schemas[key], spec), null, 2));
}

function indent(text, n) {
  const pad = " ".repeat(n);
  return text.split("\n").map((l) => pad + l).join("\n");
}

// --- entry -------------------------------------------------------------------

const [cmd, ...rest] = process.argv.slice(2);
const spec = buildSpec();

switch (cmd) {
  case "list":
    cmdList(spec, rest[0]);
    break;
  case "show":
    cmdShow(spec, rest[0], rest[1]);
    break;
  case "search":
    cmdSearch(spec, rest.join(" "));
    break;
  case "schema":
    cmdSchema(spec, rest[0]);
    break;
  case "json":
    console.log(JSON.stringify(spec, null, 2));
    break;
  default:
    console.log(
      [
        "node scripts/api.js list [filter]           one line per endpoint",
        "node scripts/api.js show <METHOD> <path>    params, body, responses, curl",
        "node scripts/api.js search <term>           search paths, summaries, schemas",
        "node scripts/api.js schema [Name]           component schemas",
        "node scripts/api.js json                    full OpenAPI spec",
      ].join("\n")
    );
    process.exit(cmd ? 1 : 0);
}
