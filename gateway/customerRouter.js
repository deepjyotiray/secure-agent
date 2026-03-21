"use strict"

const { parseIntent } = require("./intentParser")

// ── Default heuristic word lists (generic — domain packs can override) ───────
const DEFAULT_HEURISTICS = {
    weather: ["weather", "rain", "raining", "sunny", "summer", "winter", "hot", "cold", "monsoon", "humidity", "forecast"],
    menu:    ["menu", "catalog", "catalogue", "item", "items", "product", "products", "service", "services", "price", "cost", "list", "browse", "show", "available", "option", "options"],
    order:   ["order", "delivery", "delivered", "status", "track", "eta", "invoice", "receipt", "bill", "payment", "paid", "unpaid", "resend", "refund"],
    buy:     ["place order", "want to order", "i want", "buy", "checkout", "cart", "add", "confirm order", "purchase"],
    support: ["problem", "issue", "complaint", "wrong", "missing", "late", "refund", "human", "manager", "agent", "support", "help"],
    greet:   ["hi", "hello", "hey", "namaste", "good morning", "good evening", "thanks", "thank you"],
}

// ── Default intent mapping for heuristic categories ──────────────────────────
const DEFAULT_HEURISTIC_INTENT_MAP = {
    support: "support",
    order:   "order_status",
    buy:     "place_order",
    menu:    "show_menu",
    weather: "general_chat",
    greet:   "greet",
}

// ── Default filter fields (generic — domain packs can override) ──────────────
const DEFAULT_FILTER_FIELDS = ["section", "query", "max_price"]

function includesAny(message, words) {
    return words.some(word => message.includes(word))
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

function heuristicIntent(message, heuristics) {
    const lower = message.trim().toLowerCase()
    if (!lower) return { intent: "general_chat", filter: {} }

    const h = heuristics || DEFAULT_HEURISTICS
    const intentMap = DEFAULT_HEURISTIC_INTENT_MAP

    // check in priority order: support > order > buy > menu > weather > greet
    const checkOrder = ["support", "order", "buy", "menu", "weather", "greet"]
    for (const category of checkOrder) {
        const words = h[category]
        if (words && includesAny(lower, words)) {
            const intent = intentMap[category] || "general_chat"
            const filter = (category === "menu" || category === "weather") ? { query: lower } : {}
            return { intent, filter }
        }
    }

    return { intent: "general_chat", filter: { query: lower } }
}

function resolveHeuristics(manifest) {
    return manifest._domainPackHeuristics || null
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

async function routeCustomerMessage(message, manifest) {
    const configuredIntents = Object.keys(manifest.intents || {})
    const domainHeuristics = resolveHeuristics(manifest)
    const filterConfig = resolveFilterConfig(manifest)
    const heuristic = heuristicIntent(message, domainHeuristics)

    const parsed = await parseIntent(message, {
        allowedIntents: configuredIntents,
        intentHints: manifest.intent_hints || {},
        businessProfile: manifest.agent?.description || manifest.agent?.name || "business assistant",
        defaultIntent: configuredIntents.includes("general_chat") ? "general_chat" : configuredIntents[0] || "general_chat",
        filterSchema: filterConfig.schema,
        filterExamples: filterConfig.examples,
    })

    if (!parsed?.intent || !configuredIntents.includes(parsed.intent)) {
        return { intent: heuristic.intent, filter: normalizeFilter(heuristic.filter, filterConfig.fields) }
    }

    return { intent: parsed.intent, filter: normalizeFilter(parsed.filter, filterConfig.fields) }
}

module.exports = { routeCustomerMessage, heuristicIntent, normalizeFilter }
