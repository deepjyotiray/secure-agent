"use strict"

// ── Backward-compatibility shim ──────────────────────────────────────────────
// The restaurant-specific menu RAG implementation now lives at:
//   domain-packs/restaurant/tools/menuRag.js
//
// This file proxies to it so that existing imports continue to work:
//   - tools/ragTool.js
//   - tools/businessChatTool.js
//   - tools/menuTool.js
//   - test/menu.test.js
//
// Once all importers are migrated to use the domain pack directly,
// this shim can be removed.
// ─────────────────────────────────────────────────────────────────────────────

const { retrieveContext } = require("../domain-packs/restaurant/tools/menuRag")

module.exports = { retrieveContext }
