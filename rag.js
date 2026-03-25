const lancedb = require("@lancedb/lancedb")

const STOPWORDS = new Set([
    "a", "all", "an", "and", "any", "are", "available", "can", "dish", "dishes",
    "do", "for", "have", "i", "is", "item", "items", "list", "me", "menu",
    "option", "options", "please", "show", "tell", "the", "what", "you"
])

const TOKEN_SYNONYMS = {
    dessert: "sweet",
    desserts: "sweet",
    sweets: "sweet",
    sweetdish: "sweet",
    sweetdishes: "sweet",
}

function normalizeToken(word = "") {
    const lowered = String(word || "").toLowerCase().trim()
    if (!lowered) return ""
    return TOKEN_SYNONYMS[lowered] || lowered
}

function normalizeWords(query = "") {
    return String(query)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .map(normalizeToken)
        .filter(word => word && word.length > 1 && !STOPWORDS.has(word))
}

function tokenize(text = "") {
    return new Set(normalizeWords(text))
}

function scoreRow(row, words) {
    const keywordTokens = tokenize(row.keywords || "")
    const textTokens = tokenize(row.text || "")
    const normalizedQuery = words.join(" ").trim()
    const keywordText = String(row.keywords || "").toLowerCase()

    let score = 0
    for (const word of words) {
        if (keywordTokens.has(word)) score += 3
        if (!keywordTokens.has(word) && textTokens.has(word)) score += 1
    }

    if (normalizedQuery && keywordText.includes(normalizedQuery)) {
        score += 5
    }

    return score
}

async function retrieveContext(query, filter = {}) {
    const db = await lancedb.connect("./vectordb")
    const table = await db.openTable("restaurant")

    const words = [...new Set(normalizeWords(query))]

    let results = []
    if (words.length > 0) {
        const candidates = await table.query().limit(50).toArray()
        results = candidates
            .map(row => {
                const score = scoreRow(row, words)
                return { row, score }
            })
            .filter(entry => entry.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 5)
            .map(entry => entry.row)
    }

    if (!results.length && words.length === 0) {
        // Empty or near-empty prompts like "menu" can still return a short browse view.
        results = await table.query().limit(3).toArray()
    }

    if (filter.type) {
        results = results.filter(r => r.type === filter.type)
    }

    if (!results.length) {
        return "Sorry, nothing matched your query."
    }

    return results.map(r => r.text).join("\n\n---\n\n")
}

module.exports = { retrieveContext }
