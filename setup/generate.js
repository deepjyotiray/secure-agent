"use strict"

const fetch = require("node-fetch")
const fs    = require("fs")
const path  = require("path")
const yaml  = require("js-yaml")

async function callGpt(apiKey, systemPrompt, userContent) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({
            model: "gpt-4o",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user",   content: userContent }
            ],
            temperature: 0.3,
            max_tokens: 4000
        })
    })
    const data = await res.json()
    if (data.error) throw new Error(data.error.message)
    return (data.choices?.[0]?.message?.content || "").trim()
}

function extractBlock(text, lang) {
    const re = new RegExp("```" + lang + "\\s*([\\s\\S]*?)```", "i")
    const m  = text.match(re)
    return m ? m[1].trim() : text.trim()
}

// ── Prompt 1: Main agent manifest ─────────────────────────────────────────
function manifestPrompt(inputs) {
    const slug = inputs.businessName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")
    return {
        system: `You are an expert at configuring WhatsApp AI agent manifests in YAML.
Generate a complete agent manifest YAML for the business described.
The manifest must follow this exact structure:

agent:
  name: <slug>-agent
  domain: <domain>
  version: "1.0.0"
  description: "<description>"
  chain:
    - agents/support.yml
  greet_message: "<warm welcome with what the bot can do>"
  help_message: "<list of capabilities>"
  out_of_domain_message: "<polite refusal>"
  restricted_message: "Sorry, I cannot perform that request."
  error_message: "Something went wrong. Please try again."

intent_hints:
  greet: "customer says hi, hello, hey or any greeting"
  help: "customer asks what can you do or asks for help"
  <intent>: "<plain English description of when this intent triggers>"
  ... (add 3-8 business-specific intents based on what the business does)

intents:
  greet:
    tool: static_greet
    auth_required: false
  help:
    tool: static_help
    auth_required: false
  <intent>:
    tool: <tool_name>
    auth_required: false
  ...

tools:
  static_greet:
    type: static
  static_help:
    type: static
  <tool_name>:
    type: rag   # use rag for product/catalogue queries
    db_path: "<DB_PATH_PLACEHOLDER>"
    vectordb_path: "./vectordb"
    system_prompt: |
      <business-specific system prompt for this tool>
  <tool_name>:
    type: sqlite  # use sqlite for order/booking/appointment status
    db_path: "<DB_PATH_PLACEHOLDER>"
    ...
  <tool_name>:
    type: support
    faq_path: "./agents/support/faq.yml"
    db_path: "<DB_PATH_PLACEHOLDER>"
    business_name: "${inputs.businessName}"
    escalation_phone: "<ESCALATION_PHONE_PLACEHOLDER>"

Rules:
- Use rag tool for catalogue/product/menu browsing
- Use sqlite tool for order/booking/appointment status lookups
- Use static for greet/help
- DB_PATH_PLACEHOLDER and ESCALATION_PHONE_PLACEHOLDER will be replaced automatically
- Output ONLY the YAML block, no explanation`,
        user: `Business context:\n\n${inputs.context}\n\nGenerate the manifest YAML.`
    }
}

// ── Prompt 2: FAQ ──────────────────────────────────────────────────────────
function faqPrompt(inputs) {
    return {
        system: `You are an expert at creating customer support FAQ knowledge bases in YAML.
Generate a comprehensive faq.yml for the business described.

Structure:
faqs:
  - topic: <snake_case_topic>
    keywords: [word1, word2, word3, ...]  # 5-10 keywords customers would use
    answer: |
      <2-4 sentence answer. Be specific to this business. Include the website URL if relevant.
       End with: say "talk to human" if they need more help.>

  ... (generate 10-15 FAQs covering the most common customer issues for this type of business)

escalation_triggers:
  - talk to human
  - speak to someone
  - contact support
  - real person
  - manager
  - call me
  - phone number
  - <add 2-3 business-specific escalation phrases>

Rules:
- Keywords must be lowercase single words or short phrases customers actually type
- Answers must reference the actual business name and website
- Cover: product/service queries, pricing, delivery/availability, payment, refunds, complaints, hours
- If support tickets were provided, extract the most common issues and create FAQs for them
- Output ONLY the YAML block`,
        user: `Business context:\n\n${inputs.context}\n\nWebsite: ${inputs.website || "not provided"}\nBusiness name: ${inputs.businessName}\n\nGenerate the faq.yml.`
    }
}

// ── Prompt 3: Policy ───────────────────────────────────────────────────────
function policyPrompt(inputs) {
    return {
        system: `You are an expert at configuring AI agent security policies in YAML.
Generate a policy.yml for the business described.

Structure:
allowed_intents:
  - greet
  - help
  - <intent>   # intents the main agent handles
  ...

restricted_intents:
  - <intent>   # intents that should be blocked (e.g. create_order, delete_item, admin actions)
  ...

domain_keywords:
  # Single words that indicate a message is about this business domain
  # Include: product names, service terms, action words, common customer phrases
  - <word>
  ... (30-60 keywords)

Rules:
- allowed_intents must exactly match the intents defined in the manifest
- restricted_intents are things customers might ask but should not be allowed (mutations, admin ops)
- domain_keywords are single lowercase words — include product names, service terms, brand terms
- More keywords = better domain gate coverage = fewer false rejections
- Output ONLY the YAML block`,
        user: `Business context:\n\n${inputs.context}\n\nGenerate the policy.yml. The allowed intents must match the manifest intents exactly.`
    }
}

// ── Prompt 4: DB Schema ────────────────────────────────────────────────────
function schemaPrompt(inputs) {
    return {
        system: `You are an expert at designing SQLite database schemas for small businesses.
Generate two files:

1. schema.sql — CREATE TABLE statements for all tables needed to run this business on WhatsApp
   - Always include: users table (id, name, mobile, created_at)
   - Include business-specific tables (orders, products, appointments, inventory, etc.)
   - Use appropriate column types, NOT NULL constraints, defaults
   - Add indexes on frequently queried columns (phone, status, date)

2. seed.js — A Node.js script using better-sqlite3 that:
   - Creates the DB at ./data/<business-slug>.db
   - Runs the schema
   - Inserts realistic sample data (5-10 rows per table)
   - Exports the db path

Separate the two with exactly this line: ===SEED===

Rules:
- Schema must support the intents in the manifest (if order_status intent exists, need orders table)
- Column names must be consistent with what the sqliteTool expects: phone, status, created_at, total
- Output ONLY sql block, then ===SEED===, then js block. No explanation.`,
        user: `Business context:\n\n${inputs.context}\n\nBusiness name: ${inputs.businessName}\nSlug: ${inputs.businessName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")}\n\nGenerate schema.sql and seed.js.`
    }
}

// ── Main generate function ─────────────────────────────────────────────────
async function generate(inputs) {
    console.log("\n── Generating configs with GPT-4o ──────────────────")
    console.log("  Running 4 parallel generation calls...\n")

    const slug = inputs.businessName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")
    const dbPath = inputs.dbPath || `./data/${slug}.db`

    const p1 = manifestPrompt(inputs)
    const p2 = faqPrompt(inputs)
    const p3 = policyPrompt(inputs)
    const p4 = schemaPrompt(inputs)

    const [manifestRaw, faqRaw, policyRaw, schemaRaw] = await Promise.all([
        callGpt(inputs.openaiKey, p1.system, p1.user).then(r => { console.log("  ✅ Manifest generated"); return r }),
        callGpt(inputs.openaiKey, p2.system, p2.user).then(r => { console.log("  ✅ FAQ generated"); return r }),
        callGpt(inputs.openaiKey, p3.system, p3.user).then(r => { console.log("  ✅ Policy generated"); return r }),
        callGpt(inputs.openaiKey, p4.system, p4.user).then(r => { console.log("  ✅ DB schema generated"); return r }),
    ])

    // ── Post-process: inject real values ──────────────────────────
    const manifestYml = extractBlock(manifestRaw, "yaml")
        .replace(/<DB_PATH_PLACEHOLDER>/g, dbPath)
        .replace(/<ESCALATION_PHONE_PLACEHOLDER>/g, inputs.escalationPhone)

    const faqYml    = extractBlock(faqRaw, "yaml")
    const policyYml = extractBlock(policyRaw, "yaml")

    const schemaParts = schemaRaw.split("===SEED===")
    const schemaSql   = extractBlock(schemaParts[0] || "", "sql")
    const seedJs      = extractBlock(schemaParts[1] || "", "js")

    // ── Validate YAML parses ───────────────────────────────────────
    let manifestObj, faqObj, policyObj
    try { manifestObj = yaml.load(manifestYml) } catch (e) { console.warn("  ⚠️  Manifest YAML parse warning:", e.message) }
    try { faqObj      = yaml.load(faqYml)      } catch (e) { console.warn("  ⚠️  FAQ YAML parse warning:", e.message) }
    try { policyObj   = yaml.load(policyYml)   } catch (e) { console.warn("  ⚠️  Policy YAML parse warning:", e.message) }

    // ── Write draft files ──────────────────────────────────────────
    const workspaceId = String(inputs.workspaceId || slug || "default")
    const draftDir = path.resolve("draft", "workspaces", workspaceId)
    fs.mkdirSync(`${draftDir}/agents/support`, { recursive: true })
    fs.mkdirSync(`${draftDir}/db`,             { recursive: true })
    fs.mkdirSync(`${draftDir}/policy`,         { recursive: true })
    fs.mkdirSync(`${draftDir}/config`,         { recursive: true })

    fs.writeFileSync(`${draftDir}/agents/${slug}.yml`,         manifestYml)
    fs.writeFileSync(`${draftDir}/agents/support/faq.yml`,     faqYml)
    fs.writeFileSync(`${draftDir}/policy/policy.yml`,          policyYml)
    fs.writeFileSync(`${draftDir}/db/schema.sql`,              schemaSql)
    fs.writeFileSync(`${draftDir}/db/seed.js`,                 seedJs)

    // ── Generate settings.json ─────────────────────────────────────
    const settings = {
        llm: { provider: "openai", model: "gpt-4o-mini", api_key: inputs.openaiKey },
        otp: { ttlSeconds: 300 },
        log: { level: "info" },
        api: { port: 3001, secret: require("crypto").randomBytes(24).toString("hex") },
        admin: {
            number:        inputs.adminPhone,
            keyword:       inputs.adminKeyword,
            pin:           inputs.adminPin,
            db_path:       path.resolve(dbPath),
            business_name: inputs.businessName,
            agent_llm: {
                model:   "gpt-4o-mini",
                api_key: inputs.openaiKey
            }
        }
    }
    fs.writeFileSync(`${draftDir}/config/settings.json`, JSON.stringify(settings, null, 2))

    return { slug, draftDir, manifestObj, faqObj, policyObj }
}

module.exports = { generate }
