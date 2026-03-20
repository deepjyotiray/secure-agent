"use strict"

// ── Backward-compatibility shim ──────────────────────────────────────────────
// Restaurant support tool now lives at:
//   domain-packs/restaurant/tools/restaurantSupport.js
//
// This shim keeps the CORE_TOOLS registry in executor.js working.
// Once the restaurant manifest uses type: "restaurant_support" (dynamic),
// this shim can be removed.
// ─────────────────────────────────────────────────────────────────────────────

const { execute } = require("../domain-packs/restaurant/tools/restaurantSupport")

module.exports = { execute }
