"use strict"

const cart = require("./cartStore")
const logger = require("../gateway/logger")
const settings = require("../config/settings.json")
const {
    loadFaq,
    matchFaq,
    isEscalation,
    normalisePhone,
    escalateToAdmin,
} = require("./supportFlow")

async function escalate(phone, issueText, adminPhone) {
    const last10 = normalisePhone(phone).slice(-10)
    const msg = `🚨 *Support Escalation*\n\n👤 Customer: +${last10}\n💬 "${issueText}"`
    await escalateToAdmin({
        phone,
        adminPhone,
        body: msg,
        logger,
        successLog: "genericSupport: escalated to admin",
        errorLog: "genericSupport: escalation failed",
    })
}

async function execute(_params, context, toolConfig) {
    const phone = context.phone
    const msg = context.resolvedRequest?.effectiveMessage || context.rawMessage
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
        const response = typeof context.prepareLLMRequest === "function"
            ? await context.prepareLLMRequest(prompt)
            : null
        return response || "I'm not sure about that. Would you like to talk to a human? Just say 'talk to human'."
    } catch {
        return "I'm having trouble right now. Would you like to talk to a human? Just say 'talk to human'."
    }
}

module.exports = { execute }
