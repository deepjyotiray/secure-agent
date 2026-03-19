"use strict"

const fs   = require("fs")
const path = require("path")

// ── DB introspection ───────────────────────────────────────────────────────
function introspectDb(dbPath) {
    if (!dbPath || !fs.existsSync(dbPath)) return null
    try {
        const Database = require("better-sqlite3")
        const db = new Database(dbPath, { readonly: true })
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
        const result = []
        for (const { name } of tables) {
            try {
                const cols    = db.prepare(`PRAGMA table_info(${name})`).all()
                const sample  = db.prepare(`SELECT * FROM ${name} LIMIT 3`).all()
                const rowCount = db.prepare(`SELECT COUNT(*) as n FROM ${name}`).get().n
                result.push({ table: name, columns: cols.map(c => `${c.name} ${c.type}`), sample, rowCount })
            } catch {}
        }
        db.close()
        return result
    } catch (e) {
        console.warn(`  ⚠️  Could not read DB: ${e.message}`)
        return null
    }
}

function formatDbContext(tables) {
    if (!tables) return ""
    return tables.map(t => {
        const cols   = t.columns.join(", ")
        const sample = t.sample.length
            ? "\n  Sample rows:\n" + t.sample.map(r => "  " + JSON.stringify(r)).join("\n")
            : ""
        return `Table: ${t.table} (${t.rowCount} rows)\nColumns: ${cols}${sample}`
    }).join("\n\n")
}

// ── Support tickets ────────────────────────────────────────────────────────
function parseTickets(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return null
    const raw = fs.readFileSync(filePath, "utf8").trim()
    const ext = path.extname(filePath).toLowerCase()

    let tickets = []
    try {
        if (ext === ".json") {
            const parsed = JSON.parse(raw)
            tickets = Array.isArray(parsed) ? parsed : [parsed]
        } else if (ext === ".csv") {
            const lines = raw.split("\n").filter(Boolean)
            const headers = lines[0].split(",").map(h => h.trim().replace(/"/g, ""))
            tickets = lines.slice(1).map(line => {
                const vals = line.split(",").map(v => v.trim().replace(/"/g, ""))
                return Object.fromEntries(headers.map((h, i) => [h, vals[i] || ""]))
            })
        } else {
            // plain text — treat each line as a ticket
            tickets = raw.split("\n").filter(Boolean).map((t, i) => ({ id: i + 1, text: t }))
        }
    } catch (e) {
        console.warn(`  ⚠️  Could not parse tickets: ${e.message}`)
        return raw.slice(0, 3000)
    }

    // Summarise — take first 30 tickets, stringify
    const sample = tickets.slice(0, 30)
    return sample.map(t => JSON.stringify(t)).join("\n")
}

// ── Extra context file ─────────────────────────────────────────────────────
function readExtraContext(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return null
    try {
        return fs.readFileSync(filePath, "utf8").slice(0, 5000)
    } catch { return null }
}

// ── Website scrape ─────────────────────────────────────────────────────────
async function scrapeWebsite(url) {
    if (!url) return null
    try {
        const fetch    = require("node-fetch")
        const cheerio  = require("cheerio")
        const res      = await fetch(url, { timeout: 10000, headers: { "User-Agent": "Mozilla/5.0" } })
        const html     = await res.text()
        const $        = cheerio.load(html)
        $("script, style, nav, footer, header, iframe, noscript").remove()
        const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 5000)
        return text
    } catch (e) {
        console.warn(`  ⚠️  Could not scrape website: ${e.message}`)
        return null
    }
}

// ── Assemble full context ──────────────────────────────────────────────────
async function assemble(inputs) {
    console.log("\n── Gathering context ───────────────────────────────")

    const sections = []

    sections.push(`BUSINESS NAME: ${inputs.businessName}`)
    sections.push(`BUSINESS TYPE: ${inputs.businessType}`)
    sections.push(`BRAND TAGLINE: ${inputs.brandTagline || "not provided"}`)
    sections.push(`BRAND VOICE: ${inputs.brandVoice || "not provided"}`)
    sections.push(`TARGET AUDIENCE: ${inputs.targetAudience || "not provided"}`)
    sections.push(`DESCRIPTION: ${inputs.description}`)
    sections.push(`WEBSITE: ${inputs.website || "not provided"}`)
    sections.push(`WEBSITE NOTES: ${inputs.websiteNotes || "not provided"}`)
    sections.push(`CURRENCY: ${inputs.currency}`)
    sections.push(`COUNTRY CODE: ${inputs.countryCode}`)
    sections.push(`LANGUAGE: ${inputs.language}`)
    sections.push(`TIMEZONE: ${inputs.timezone || "not provided"}`)
    sections.push(`CONTACT EMAIL: ${inputs.contactEmail || "not provided"}`)
    sections.push(`CONTACT PHONE: ${inputs.contactPhone || "not provided"}`)
    sections.push(`ADDRESS: ${inputs.address || "not provided"}`)
    sections.push(`SERVICE AREAS: ${inputs.serviceAreas || "not provided"}`)
    sections.push(`BUSINESS HOURS: ${inputs.businessHours || "not provided"}`)
    sections.push(`HOLIDAYS / CLOSURES: ${inputs.holidays || "not provided"}`)
    sections.push(`OFFERINGS / CATALOG: ${inputs.offerings || "not provided"}`)
    sections.push(`CATALOG NOTES: ${inputs.catalogNotes || "not provided"}`)
    sections.push(`PRICING NOTES: ${inputs.pricingNotes || "not provided"}`)
    sections.push(`FULFILLMENT MODE: ${inputs.fulfillmentMode || "not provided"}`)
    sections.push(`ORDERING FLOW: ${inputs.orderingFlow || "not provided"}`)
    sections.push(`BOOKING FLOW: ${inputs.bookingFlow || "not provided"}`)
    sections.push(`FAQ SEED TOPICS: ${inputs.faqSeed || "not provided"}`)
    sections.push(`SUPPORT POLICY: ${inputs.supportPolicy || "not provided"}`)
    sections.push(`ESCALATION POLICY: ${inputs.escalationPolicy || "not provided"}`)
    sections.push(`REFUND / RETURN POLICY: ${inputs.refundPolicy || "not provided"}`)
    sections.push(`CUSTOMER DATA RULES: ${inputs.customerDataRules || "not provided"}`)
    sections.push(`COMPLIANCE / SAFETY NOTES: ${inputs.complianceNotes || "not provided"}`)
    sections.push(`PAYMENT METHODS: ${inputs.paymentMethods || "not provided"}`)
    sections.push(`INTEGRATIONS / SYSTEMS: ${inputs.integrations || "not provided"}`)
    sections.push(`KNOWLEDGE URLS: ${inputs.knowledgeUrls || "not provided"}`)
    sections.push(`LAUNCH GOALS: ${inputs.launchGoals || "not provided"}`)

    if (inputs.dbPath) {
        console.log("  📦 Introspecting database...")
        const tables = introspectDb(inputs.dbPath)
        if (tables) {
            sections.push("DATABASE SCHEMA AND SAMPLE DATA:\n" + formatDbContext(tables))
            console.log(`  ✅ Found ${tables.length} tables`)
        }
    }

    if (inputs.ticketsFile) {
        console.log("  🎫 Parsing support tickets...")
        const tickets = parseTickets(inputs.ticketsFile)
        if (tickets) {
            sections.push("EXISTING SUPPORT TICKETS (sample):\n" + tickets)
            console.log("  ✅ Tickets loaded")
        }
    }

    if (inputs.extraContext) {
        console.log("  📄 Reading extra context file...")
        const extra = readExtraContext(inputs.extraContext)
        if (extra) {
            sections.push("EXTRA CONTEXT:\n" + extra)
            console.log("  ✅ Extra context loaded")
        }
    }

    if (inputs.scrapeWebsite && inputs.website) {
        console.log(`  🌐 Scraping ${inputs.website}...`)
        const scraped = await scrapeWebsite(inputs.website)
        if (scraped) {
            sections.push("WEBSITE CONTENT:\n" + scraped)
            console.log("  ✅ Website scraped")
        }
    }

    return sections.join("\n\n---\n\n")
}

module.exports = { assemble }
