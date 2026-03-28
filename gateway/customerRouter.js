"use strict"

const { parseIntent } = require("./intentParser")

// ── Default heuristic word lists (generic — domain packs can override) ───────
const DEFAULT_HEURISTICS = {
    support: ["problem", "issue", "complaint", "wrong", "missing", "human", "manager", "agent", "support", "help"],
    greet:   ["hi", "hello", "hey", "namaste", "good morning", "good evening", "thanks", "thank you"],
}

// ── Default intent mapping for heuristic categories ──────────────────────────
const DEFAULT_HEURISTIC_INTENT_MAP = {
    support: "support",
    greet:   "greet",
}

// ── Default filter fields (generic — domain packs can override) ──────────────
const DEFAULT_FILTER_FIELDS = ["query"]

function includesAny(message, words) {
    return words.some(word => {
        const term = String(word || "").trim().toLowerCase()
        if (!term) return false
        if (term.includes(" ")) return message.includes(term)
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        return new RegExp(`\\b${escaped}\\b`, "i").test(message)
    })
}

function countMatches(message, words) {
    return (Array.isArray(words) ? words : []).reduce((count, word) => {
        const term = String(word || "").trim().toLowerCase()
        if (!term) return count
        if (term.includes(" ")) return count + (message.includes(term) ? 1 : 0)
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        return count + (new RegExp(`\\b${escaped}\\b`, "i").test(message) ? 1 : 0)
    }, 0)
}

function rankHeuristicCandidates(message, heuristics, intentMapOverride) {
    const lower = String(message || "").trim().toLowerCase()
    if (!lower) return []

    const h = heuristics || DEFAULT_HEURISTICS
    const intentMap = intentMapOverride || (heuristics && heuristics._intentMap) || DEFAULT_HEURISTIC_INTENT_MAP

    return Object.keys(h)
        .filter(category => category !== "_intentMap")
        .map(category => {
            const words = h[category]
            const matchCount = countMatches(lower, words)
            const phraseBoost = Array.isArray(words) && words.some(word => String(word || "").trim().includes(" ") && lower.includes(String(word).trim().toLowerCase())) ? 0.5 : 0
            const defaultPenalty = Object.prototype.hasOwnProperty.call(DEFAULT_HEURISTICS, category) ? 0 : 1
            return {
                category,
                intent: intentMap[category] || "general_chat",
                matchCount,
                score: matchCount + phraseBoost + defaultPenalty,
            }
        })
        .filter(candidate => candidate.matchCount > 0)
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score
            return b.matchCount - a.matchCount
        })
}

function normalizeFilter(filter = {}, filterFields) {
    const fields = filterFields || DEFAULT_FILTER_FIELDS
    const out = {}
    for (const key of fields) {
        const val = filter[key]
        if (val === undefined || val === null) { out[key] = null; continue }
        if (typeof val === "boolean") { out[key] = val; continue }
        if (typeof val === "number" && Number.isFinite(val)) { out[key] = val; continue }
        out[key] = val
    }
    return out
}

function heuristicIntent(message, heuristics, intentMapOverride) {
    const lower = message.trim().toLowerCase()
    if (!lower) return { intent: "general_chat", filter: {} }
    const candidates = rankHeuristicCandidates(lower, heuristics, intentMapOverride)
    if (candidates.length) return { intent: candidates[0].intent, filter: {} }

    return { intent: "general_chat", filter: { query: lower } }
}

function resolveHeuristics(manifest) {
    const domainHeuristics = manifest._domainPackHeuristics || null
    if (!domainHeuristics) return null
    return {
        ...DEFAULT_HEURISTICS,
        ...domainHeuristics,
        _intentMap: {
            ...DEFAULT_HEURISTIC_INTENT_MAP,
            ...(domainHeuristics._intentMap || {}),
        },
    }
}

function resolveFilterConfig(manifest) {
    const schema = manifest._domainPackFilterSchema
    if (!schema) return { fields: DEFAULT_FILTER_FIELDS, schema: null, examples: null }
    return {
        fields: Object.keys(schema),
        schema,
        examples: manifest._domainPackFilterExamples || null,
    }
}

function mergeResolvedFilters(baseFilter, resolvedRequest, filterFields) {
    const out = { ...(baseFilter || {}) }
    const applied = resolvedRequest?.appliedFilters
    if (!applied || typeof applied !== "object") return normalizeFilter(out, filterFields)
    for (const key of Object.keys(applied)) {
        if (applied[key] === undefined) continue
        out[key] = applied[key]
    }
    return normalizeFilter(out, filterFields)
}

function buildContextSummary(resolvedRequest = {}) {
    const lines = []
    if (resolvedRequest.lastIntent) lines.push(`- lastIntent: ${resolvedRequest.lastIntent}`)
    if (resolvedRequest.activeTopic?.label) lines.push(`- activeTopic: ${resolvedRequest.activeTopic.label}`)
    if (resolvedRequest.followUpReason) lines.push(`- followUpReason: ${resolvedRequest.followUpReason}`)
    if (resolvedRequest.selection?.label) lines.push(`- selection: ${resolvedRequest.selection.label}`)
    const applied = resolvedRequest.appliedFilters
    if (applied && typeof applied === "object") {
        const activeFilters = Object.entries(applied).filter(([, value]) => value !== null && value !== undefined && value !== "")
        if (activeFilters.length) lines.push(`- appliedFilters: ${activeFilters.map(([k, v]) => `${k}=${v}`).join(", ")}`)
    }
    return lines.join("\n")
}

function shouldTrustHeuristicOverParsed(topCandidate, secondCandidate, parsed) {
    if (!topCandidate) return false
    const parsedConfidence = Number(parsed?.confidence || 0)
    if (!parsed?.intent || parsed.intent === topCandidate.intent) return false
    const margin = topCandidate.score - (secondCandidate?.score || 0)
    if (topCandidate.matchCount >= 2 && parsedConfidence < 0.8) return true
    if (margin >= 1.5 && parsedConfidence < 0.65) return true
    return false
}

async function routeCustomerMessage(message, manifest, options = {}) {
    const configuredIntents = Object.keys(manifest.intents || {})
    const domainHeuristics = resolveHeuristics(manifest)
    const domainIntentMap = manifest._domainPackHeuristicIntentMap || null
    const filterConfig = resolveFilterConfig(manifest)
    const resolvedRequest = options.resolvedRequest || null
    const routingMessage = resolvedRequest?.effectiveMessage || message
    const candidates = rankHeuristicCandidates(routingMessage, domainHeuristics, domainIntentMap)
    const heuristic = heuristicIntent(routingMessage, domainHeuristics, domainIntentMap)
    const topCandidate = candidates[0] || null
    const secondCandidate = candidates[1] || null

    // Optimization: If heuristic finds a strong match (like 'greet' or 'support'), 
    // and it's in our manifest, skip the LLM call for intent parsing.
    if (topCandidate && topCandidate.matchCount >= 2 && heuristic.intent && heuristic.intent !== "general_chat" && configuredIntents.includes(heuristic.intent)) {
        return { intent: heuristic.intent, filter: mergeResolvedFilters(heuristic.filter, resolvedRequest, filterConfig.fields) }
    }

    const parsed = await parseIntent(routingMessage, {
        allowedIntents: configuredIntents,
        intentHints: manifest.intent_hints || {},
        businessProfile: manifest.agent?.description || manifest.agent?.name || "business assistant",
        defaultIntent: configuredIntents.includes("general_chat") ? "general_chat" : configuredIntents[0] || "general_chat",
        filterSchema: filterConfig.schema,
        filterExamples: filterConfig.examples,
        llmConfig: manifest.agent?.llm,
        contextSummary: buildContextSummary(resolvedRequest),
    })

    if (!parsed?.intent || !configuredIntents.includes(parsed.intent)) {
        return { intent: heuristic.intent, filter: mergeResolvedFilters(heuristic.filter, resolvedRequest, filterConfig.fields) }
    }

    if (shouldTrustHeuristicOverParsed(topCandidate, secondCandidate, parsed) && configuredIntents.includes(topCandidate.intent)) {
        return { intent: topCandidate.intent, filter: mergeResolvedFilters(heuristic.filter, resolvedRequest, filterConfig.fields) }
    }

    return { intent: parsed.intent, filter: mergeResolvedFilters(parsed.filter, resolvedRequest, filterConfig.fields) }
}

module.exports = { routeCustomerMessage, heuristicIntent, normalizeFilter, rankHeuristicCandidates }
