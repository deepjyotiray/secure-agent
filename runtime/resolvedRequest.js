"use strict"

function normalizeText(value = "") {
    return String(value || "").trim().replace(/\s+/g, " ")
}

function buildResolvedRequest({ flow, originalMessage, effectiveMessage, conversationState, resolution, intent, filters } = {}) {
    const original = normalizeText(originalMessage)
    const effective = normalizeText(effectiveMessage || original)
    const activeTopic = conversationState?.topic || null
    const appliedFilters = filters && typeof filters === "object"
        ? { ...filters }
        : (conversationState?.filters && typeof conversationState.filters === "object" ? { ...conversationState.filters } : {})

    return {
        flow: flow || "customer",
        originalMessage: original,
        effectiveMessage: effective,
        wasRewritten: !!(resolution && resolution.resolved && effective && effective !== original),
        followUpReason: resolution?.resolved ? (resolution.reason || null) : null,
        followUpConfidence: resolution?.resolved ? Number(resolution.confidence || 0) : 0,
        activeTopic,
        selection: conversationState?.selection || null,
        appliedFilters,
        lastIntent: intent || conversationState?.lastIntent || null,
    }
}

module.exports = { buildResolvedRequest }
