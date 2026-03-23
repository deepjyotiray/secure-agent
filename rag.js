const lancedb = require("@lancedb/lancedb")

async function retrieveContext(query, filter = {}) {
    const db = await lancedb.connect("./vectordb")
    const table = await db.openTable("restaurant")

    const q = query.toLowerCase()
    const words = q.split(/\s+/).filter(w => w.length > 2)

    let results = []
    if (words.length > 0) {
        const keywordQuery = words.map(w => `keywords LIKE '%${w}%'`).join(" OR ")
        results = await table.query()
            .where(keywordQuery)
            .limit(5)
            .toArray()
    }

    if (!results.length) {
        // Fallback: just return some top results if no keyword match
        results = await table.query().limit(3).toArray()
    }

    if (filter.type) {
        results = results.filter(r => r.type === filter.type)
    }

    if (!results.length) {
        return "No relevant information found."
    }

    return results.map(r => r.text).join("\n\n---\n\n")
}

module.exports = { retrieveContext }