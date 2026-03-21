"use strict"

const Database = require("better-sqlite3")
const { complete } = require("../providers/llm")
const logger = require("../gateway/logger")

function getDb(dbPath) {
    const db = new Database(dbPath, { readonly: true })
    db.pragma("busy_timeout = 5000")
    return db
}

function normalisePhone(phone) {
    return String(phone).replace(/@.*$/, "").replace(/\D/g, "").slice(-10)
}

function getSchema(db) {
    const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all().map(t => t.name)
    return tables.map(t => {
        const cols = db.prepare(`PRAGMA table_info("${t}")`).all()
        return `${t} (${cols.map(c => c.name).join(", ")})`
    }).join("\n")
}

function formatRows(rows) {
    if (!rows.length) return "No results found."
    const keys = Object.keys(rows[0])
    return rows.slice(0, 20).map(r =>
        keys.map(k => `${k}: ${r[k]}`).join(" | ")
    ).join("\n") + (rows.length > 20 ? `\n... and ${rows.length - 20} more rows` : "")
}

async function execute(filter, context, toolConfig) {
    const { db_path } = toolConfig
    if (!db_path) return "Database not configured."

    const phone = normalisePhone(context.phone)
    const query = context.rawMessage || ""

    const db = getDb(db_path)
    try {
        const schema = getSchema(db)
        const wp = context.profile || {}
        const businessName = toolConfig.business_name || wp.businessName || "the business"

        const sqlPrompt = `You are a SQLite expert for ${businessName}.
Today is ${new Date().toISOString().slice(0, 10)}.

Schema:
${schema}

The customer's phone ends with: ${phone}
Customer message: ${query}

Write a single read-only SELECT query to answer the customer's question.
Return ONLY the raw SQL, no explanation, no markdown.
If the question cannot be answered from this schema, return: NONE`

        let sql
        try {
            sql = (await complete(sqlPrompt) || "").trim().replace(/^```\w*\n?|\n?```$/g, "").trim()
        } catch {
            return "I couldn't look that up right now. Please try again."
        }

        if (!sql || sql === "NONE" || !/^SELECT\b/i.test(sql)) {
            return "I couldn't find relevant information for your question."
        }

        logger.info({ sql }, "sqliteQueryTool: generated SQL")

        const rows = db.prepare(sql).all()
        if (!rows.length) return "No matching records found."

        const answerPrompt = `You are a helpful assistant for ${businessName}. Be concise and formatted for WhatsApp.

Customer asked: ${query}
Query results (${rows.length} rows):
${formatRows(rows)}

Provide a clear, friendly answer using only the data above. Do not make up information.`

        try {
            return await complete(answerPrompt) || formatRows(rows)
        } catch {
            return formatRows(rows)
        }
    } catch (err) {
        logger.error({ err }, "sqliteQueryTool: query failed")
        return "I couldn't look that up right now. Please try again."
    } finally {
        try { db.close() } catch {}
    }
}

module.exports = { execute }
