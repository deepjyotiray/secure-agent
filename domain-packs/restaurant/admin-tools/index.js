"use strict"

const Database = require("better-sqlite3")

// ── Tool definitions (OpenAI function-calling format) ─────────────────────────

const toolDefinitions = [
    {
        type: "function",
        function: {
            name: "add_expense",
            description: "Add a manual expense or income entry to the expenses table. Use for recording daily expenses, purchases, or income.",
            parameters: {
                type: "object",
                properties: {
                    heading:    { type: "string", description: "Short label e.g. 'Vegetables', 'Gas', 'Salary'" },
                    expense:    { type: "number", description: "Expense amount in rupees (0 if income entry)" },
                    income:     { type: "number", description: "Income amount in rupees (0 if expense entry)" },
                    notes:      { type: "string", description: "Optional extra details" },
                    entry_date: { type: "string", description: "Date in DD/MM/YYYY format e.g. 27/02/2026. Defaults to today if omitted." }
                },
                required: ["heading"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "update_order",
            description: "Update delivery_status or payment_status of an order by order ID.",
            parameters: {
                type: "object",
                properties: {
                    order_id:        { type: "string", description: "The order ID" },
                    delivery_status: { type: "string", description: "New delivery status e.g. Confirmed, Preparing, Out for Delivery, Delivered, Cancelled" },
                    payment_status:  { type: "string", description: "New payment status e.g. Paid, Pending, Failed" }
                },
                required: ["order_id"]
            }
        }
    },
]

// ── Tool implementations ──────────────────────────────────────────────────────

function addExpense({ heading, expense = 0, income = 0, notes = "", entry_date }, dbPath) {
    const db = new Database(dbPath)
    try {
        const date = entry_date || (() => {
            const d = new Date()
            return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`
        })()
        const result = db.prepare(
            "INSERT INTO expenses (entry_date, expense, income, heading, notes) VALUES (?, ?, ?, ?, ?)"
        ).run(date, expense, income, heading, notes)
        return `✅ Expense added (id:${result.lastInsertRowid}): ${heading} | expense:₹${expense} income:₹${income} | date:${date}`
    } catch (err) {
        return `❌ DB error: ${err.message}`
    } finally { db.close() }
}

function updateOrder(args, dbPath) {
    const { order_id, delivery_status, payment_status } = args
    const db = new Database(dbPath)
    try {
        const sets = [], vals = []
        if (delivery_status) { sets.push("delivery_status = ?"); vals.push(delivery_status) }
        if (payment_status)  { sets.push("payment_status = ?");  vals.push(payment_status) }
        if (!sets.length) return "❌ Provide delivery_status or payment_status."
        vals.push(order_id)
        const result = db.prepare(`UPDATE orders SET ${sets.join(", ")} WHERE id = ?`).run(...vals)
        return result.changes > 0
            ? `✅ Order ${order_id} updated.${delivery_status ? ` Delivery: ${delivery_status}.` : ""}${payment_status ? ` Payment: ${payment_status}.` : ""}`
            : `❌ Order ${order_id} not found.`
    } catch (err) {
        return `❌ DB error: ${err.message}`
    } finally { db.close() }
}

// ── Dispatch (called by adminAgent when tool name matches) ────────────────────

function dispatch(toolName, args, dbPath) {
    switch (toolName) {
        case "add_expense":  return addExpense(args, dbPath)
        case "update_order": return updateOrder(args, dbPath)
        default:             return null
    }
}

// ── Admin context builder (restaurant-specific business summary) ──────────────

function buildAdminContext(dbPath) {
    const db = new Database(dbPath, { readonly: true })
    try {
        const now = new Date()
        const thisMonth = now.toISOString().slice(0, 7)
        const thisYear  = now.toISOString().slice(0, 4)
        const today     = now.toISOString().slice(0, 10)

        const todayOrders = db.prepare(`
            SELECT id, customer_name, phone, total, delivery_status, payment_status, order_for, expected_delivery
            FROM orders WHERE order_for = ?
            ORDER BY created_at DESC
        `).all(today)

        const todayRevenue = todayOrders.filter(o => o.payment_status === "Paid").reduce((s, o) => s + o.total, 0)

        const monthRevenue = db.prepare(`
            SELECT COALESCE(SUM(total),0) as rev, COUNT(*) as cnt
            FROM orders WHERE payment_status='Paid' AND order_date LIKE ?
        `).get(`${thisMonth}%`)

        const monthExpenses = db.prepare(`
            SELECT COALESCE(SUM(expense),0) as exp, COALESCE(SUM(income),0) as inc
            FROM expenses WHERE entry_date LIKE ? OR entry_date LIKE ?
        `).get(`${thisMonth}%`, `%/${now.getMonth()+1 < 10 ? '0'+(now.getMonth()+1) : now.getMonth()+1}/${thisYear}`)

        const yearRevenue = db.prepare(`
            SELECT COALESCE(SUM(total),0) as rev, COUNT(*) as cnt
            FROM orders WHERE payment_status='Paid' AND order_date LIKE ?
        `).get(`${thisYear}%`)

        const yearExpenses = db.prepare(`
            SELECT COALESCE(SUM(expense),0) as exp, COALESCE(SUM(income),0) as inc
            FROM expenses WHERE entry_date LIKE ? OR entry_date LIKE ?
        `).get(`${thisYear}%`, `%/${thisYear}`)

        const activeOrders = db.prepare(`
            SELECT id, customer_name, phone, total, delivery_status, payment_status, order_for, expected_delivery
            FROM orders WHERE delivery_status NOT IN ('Delivered','Cancelled')
            ORDER BY created_at DESC LIMIT 20
        `).all()

        const recentOrders = db.prepare(`
            SELECT id, customer_name, phone, total, delivery_status, payment_status, order_for
            FROM orders ORDER BY created_at DESC LIMIT 10
        `).all()

        const unpaidOrders = db.prepare(`
            SELECT id, customer_name, phone, total, order_for
            FROM orders WHERE payment_status != 'Paid' AND delivery_status NOT IN ('Delivered','Cancelled')
            ORDER BY created_at DESC
        `).all()

        return `
=== BUSINESS SUMMARY ===
Date: ${now.toDateString()} (${today})

Today (${today}):
- Orders: ${todayOrders.length}
- Paid revenue: ₹${todayRevenue}
- Orders detail:
${todayOrders.map(o => `  • ${o.id} | ${o.customer_name} | ₹${o.total} | Delivery: ${o.delivery_status} | Payment: ${o.payment_status}`).join("\n") || "  None"}

This Month (${thisMonth}):
- Revenue from orders: ₹${monthRevenue.rev} (${monthRevenue.cnt} paid orders)
- Expenses: ₹${monthExpenses.exp}
- Other income: ₹${monthExpenses.inc}
- Net profit: ₹${monthRevenue.rev + monthExpenses.inc - monthExpenses.exp}

This Year (${thisYear}):
- Revenue from orders: ₹${yearRevenue.rev} (${yearRevenue.cnt} paid orders)
- Expenses: ₹${yearExpenses.exp}
- Other income: ₹${yearExpenses.inc}
- Net profit: ₹${yearRevenue.rev + yearExpenses.inc - yearExpenses.exp}

Active Orders (${activeOrders.length}):
${activeOrders.map(o => `- ${o.id} | ${o.customer_name} | ${o.phone} | ₹${o.total} | Delivery: ${o.delivery_status} | Payment: ${o.payment_status} | For: ${o.order_for} by ${o.expected_delivery}`).join("\n") || "None"}

Unpaid Active Orders (${unpaidOrders.length}):
${unpaidOrders.map(o => `- ${o.id} | ${o.customer_name} | ${o.phone} | ₹${o.total} | For: ${o.order_for}`).join("\n") || "None"}

Recent Orders (last 10):
${recentOrders.map(o => `- ${o.id} | ${o.customer_name} | ₹${o.total} | ${o.delivery_status} | ${o.payment_status}`).join("\n")}
`.trim()
    } finally { db.close() }
}

// ── Vision prompt for expense image parsing ───────────────────────────────────

const visionPrompt = 'Extract all expense and income entries from this image. Return ONLY a JSON array, no explanation. Each item: {"heading": string, "expense": number, "income": number, "date": "DD/MM/YYYY or empty", "notes": string}. Use 0 for the field that does not apply. Do not invent data not visible in the image.'

function insertVisionEntries(entries, dbPath) {
    const today = (() => { const d = new Date(); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}` })()
    const db = new Database(dbPath)
    const stmt = db.prepare("INSERT INTO expenses (entry_date, expense, income, heading, notes) VALUES (?, ?, ?, ?, ?)")
    const inserted = []
    try {
        for (const e of entries) {
            stmt.run(e.date || today, Number(e.expense) || 0, Number(e.income) || 0, e.heading || "Expense", e.notes || "")
            inserted.push(`• ${e.heading} — ₹${e.expense || e.income} (${e.date || today})`)
        }
    } finally { db.close() }
    return inserted
}

module.exports = { toolDefinitions, dispatch, buildAdminContext, visionPrompt, insertVisionEntries }
