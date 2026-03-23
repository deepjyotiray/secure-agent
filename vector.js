"use strict"

const Database = require("better-sqlite3")
const lancedb = require("@lancedb/lancedb")

const DB_PATH = process.env.DB_PATH || "./data/orders.db"
const VECTOR_DIM = 384

function buildChunks(db) {
    const chunks = []

    // ── Menu sections + items ──────────────────────────────────────────────
    const sections = db.prepare(`
        SELECT s.id, s.section_key, s.title, s.menu_type
        FROM menu_sections s
        WHERE s.available = 1 AND s.menu_type IN ('main', 'motd')
        ORDER BY s.menu_type, s.position
    `).all()

    for (const section of sections) {
        const items = db.prepare(`
            SELECT name, price, veg, description, calories, protein
            FROM menu_items
            WHERE section_id = ? AND available = 1
            ORDER BY position
        `).all(section.id)

        if (!items.length) continue

        const lines = [`${section.title} (${section.menu_type === "motd" ? "Today's Special" : "Menu"})`]
        for (const item of items) {
            const tag = item.veg ? "🟢 Veg" : "🍗 Non-Veg"
            let line = `• ${item.name} — ₹${item.price} [${tag}]`
            if (item.calories) line += ` | ${item.calories} kcal`
            if (item.protein) line += ` | ${item.protein}g protein`
            if (item.description) line += `\n  ${item.description}`
            lines.push(line)
        }

        chunks.push({
            id: `section_${section.id}`,
            type: "menu",
            keywords: [section.section_key, section.title, ...items.map(i => i.name)].join(" ").toLowerCase(),
            text: lines.join("\n")
        })
    }

    // ── Coupons ────────────────────────────────────────────────────────────
    const coupons = db.prepare(`
        SELECT code, discount, min_order, free_delivery, is_percent, max_discount, free_delivery_only
        FROM coupons WHERE active = 1
    `).all()

    if (coupons.length) {
        const lines = ["🎟️ Active Coupons & Offers"]
        for (const c of coupons) {
            if (c.free_delivery_only) {
                lines.push(`• ${c.code} — Free delivery on orders above ₹${c.min_order}`)
            } else if (c.is_percent) {
                lines.push(`• ${c.code} — ${c.discount}% off (max ₹${c.max_discount}) on orders above ₹${c.min_order}`)
            } else {
                lines.push(`• ${c.code} — ₹${c.discount} off on orders above ₹${c.min_order}`)
            }
        }
        chunks.push({
            id: "coupons",
            type: "coupons",
            keywords: "coupon discount offer promo code deal",
            text: lines.join("\n")
        })
    }

    // ── General info ───────────────────────────────────────────────────────
    chunks.push({
        id: "general",
        type: "info",
        keywords: "order place how website delivery contact info about business",
        text: `Healthy Meal Spot — home-style Indian food.\n\nTo place an order visit our website at healthymealspot.com.\nFor help, reply with "help" or "menu".\nContact: kitchen@healthymealspot.com | +91 95946 14752`
    })

    // ── Policy ─────────────────────────────────────────────────────────────
    const policyPath = "./data/restaurant_policy.txt"
    if (require("fs").existsSync(policyPath)) {
        const policyContent = require("fs").readFileSync(policyPath, "utf-8")
        const policySections = policyContent.split(/\n(?=\d+\.)/)
        for (let i = 0; i < policySections.length; i++) {
            const section = policySections[i].trim()
            if (!section) continue
            const titleMatch = section.match(/^\d+\.\s*(.+):/)
            const title = titleMatch ? titleMatch[1] : `Policy Section ${i + 1}`
            chunks.push({
                id: `policy_${i + 1}`,
                type: "policy",
                keywords: `policy ${title.toLowerCase()} refund return cancellation delivery payment contact`,
                text: section
            })
        }
    }

    // ── Admin knowledge ────────────────────────────────────────────────────
    chunks.push({
        id: "admin_kpi_definitions",
        type: "admin",
        keywords: "kpi revenue profit orders summary business health formula",
        text: `BUSINESS KPI DEFINITIONS:
- Today's Revenue: SUM(total) from orders where order_for = current_date and payment_status = 'Paid'
- Month's Revenue: SUM(total) from orders where payment_status = 'Paid' and order_date starts with current_month
- Monthly Net Profit: (Total Revenue + Other Income) - Total Expenses
- Active Orders: count of orders with delivery_status NOT IN ('Delivered', 'Cancelled')
- Active Subscriptions: count of subscriptions with status = 'Active'
- Actual Deliveries: count from subscription_deliveries grouped by subscription_id`
    })

    chunks.push({
        id: "admin_query_guide",
        type: "admin",
        keywords: "query database tables sql help how to join",
        text: `ADMIN QUERY GUIDE:
- Table "orders": stores customer orders, statuses (payment_status, delivery_status), and totals.
- Table "expenses": stores daily business expenses and non-order income.
- Table "subscriptions": stores long-term meal plans. Join with "subscription_deliveries" on subscription_id to count delivered meals.
- For business health checks, always check current month's revenue vs expenses.
- Current date is provided in the system prompt. Use it for date-based queries.`
    })

    return chunks
}

async function seed() {
    const db = new Database(DB_PATH, { readonly: true })
    const chunks = buildChunks(db)
    db.close()

    console.log(`Built ${chunks.length} knowledge chunks`)

    const ldb = await lancedb.connect("./vectordb")

    // Drop existing table and recreate
    try { await ldb.dropTable("restaurant") } catch {}

    const rows = chunks.map(c => ({
        vector: new Array(VECTOR_DIM).fill(0),
        id: c.id,
        type: c.type,
        keywords: c.keywords,
        text: c.text
    }))

    await ldb.createTable("restaurant", rows)
    console.log(`✅ Loaded ${rows.length} chunks into vectordb/restaurant`)
    chunks.forEach(c => console.log(` - [${c.type}] ${c.id}`))
}

seed().catch(err => { console.error(err); process.exit(1) })
