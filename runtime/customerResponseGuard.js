"use strict"

const { normalizeCustomerExecutionConfig } = require("./customerExecutionConfig")

function stripMarkdown(text) {
    return String(text || "")
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
}

function normalizeWhitespace(text) {
    return String(text || "")
        .replace(/\r/g, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
}

function validateCustomerBackendResponse(response, options = {}) {
    const normalizedExecution = normalizeCustomerExecutionConfig(options.execution || {})
    const policy = normalizedExecution.response_policy
    const text = policy.strip_markdown ? stripMarkdown(response) : String(response || "")
    const cleaned = normalizeWhitespace(text)
    const fallback = options.fallback || "I'm sorry, I couldn't process that right now."
    const issues = []

    if (!cleaned) issues.push("empty_response")
    if (cleaned.length > policy.max_chars) issues.push("response_too_long")

    for (const pattern of policy.disallow_patterns) {
        if (!pattern) continue
        if (cleaned.toLowerCase().includes(pattern.toLowerCase())) {
            issues.push(`disallowed_pattern:${pattern}`)
        }
    }

    if (/\b(system prompt|internal policy|hidden instructions)\b/i.test(cleaned)) {
        issues.push("prompt_leak_language")
    }

    if (issues.length) {
        return {
            ok: false,
            response: fallback,
            issues,
            originalLength: cleaned.length,
        }
    }

    const bounded = cleaned.length > policy.max_chars ? cleaned.slice(0, policy.max_chars).trim() : cleaned
    return {
        ok: true,
        response: bounded,
        issues: [],
        originalLength: cleaned.length,
    }
}

module.exports = {
    validateCustomerBackendResponse,
}
