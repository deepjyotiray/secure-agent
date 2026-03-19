"use strict"

const path = require("path")
const fs   = require("fs")

async function main() {
    const { collect }  = require("./collect")
    const { assemble } = require("./ingest")
    const { generate } = require("./generate")

    // 1. Collect inputs interactively
    const inputs = await collect()

    // 2. Assemble context from all data sources
    inputs.context = await assemble(inputs)

    // 3. Generate all configs via GPT-4o
    const { slug, draftDir, manifestObj, faqObj, policyObj } = await generate(inputs)

    // 4. Print summary
    console.log("\n╔══════════════════════════════════════════════════╗")
    console.log("║   Setup Complete — Review Your Draft Files       ║")
    console.log("╚══════════════════════════════════════════════════╝\n")

    console.log("Generated files in draft/:\n")
    console.log(`  draft/agents/${slug}.yml          ← main agent manifest`)
    console.log(`  draft/agents/support/faq.yml      ← support FAQ & escalation`)
    console.log(`  draft/policy/policy.yml            ← domain keywords & intent policy`)
    console.log(`  draft/db/schema.sql                ← database schema`)
    console.log(`  draft/db/seed.js                   ← seed script with sample data`)
    console.log(`  draft/config/settings.json         ← runtime settings\n`)

    if (manifestObj?.intents) {
        console.log("Detected intents:")
        for (const intent of Object.keys(manifestObj.intents)) {
            console.log(`  • ${intent}`)
        }
    }

    if (policyObj?.domain_keywords) {
        console.log(`\nDomain keywords: ${policyObj.domain_keywords.length} generated`)
    }

    if (faqObj?.faqs) {
        console.log(`FAQ topics: ${faqObj.faqs.length} generated`)
        for (const f of faqObj.faqs) console.log(`  • ${f.topic}`)
    }

    console.log("\n── What to do next ─────────────────────────────────")
    console.log("  1. Open each file in draft/ and review carefully")
    console.log("  2. Edit anything that doesn't look right")
    console.log("  3. When ready, run:")
    console.log("     node setup/promote.js\n")
}

main().catch(err => {
    console.error("\n❌ Setup failed:", err.message)
    process.exit(1)
})
