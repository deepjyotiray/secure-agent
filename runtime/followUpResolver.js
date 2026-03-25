"use strict"

const { resolvePackFollowUp } = require("../core/domainPacks")

function normalizeText(value = "") {
    return String(value).trim().replace(/\s+/g, " ")
}

function lower(value = "") {
    return normalizeText(value).toLowerCase()
}

function getActiveReference(state = {}) {
    if (state.selection?.label) {
        return { label: normalizeText(state.selection.label), source: "selection" }
    }
    if (state.topic?.label) {
        return { label: normalizeText(state.topic.label), source: "topic" }
    }
    if (typeof state.filters?.query === "string" && state.filters.query.trim()) {
        return { label: normalizeText(state.filters.query), source: "filter" }
    }
    return null
}

function isLikelyFollowUp(text) {
    const cleaned = lower(text)
    if (!cleaned) return false
    if (cleaned.split(/\s+/).length <= 4) return true
    return [
        /\b(what all|which ones|what else|show all|show me all)\b/,
        /\b(how much|what price|price|cost)\b/,
        /\b(veg|non[- ]?veg|under \d+|below \d+|above \d+|cheap|high protein|low fat)\b/,
        /\b(it|that|those|these|them|ones)\b/,
        /\b(available\??)\b/,
        /\b(what about|how about|same for)\b/,
    ].some(pattern => pattern.test(cleaned))
}

function resolveCustomerFollowUp(message, state) {
    const text = normalizeText(message)
    const cleaned = lower(text)
    const ref = getActiveReference(state)
    if (!ref || !isLikelyFollowUp(text)) return null

    if (/^(what all|which ones|show( me)? all|what options|what do you have|what else)\b/i.test(cleaned)) {
        return {
            message: `show all ${ref.label}`,
            reason: "expand_active_topic",
            confidence: 0.9,
        }
    }

    if (/\b(how much|what price|price|cost)\b/i.test(cleaned)) {
        return {
            message: `${ref.label} price`,
            reason: "price_for_active_reference",
            confidence: ref.source === "selection" ? 0.92 : 0.72,
        }
    }

    if (/^(any\s+)?(veg|non[- ]?veg|under \d+|below \d+|above \d+|cheap|high protein|low fat)/i.test(cleaned)) {
        return {
            message: `${ref.label} ${text}`,
            reason: "apply_filter_to_active_topic",
            confidence: 0.82,
        }
    }

    if (/^(available\??|is it available\??|do you have it\??)$/i.test(cleaned)) {
        return {
            message: `${ref.label} available`,
            reason: "availability_for_active_reference",
            confidence: 0.8,
        }
    }

    if (/^(what about|how about|same for)\b/i.test(cleaned)) {
        return {
            message: `${ref.label} ${text}`,
            reason: "carry_forward_topic",
            confidence: 0.7,
        }
    }

    if (/^(it|that|those|these|them|ones)\b/i.test(cleaned)) {
        return {
            message: `${ref.label} ${text}`,
            reason: "pronoun_reference",
            confidence: 0.68,
        }
    }

    return null
}

function resolveAdminFollowUp(message, state) {
    const text = normalizeText(message)
    const cleaned = lower(text)
    const ref = getActiveReference(state) || (state.lastMessage ? { label: normalizeText(state.lastMessage), source: "last_message" } : null)
    if (!ref || !isLikelyFollowUp(text)) return null

    if (/^(what about|how about|same for)\b/i.test(cleaned)) {
        return {
            message: `${ref.label} ${text}`,
            reason: "carry_forward_admin_topic",
            confidence: 0.72,
        }
    }

    if (/^(and|also)\b/i.test(cleaned)) {
        return {
            message: `${ref.label} ${text}`,
            reason: "extend_admin_request",
            confidence: 0.65,
        }
    }

    if (/^(yesterday|today|tomorrow|this week|last week|this month|last month)\b/i.test(cleaned)) {
        return {
            message: `${ref.label} ${text}`,
            reason: "apply_time_to_admin_topic",
            confidence: 0.78,
        }
    }

    return null
}

function resolveFollowUp({ flow, message, conversationState, domainPack } = {}) {
    const original = normalizeText(message)
    if (!original) return { message: original, resolved: false, reason: null, confidence: 0 }

    let resolved = null
    if (flow === "customer") resolved = resolveCustomerFollowUp(original, conversationState || {})
    else if (flow === "admin") resolved = resolveAdminFollowUp(original, conversationState || {})

    if (!resolved) {
        resolved = resolvePackFollowUp(domainPack, {
            flow,
            message: original,
            conversationState,
        })
    }

    if (!resolved || !resolved.message || normalizeText(resolved.message) === original) {
        return { message: original, resolved: false, reason: null, confidence: 0 }
    }

    return {
        message: normalizeText(resolved.message),
        resolved: true,
        reason: resolved.reason || "follow_up_resolution",
        confidence: Number(resolved.confidence || 0.6),
    }
}

module.exports = { resolveFollowUp }
