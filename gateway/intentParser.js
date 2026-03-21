"use strict"

const { complete } = require("../providers/llm")
const { registerGuide } = require("../core/promptGuides")

// ── Default filter schema (generic — domain packs can override) ──────────────
const DEFAULT_FILTER_SCHEMA = {
    section:   { type: "string",  description: "catalog section or category" },
    query:     { type: "string",  description: "searchable item/category terms" },
    max_price: { type: "number",  description: "maximum price" },
}

const DEFAULT_EXTRACTION_RULES = `- For "under 200", "below 200", "less than 200", set "max_price": 200.
- Put the searchable item/category terms in "query" without price words if possible.
- If the message is not a catalog query, keep filter values null unless a field is clearly useful.
- Never drop a clear numerical constraint from the user's message.`

const DEFAULT_FILTER_EXAMPLES = [
    { input: `"items under 200"`, output: `{"intent":"show_menu","filter":{"section":null,"query":"items","max_price":200}}` },
    { input: `"what services do you offer"`, output: `{"intent":"show_menu","filter":{"section":null,"query":"services","max_price":null}}` },
    { input: `"what is your support email"`, output: `{"intent":"general_chat","filter":{"section":null,"query":null,"max_price":null}}` },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildIntentGuide(allowedIntents, intentHints) {
    return allowedIntents.map(intent => {
        const hint = intentHints[intent] || "No extra hint provided."
        return `- "${intent}": ${hint}`
    }).join("\n")
}

function buildFilterTemplate(schema) {
    const obj = {}
    for (const key of Object.keys(schema)) obj[key] = null
    return JSON.stringify(obj, null, 2)
}

function buildExtractionRules(schema) {
    // generate generic extraction rules from schema
    const rules = []
    for (const [key, def] of Object.entries(schema)) {
        if (def.type === "boolean") rules.push(`- Set "${key}" to true/false only when the user's message clearly indicates it. Otherwise null.`)
        else if (def.type === "number") rules.push(`- For numerical constraints related to ${def.description || key}, extract the number into "${key}".`)
        else rules.push(`- Extract relevant ${def.description || key} terms into "${key}" if present.`)
    }
    rules.push("- Keep filter values null unless a field is clearly useful.")
    rules.push("- Never drop a clear numerical constraint from the user's message.")
    return rules.join("\n")
}

function buildExamples(examples, defaultIntent) {
    if (!examples || !examples.length) return ""
    return examples.map(ex => `- ${ex.input} -> ${typeof ex.output === "string" ? ex.output : JSON.stringify(ex.output)}`).join("\n")
}

function extractJson(text) {
    if (!text) return null
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    try { return JSON.parse(match[0]) } catch { return null }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function parseIntent(message, options = {}) {
    const allowedIntents = Array.isArray(options.allowedIntents) && options.allowedIntents.length
        ? options.allowedIntents
        : ["greet", "show_menu", "order_status", "place_order", "support", "general_chat", "unknown"]
    const defaultIntent = options.defaultIntent || (allowedIntents.includes("general_chat") ? "general_chat" : allowedIntents[0])

    // resolve filter config — use domain pack schema if provided, else defaults
    const filterSchema = options.filterSchema || DEFAULT_FILTER_SCHEMA
    const filterTemplate = buildFilterTemplate(filterSchema)
    const useDefaultRules = !options.filterSchema
    const extractionRules = useDefaultRules ? DEFAULT_EXTRACTION_RULES : buildExtractionRules(filterSchema)
    const examples = useDefaultRules
        ? DEFAULT_FILTER_EXAMPLES
        : (options.filterExamples || [])

    const prompt = `You are a WhatsApp business intent router for ${options.businessProfile || "a local business"}.
Return JSON only. No markdown. No explanation.

Allowed intents:
${buildIntentGuide(allowedIntents, options.intentHints || {})}

Routing rules:
- Prefer the most specific business intent when the message clearly matches one.
- Use "general_chat" for general conversation, recommendations, weather-style questions, greetings, or small talk that should still be answered in a business-aware tone.
- Never invent new intents outside the allowed list.
- Reason over the full user request before choosing an intent or filters.
- Preserve explicit constraints such as price caps, preferences, quantity, category, and comparisons.

Also extract an optional filter object:
${filterTemplate}

Extraction rules:
${extractionRules}

Examples:
${buildExamples(examples, defaultIntent)}

If unsure, choose "${defaultIntent}".

Message:
${message}

Return exactly:
{"intent":"${defaultIntent}","filter":${filterTemplate}}`

    try {
        const text = await complete(prompt)
        const parsed = extractJson(text)
        if (!parsed || typeof parsed.intent !== "string") return { intent: defaultIntent, filter: {} }
        if (!allowedIntents.includes(parsed.intent)) return { intent: defaultIntent, filter: {} }
        return { intent: parsed.intent, filter: parsed.filter || {} }
    } catch {
        return { intent: defaultIntent, filter: {} }
    }
}

registerGuide({
    id: "customer-intent",
    name: "Customer — intent classifier",
    description: "Prompt that classifies incoming customer messages into intents and extracts filters. Intents come from the agent YAML manifest.",
    source: "gateway/intentParser.js + agents/*.yml",
    editable: "Intent hints via agent YAML manifest",
    render() {
        return "You are a WhatsApp business intent router.\nReturn JSON only.\n\nAllowed intents: (loaded from manifest at runtime)\nRouting rules: prefer specific business intents, use general_chat for small talk.\n\nMessage: (customer message at runtime)"
    },
})

module.exports = { parseIntent }
