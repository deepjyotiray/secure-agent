"use strict"

const { parseIntent } = require("./intentParser")

const WEATHER_WORDS = ["weather", "rain", "raining", "sunny", "summer", "winter", "hot", "cold", "monsoon", "humidity", "forecast"]
const MENU_WORDS = ["menu", "dish", "dishes", "item", "items", "veg", "non-veg", "vegetarian", "starter", "main course", "biryani", "tandoori", "paneer", "chicken", "mutton", "fish", "dessert", "drink", "price", "cost", "special"]
const ORDER_WORDS = ["order", "delivery", "delivered", "status", "track", "eta", "invoice", "receipt", "bill", "payment", "paid", "unpaid", "upi", "qr", "resend", "refund", "late"]
const BUY_WORDS = ["place order", "want to order", "i want", "buy", "checkout", "cart", "add", "confirm order", "hungry"]
const SUPPORT_WORDS = ["problem", "issue", "complaint", "wrong order", "missing", "late", "refund", "human", "manager", "agent", "support", "allergy"]
const GREET_WORDS = ["hi", "hello", "hey", "namaste", "good morning", "good evening", "thanks", "thank you"]

function includesAny(message, words) {
    return words.some(word => message.includes(word))
}

function normalizeFilter(filter = {}) {
    return {
        section: filter.section ?? null,
        veg: typeof filter.veg === "boolean" ? filter.veg : null,
        query: filter.query ?? null,
        max_price: Number.isFinite(filter.max_price) ? filter.max_price : null,
        max_calories: Number.isFinite(filter.max_calories) ? filter.max_calories : null,
        min_protein: Number.isFinite(filter.min_protein) ? filter.min_protein : null,
        max_fat: Number.isFinite(filter.max_fat) ? filter.max_fat : null,
    }
}

function heuristicIntent(message) {
    const lower = message.trim().toLowerCase()

    if (!lower) return { intent: "general_chat", filter: {} }
    if (includesAny(lower, SUPPORT_WORDS)) return { intent: "support", filter: {} }
    if (includesAny(lower, ORDER_WORDS)) return { intent: "order_status", filter: {} }
    if (includesAny(lower, BUY_WORDS)) return { intent: "place_order", filter: {} }
    if (includesAny(lower, MENU_WORDS)) return { intent: "show_menu", filter: { query: lower } }
    if (includesAny(lower, WEATHER_WORDS)) return { intent: "general_chat", filter: { query: lower } }
    if (includesAny(lower, GREET_WORDS)) return { intent: "greet", filter: {} }
    return { intent: "general_chat", filter: { query: lower } }
}

async function routeCustomerMessage(message, manifest) {
    const configuredIntents = Object.keys(manifest.intents || {})
    const heuristic = heuristicIntent(message)

    const parsed = await parseIntent(message, {
        allowedIntents: configuredIntents,
        intentHints: manifest.intent_hints || {},
        businessProfile: manifest.agent?.description || manifest.agent?.name || "business assistant",
        defaultIntent: configuredIntents.includes("general_chat") ? "general_chat" : configuredIntents[0] || "general_chat",
    })

    if (!parsed?.intent || !configuredIntents.includes(parsed.intent)) {
        return { intent: heuristic.intent, filter: normalizeFilter(heuristic.filter) }
    }

    return { intent: parsed.intent, filter: normalizeFilter(parsed.filter) }
}

module.exports = { routeCustomerMessage, heuristicIntent, normalizeFilter }
