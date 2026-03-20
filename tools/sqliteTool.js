"use strict"

// ── Backward-compatibility shim ──────────────────────────────────────────────
// Restaurant order lookup now lives at:
//   domain-packs/restaurant/tools/orderLookup.js
//
// This shim keeps the CORE_TOOLS registry in executor.js working.
// Once the restaurant manifest uses type: "order_lookup" (dynamic),
// this shim can be removed.
// ─────────────────────────────────────────────────────────────────────────────

const { execute } = require("../domain-packs/restaurant/tools/orderLookup")

module.exports = { execute }
