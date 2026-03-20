"use strict"

// ── Backward-compatibility shim ──────────────────────────────────────────────
// Restaurant order creation now lives at:
//   domain-packs/restaurant/tools/orderCreate.js
//
// This shim keeps the CORE_TOOLS registry in executor.js working.
// Once the restaurant manifest uses type: "order_create" (dynamic),
// this shim can be removed.
// ─────────────────────────────────────────────────────────────────────────────

const { execute } = require("../domain-packs/restaurant/tools/orderCreate")

module.exports = { execute }
