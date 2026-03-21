"use strict"
// DEPRECATED — moved to domain-packs/restaurant/tools/buildQr.js
// This shim exists only for backward compatibility.
try {
    module.exports = require("../domain-packs/restaurant/tools/buildQr")
} catch {
    module.exports = { buildFramedQr: () => Promise.reject(new Error("buildQr not available — install restaurant domain pack")) }
}
