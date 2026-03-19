"use strict"

const readline = require("readline")
const fs       = require("fs")
const path     = require("path")

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

function ask(question, defaultVal = "") {
    return new Promise(resolve => {
        const hint = defaultVal ? ` (${defaultVal})` : ""
        rl.question(`${question}${hint}: `, ans => resolve(ans.trim() || defaultVal))
    })
}

function askOptionalFile(label) {
    return new Promise(async resolve => {
        const p = await ask(`${label} — file path (leave blank to skip)`)
        if (!p) return resolve(null)
        const resolved = path.resolve(p)
        if (!fs.existsSync(resolved)) {
            console.log(`  ⚠️  File not found: ${resolved} — skipping`)
            return resolve(null)
        }
        resolve(resolved)
    })
}

async function collect() {
    console.log("\n╔══════════════════════════════════════════════════╗")
    console.log("║   WhatsApp Agent — Business Setup Wizard         ║")
    console.log("╚══════════════════════════════════════════════════╝\n")
    console.log("Answer each question. Press Enter to skip optional fields.\n")

    // ── Core identity ──────────────────────────────────────────────
    console.log("── Business Info ───────────────────────────────────")
    const businessName    = await ask("Business name")
    const businessType    = await ask("Business type (e.g. food delivery, salon, pharmacy, retail)")
    const description     = await ask("Describe what you sell and how you operate (free text)")
    const website         = await ask("Website URL (e.g. https://yourbusiness.com)")
    const countryCode     = await ask("Country code", "91")
    const currency        = await ask("Currency symbol", "₹")
    const language        = await ask("Primary language customers use", "English")

    // ── Admin config ───────────────────────────────────────────────
    console.log("\n── Admin / WhatsApp Config ─────────────────────────")
    const adminPhone      = await ask("Your WhatsApp number (international format, e.g. 919XXXXXXXXX)")
    const adminKeyword    = await ask("Admin trigger keyword (e.g. ray, admin, boss)")
    const adminPin        = await ask("Admin PIN (min 6 chars)")
    const openaiKey       = await ask("OpenAI API key (sk-...)")

    // ── Data sources ───────────────────────────────────────────────
    console.log("\n── Data Sources (all optional) ─────────────────────")
    const dbPath          = await ask("Existing SQLite DB path (leave blank if none)")
    const ticketsFile     = await askOptionalFile("Support tickets (CSV/JSON/TXT)")
    const extraContext    = await askOptionalFile("Any extra context file (product list, policies, PDF text)")

    // ── Behaviour ─────────────────────────────────────────────────
    console.log("\n── Agent Behaviour ─────────────────────────────────")
    const escalationPhone = await ask("Escalation phone (who gets notified on human handoff)", adminPhone)
    const scrapeWebsite   = await ask("Scrape website for product/service info? (yes/no)", "yes")

    rl.close()

    return {
        businessName, businessType, description, website,
        countryCode, currency, language,
        adminPhone, adminKeyword, adminPin, openaiKey,
        dbPath:          dbPath || null,
        ticketsFile:     ticketsFile || null,
        extraContext:    extraContext || null,
        escalationPhone,
        scrapeWebsite:   scrapeWebsite.toLowerCase().startsWith("y"),
    }
}

module.exports = { collect }
