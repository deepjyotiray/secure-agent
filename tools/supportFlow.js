"use strict"

const fs = require("fs")
const yaml = require("js-yaml")
const fetch = require("node-fetch")
const settings = require("../config/settings.json")

const SEND_URL = `http://127.0.0.1:${settings.api.port}/send`
const SEND_SECRET = settings.api.secret

const DEFAULT_GENERIC_HELP_PATTERNS = [
    /^\s*(help|support|issue|problem|complaint)\s*$/i,
    /^\s*i need (help|support)\s*$/i,
    /^\s*need (help|support)\s*$/i,
    /^\s*can you help(?: me)?\s*$/i,
]

function normalisePhone(phone) {
    return String(phone || "").replace(/@.*$/, "").replace(/\D/g, "")
}

function loadFaq(faqPath) {
    if (!faqPath || !fs.existsSync(faqPath)) return { faqs: [], escalation_triggers: [] }
    try {
        return yaml.load(fs.readFileSync(faqPath, "utf8")) || { faqs: [], escalation_triggers: [] }
    } catch {
        return { faqs: [], escalation_triggers: [] }
    }
}

function matchFaq(message, faqs) {
    const text = String(message || "").toLowerCase()
    let best = null
    let bestScore = 0
    for (const faq of Array.isArray(faqs) ? faqs : []) {
        const score = (faq.keywords || []).reduce((count, keyword) => count + (text.includes(String(keyword || "").toLowerCase()) ? 1 : 0), 0)
        if (score > bestScore) {
            bestScore = score
            best = faq
        }
    }
    return bestScore > 0 ? best : null
}

function isEscalation(message, triggers) {
    const text = String(message || "").toLowerCase()
    return (triggers || []).some(trigger => text.includes(String(trigger || "").toLowerCase()))
}

function detectIssueType(text, issueTypePatterns = {}) {
    const message = String(text || "").trim()
    if (!message) return null

    let bestType = null
    let bestScore = 0
    for (const [issueType, patterns] of Object.entries(issueTypePatterns)) {
        const score = (patterns || []).reduce((count, pattern) => count + (pattern.test(message) ? 1 : 0), 0)
        if (score > bestScore) {
            bestScore = score
            bestType = Number(issueType)
        }
    }
    return bestScore > 0 ? bestType : null
}

function isGenericHelpMessage(text, patterns = DEFAULT_GENERIC_HELP_PATTERNS) {
    const message = String(text || "").trim()
    return (patterns || []).some(pattern => pattern.test(message))
}

function looksLikeIssueDescription(text, patterns = DEFAULT_GENERIC_HELP_PATTERNS) {
    const message = String(text || "").trim()
    if (!message || isGenericHelpMessage(message, patterns)) return false
    if (message.length >= 24) return true
    return message.split(/\s+/).filter(Boolean).length >= 5
}

async function escalateToAdmin({ phone, adminPhone, body, logger, successLog = "support: escalated to admin", errorLog = "support: escalation failed" }) {
    const to = String(adminPhone || "").startsWith("+") ? String(adminPhone) : `+${adminPhone}`
    try {
        await fetch(SEND_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-secret": SEND_SECRET },
            body: JSON.stringify({ phone: to, message: body }),
        })
        logger?.info?.({ phone }, successLog)
        return true
    } catch (err) {
        logger?.error?.({ err }, errorLog)
        return false
    }
}

module.exports = {
    DEFAULT_GENERIC_HELP_PATTERNS,
    normalisePhone,
    loadFaq,
    matchFaq,
    isEscalation,
    detectIssueType,
    isGenericHelpMessage,
    looksLikeIssueDescription,
    escalateToAdmin,
}
