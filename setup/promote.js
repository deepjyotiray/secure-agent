"use strict"

const fs      = require("fs")
const path    = require("path")
const readline = require("readline")

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
function ask(q) { return new Promise(r => rl.question(q, r)) }

function copyFile(src, dest) {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(src, dest)
    console.log(`  ✅ ${path.relative(process.cwd(), dest)}`)
}

async function promote() {
    const draftDir = path.resolve("draft")

    if (!fs.existsSync(draftDir)) {
        console.error("No draft/ directory found. Run: node setup/index.js first.")
        process.exit(1)
    }

    console.log("\n╔══════════════════════════════════════════════════╗")
    console.log("║   Promote Draft → Live Config                    ║")
    console.log("╚══════════════════════════════════════════════════╝\n")

    // Show what will be promoted
    console.log("Files to promote:\n")
    const files = getAllFiles(draftDir)
    for (const f of files) {
        const rel = path.relative(draftDir, f)
        console.log(`  draft/${rel}`)
    }

    console.log()
    const confirm = await ask("Have you reviewed all draft files? Promote to live? (yes/no): ")
    if (!confirm.trim().toLowerCase().startsWith("y")) {
        console.log("\nAborted. Edit files in draft/ then run this again.")
        rl.close()
        return
    }

    console.log("\n── Promoting files ─────────────────────────────────")

    for (const src of files) {
        const rel  = path.relative(draftDir, src)
        // config/settings.json → config/settings.json
        // agents/x.yml        → agents/x.yml
        // policy/policy.yml   → policy/policy.yml
        // db/schema.sql       → db/schema.sql (not overwriting live DB)
        const dest = path.resolve(rel)
        copyFile(src, dest)
    }

    // Run seed if DB doesn't exist yet
    const seedPath = path.resolve("draft/db/seed.js")
    if (fs.existsSync(seedPath)) {
        const runSeed = await ask("\nRun seed.js to create and populate the database? (yes/no): ")
        if (runSeed.trim().toLowerCase().startsWith("y")) {
            console.log("\n── Seeding database ────────────────────────────────")
            const { execSync } = require("child_process")
            try {
                execSync(`node ${seedPath}`, { stdio: "inherit" })
                console.log("  ✅ Database seeded")
            } catch (e) {
                console.error("  ❌ Seed failed:", e.message)
            }
        }
    }

    console.log("\n── Next steps ──────────────────────────────────────")
    console.log("  1. Review config/settings.json — verify all values")
    console.log("  2. Review agents/*.yml — check intents and tool configs")
    console.log("  3. Review agents/support/faq.yml — edit answers to match your policies")
    console.log("  4. Review policy/policy.yml — add any missing domain keywords")
    console.log("  5. Start the agent:")
    console.log("     node index.js --agent agents/<name>.yml --transport whatsapp\n")

    rl.close()
}

function getAllFiles(dir) {
    const results = []
    for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry)
        if (fs.statSync(full).isDirectory()) results.push(...getAllFiles(full))
        else results.push(full)
    }
    return results
}

module.exports = { promote }

if (require.main === module) {
    promote().catch(err => { console.error(err); process.exit(1) })
}
