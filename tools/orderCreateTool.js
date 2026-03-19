"use strict"

const Database = require("better-sqlite3")
const fetch    = require("node-fetch")
const cart     = require("./cartStore")
const settings = require("../config/settings.json")

const SEND_SECRET = settings.api.secret
const SEND_URL    = `http://127.0.0.1:${settings.api.port}/send`

// ── db helpers ────────────────────────────────────────────────────────────────

function normalisePhone(p) { return String(p).replace(/@.*$/, "").replace(/\D/g, "") }
function e164(p) { const d = normalisePhone(p); return `+${d.length === 10 ? "91" + d : d}` }
function orderId() { return `RAY-${Date.now()}` }

function getDb(dbPath) {
    const db = new Database(dbPath, { readonly: true })
    db.pragma("busy_timeout = 5000")
    return db
}

function getUser(dbPath, phone) {
    const db = getDb(dbPath)
    try { return db.prepare("SELECT * FROM users WHERE mobile LIKE ?").get(`%${normalisePhone(phone).slice(-10)}`) }
    finally { db.close() }
}

function getSections(dbPath) {
    const db = getDb(dbPath)
    try {
        return db.prepare(`
            SELECT id, title FROM menu_sections
            WHERE available = 1 AND menu_type IN ('main','motd') AND section_key NOT IN ('healthySubs')
            ORDER BY position
        `).all()
    } finally { db.close() }
}

function getSectionItems(dbPath, sectionId) {
    const db = getDb(dbPath)
    try {
        return db.prepare(`
            SELECT id, name, price, veg FROM menu_items
            WHERE section_id = ? AND available = 1 ORDER BY position
        `).all(sectionId)
    } finally { db.close() }
}

async function postToBackend(url, body) {
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    })
    return res.json()
}

// ── formatting ────────────────────────────────────────────────────────────────

function formatSections(sections) {
    return sections.map((s, i) => `${i + 1}. ${s.title}`).join("\n")
}

function formatItems(items) {
    return items.map((it, i) => `${i + 1}. ${it.name} — ₹${it.price} ${it.veg ? "🟢" : "🍗"}`).join("\n")
}

function formatCart(items) {
    const lines = items.map(i => `• ${i.name} × ${i.qty} — ₹${i.price * i.qty}`)
    const total = items.reduce((s, i) => s + i.price * i.qty, 0)
    return lines.join("\n") + `\n\n💰 *Total: ₹${total}*`
}

const HOME = `What would you like to do?\n\n1. Browse Menu\n2. Place Order\n3. Order Support`

// ── state machine ─────────────────────────────────────────────────────────────

async function execute(_params, context, toolConfig) {
    const { db_path, backend_url } = toolConfig
    const { phone, rawMessage: msg } = context
    const text = (msg || "").trim()
    const n    = parseInt(text, 10)

    const c = cart.get(phone)

    // ── No active cart — handle home choices or show home ─────────────────────
    if (!c) {
        if (n === 1) {
            const sections = getSections(db_path)
            cart.set(phone, { state: "browsing_section", sections, items: [], user: null })
            return `*Menu Sections*\n\n${formatSections(sections)}\n\nReply with a number to browse, or *0* to go back.`
        }
        if (n === 2) {
            const user = getUser(db_path, phone)
            if (!user) {
                cart.set(phone, { state: "registering_name", items: [], user: null })
                return "To place an order I need a few details first.\n\nWhat's your *full name*?"
            }
            const sections = getSections(db_path)
            cart.set(phone, { state: "order_section", sections, items: [], user })
            return `Hi ${user.name}! 👋\n\n*Select a section to order from:*\n\n${formatSections(sections)}\n\nReply with a number, or *0* to go back.`
        }
        if (n === 3) {
            cart.set(phone, { state: "support_handoff", items: [], user: null })
            return null   // agentChain routes to support
        }
        return HOME
    }

    const { state } = c

    // ── Registration ──────────────────────────────────────────────────────────
    if (state === "registering_name") {
        if (text === "0") { cart.clear(phone); return HOME }
        if (text.length < 2) return "Please enter your full name.\n\nOr reply *0* to go back."
        cart.update(phone, { state: "registering_address", regName: text })
        return `Nice to meet you, ${text}! 📍\n\nWhat's your *delivery address*?`
    }

    if (state === "registering_address") {
        if (text === "0") { cart.clear(phone); return HOME }
        if (text.length < 5) return "Please enter your full delivery address."
        const result = await postToBackend(`${backend_url}/users/register`, {
            name: c.regName, mobile: e164(phone), address: text
        })
        if (!result.success) return "Registration failed. Please try again."
        const sections = getSections(db_path)
        cart.update(phone, { state: "order_section", sections, user: result.user, regName: undefined })
        return `You're registered! ✅\n\nHi ${result.user.name}! *Select a section to order from:*\n\n${formatSections(sections)}\n\nReply with a number, or *0* to go back.`
    }

    // ── Browse menu ───────────────────────────────────────────────────────────
    if (state === "browsing_section") {
        if (text === "0") { cart.clear(phone); return HOME }
        if (!n || n < 1 || n > c.sections.length) return `Please reply with a number between 1 and ${c.sections.length}, or *0* to go back.`
        const sec   = c.sections[n - 1]
        const items = getSectionItems(db_path, sec.id)
        cart.update(phone, { state: "browsing_items", currentSection: sec, sectionItems: items })
        return `*${sec.title}*\n\n${formatItems(items)}\n\nReply with a number to see details, or *0* to go back.`
    }

    if (state === "browsing_items") {
        if (text === "0") {
            cart.update(phone, { state: "browsing_section" })
            return `*Menu Sections*\n\n${formatSections(c.sections)}\n\nReply with a number, or *0* to go back.`
        }
        if (!n || n < 1 || n > c.sectionItems.length) return `Please reply with a number between 1 and ${c.sectionItems.length}, or *0* to go back.`
        const item = c.sectionItems[n - 1]
        return `*${item.name}*\n₹${item.price} ${item.veg ? "🟢 Veg" : "🍗 Non-Veg"}\n\nReply *0* to go back.`
    }

    // ── Order flow ────────────────────────────────────────────────────────────
    if (state === "order_section") {
        if (text === "0") { cart.clear(phone); return HOME }
        if (!n || n < 1 || n > c.sections.length) return `Please reply with a number between 1 and ${c.sections.length}, or *0* to go back.`
        const sec   = c.sections[n - 1]
        const items = getSectionItems(db_path, sec.id)
        cart.update(phone, { state: "order_item", currentSection: sec, sectionItems: items })
        return `*${sec.title}*\n\n${formatItems(items)}\n\nReply with the item number to add it, or *0* to go back.`
    }

    if (state === "order_item") {
        if (text === "0") {
            cart.update(phone, { state: "order_section" })
            return `*Select a section:*\n\n${formatSections(c.sections)}\n\nReply with a number, or *0* to go back.`
        }
        if (!n || n < 1 || n > c.sectionItems.length) return `Please reply with a number between 1 and ${c.sectionItems.length}, or *0* to go back.`
        const item = c.sectionItems[n - 1]
        cart.update(phone, { state: "order_qty", pendingItem: item })
        return `*${item.name}* — ₹${item.price}\n\nHow many? Reply with a number (e.g. *1*, *2*, *3*)`
    }

    if (state === "order_qty") {
        if (text === "0") {
            cart.update(phone, { state: "order_item" })
            return `*${c.currentSection.title}*\n\n${formatItems(c.sectionItems)}\n\nReply with the item number, or *0* to go back.`
        }
        if (!n || n < 1 || n > 20) return "Please reply with a number between 1 and 20."
        const item         = c.pendingItem
        const updatedItems = [...c.items]
        const existing     = updatedItems.find(i => i.id === item.id)
        if (existing) existing.qty += n
        else updatedItems.push({ ...item, qty: n })
        cart.update(phone, { state: "order_add_more", items: updatedItems, pendingItem: undefined })
        return `Added *${item.name} × ${n}* ✅\n\n${formatCart(updatedItems)}\n\n1. Add more items\n2. Checkout`
    }

    if (state === "order_add_more") {
        if (n === 1) {
            cart.update(phone, { state: "order_section" })
            return `*Select a section:*\n\n${formatSections(c.sections)}\n\nReply with a number, or *0* to go back.`
        }
        if (n === 2) {
            cart.update(phone, { state: "order_time" })
            return `${formatCart(c.items)}\n\n📍 *Deliver to:* ${c.user.address}\n\n⏰ What time would you like delivery?\n_(e.g. 7pm, 7:30 PM, as soon as possible)_`
        }
        return `Please reply *1* to add more items or *2* to checkout.`
    }

    if (state === "order_time") {
        if (text === "0") {
            cart.update(phone, { state: "order_add_more" })
            return `${formatCart(c.items)}\n\n1. Add more items\n2. Checkout`
        }
        if (text.length < 2) return "Please enter a delivery time (e.g. *7pm*, *as soon as possible*)."
        cart.update(phone, { state: "order_confirm", deliveryTime: text })
        return `📋 *Order Summary*\n\n${formatCart(c.items)}\n\n📍 *Deliver to:* ${c.user.address}\n⏰ *By:* ${text}\n\n1. Confirm Order\n2. Edit Items\n3. Cancel`
    }

    if (state === "order_confirm") {
        if (n === 2) {
            cart.update(phone, { state: "order_section" })
            return `*Select a section to add items:*\n\n${formatSections(c.sections)}\n\nReply with a number, or *0* to go back.`
        }
        if (n === 3) {
            cart.clear(phone)
            return `Order cancelled.\n\n${HOME}`
        }
        if (n !== 1) return `Please reply *1* to confirm, *2* to edit, or *3* to cancel.`

        const id       = orderId()
        const total    = c.items.reduce((s, i) => s + i.price * i.qty, 0)
        const itemsStr = c.items.map(i => `${i.name} × ${i.qty}`).join(", ")
        const now      = new Date()

        const result = await postToBackend(`${backend_url}/orders`, {
            orderId:          id,
            customer:         c.user.name,
            phone:            e164(phone),
            address:          c.user.address,
            items:            itemsStr,
            total,
            orderDate:        now.toISOString().slice(0, 10),
            orderTime:        now.toTimeString().slice(0, 8),
            orderFor:         now.toISOString().slice(0, 10),
            expectedDelivery: c.deliveryTime,
            notes:            "Placed via WhatsApp"
        })

        if (!result.success) return "Sorry, something went wrong. Please try again."

        cart.clear(phone)
        return `✅ *Order Placed!*\n\n🧾 Order ID: *${id}*\n\n${itemsStr}\n💰 Total: ₹${total}\n⏰ Expected by: ${c.deliveryTime}\n\nYou'll receive an invoice with payment details shortly. Thank you! ❤️`
    }

    cart.clear(phone)
    return HOME
}

module.exports = { execute }
