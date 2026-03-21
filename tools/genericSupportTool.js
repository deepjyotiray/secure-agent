"use strict"

const fs       = require("fs")
const yaml     = require("js-yaml")
const fetch    = require("node-fetch")
const { complete } = require("../providers/llm")
const cart     = require("./cartStore")
const logger   = require("../gateway/logger")
const settings = require("../config/settings.json")

const SEND_URL    = `http://127.0.0.1:${settings.api.port}/send`
const SEND_SECRET = settings.api.secret

function normalisePhone(p) { return String(p).replace(/@.*$/, "").replace(/\D/g, "") }

function loadFaq(faqPath) {
    if (!faqPath || !fs.existsSync(faqPath)) return { faqs: [], escalation_triggers: [] }
    try {
        return yaml.load(fs.readFileSync(faqPath, "utf8")) || { faqs: [], escalation_triggers: [] }
    } catch { return { faqs: [], escalation_triggers: [] } }
}

function matchFaq(message, faqs) {
    const m = message.toLowerCase()
    let best = null, bestScore = 0
    for (const f of faqs) {
        const score = (f.keywords || []).reduce((n, kw) => n + (m.includes(kw) ? 1 : 0), 0)
        if (score > bestScore) { bestScore = score; best = f }
    }
    return bestScore > 0 ? best : null
}

function isEscalation(message, triggers) {
    const m = message.toLowerCase()
    return (triggers || []).some(t => m.includes(t.toLowerCase()))
}

async function escalate(phone, issueText, adminPhone) {
    const last10 = normalisePhone(phone).slice(-10)
    const to = adminPhone.startsWith("+") ? adminPhone : `+${adminPhone}`
    const msg = `🚨 *Support Escalation*\n\n👤 Customer: +${last10}\n💬 "${issueText}"`
    try {
        await fetch(SEND_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-secret": SEND_SECRET },
            body: JSON.stringify({ phone: to, message: msg })
        })
        logger.info({ phone }, "genericSupport: escalated to admin")
    } catch (err) {
        logger.error({ err }, "genericSupport: escalation failed")
    }
}

async function execute(_params, context, toolConfig) {
    const { phone, rawMessage: msg } = context
    const { faq_path, escalation_phone, business_name } = toolConfig
    const wp = context.profile || {}
    const adminPhone = escalation_phone || wp.contactPhone || settings.admin?.number || ""
    const text = (msg || "").trim()
    const key = `support:${phone}`

    const faq = loadFaq(faq_path)

    // check escalation triggers first
    if (isEscalation(text, faq.escalation_triggers)) {
        await escalate(phone, text, adminPhone)
        cart.clear(key)
        return "We've notified our team. Someone will get back to you shortly. 🙏"
    }

    // try FAQ match
    const match = matchFaq(text, faq.faqs || [])
    if (match) {
        return match.answer
    }

    // LLM fallback with FAQ context
    const faqContext = (faq.faqs || []).map(f =>
        `Topic: ${f.topic}\nKeywords: ${(f.keywords || []).join(", ")}\nAnswer: ${f.answer}`
    ).join("\n\n")

    const biz = business_name || wp.businessName || "the business"
    const profileFacts = context.profileFacts || ""
    const prompt = `You are a helpful support assistant for ${biz}.
Answer the customer's question using the FAQ knowledge below. Be concise and formatted for WhatsApp.
If you cannot answer from the FAQ, say: "I'm not sure about that. Would you like to talk to a human? Just say 'talk to human'."

Business profile:
${profileFacts}

FAQ Knowledge:
${faqContext || "No FAQ loaded."}

Customer message: ${text}

Answer:`

    try {
        const response = await complete(prompt)
        return response || "I'm not sure about that. Would you like to talk to a human? Just say 'talk to human'."
    } catch {
        return "I'm having trouble right now. Would you like to talk to a human? Just say 'talk to human'."
    }
}

module.exports = { execute }
