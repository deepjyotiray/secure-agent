"use strict"

const VALID_STRATEGIES = new Set(["auto", "tool_first", "backend_first", "hybrid"])
const DEFAULT_BACKEND_CAPABILITIES = {
    conversational: true,
    structured: false,
    memory: false,
    handoffs: false,
    structured_output: false,
}
const DEFAULT_RESPONSE_POLICY = {
    max_chars: 1200,
    strip_markdown: false,
    disallow_patterns: [],
}

function toStringList(value) {
    if (!Array.isArray(value)) return []
    const out = []
    const seen = new Set()
    for (const raw of value) {
        const val = String(raw || "").trim()
        if (!val || seen.has(val)) continue
        seen.add(val)
        out.push(val)
    }
    return out
}

function normalizeCapabilities(value = {}) {
    return {
        conversational: value.conversational !== false,
        structured: !!value.structured,
        memory: !!value.memory,
        handoffs: !!value.handoffs,
        structured_output: !!value.structured_output,
    }
}

function normalizeResponsePolicy(value = {}) {
    const maxCharsRaw = Number(value.max_chars)
    const maxChars = Number.isFinite(maxCharsRaw) ? Math.max(80, Math.min(4000, Math.round(maxCharsRaw))) : DEFAULT_RESPONSE_POLICY.max_chars
    return {
        max_chars: maxChars,
        strip_markdown: !!value.strip_markdown,
        disallow_patterns: toStringList(value.disallow_patterns),
    }
}

function normalizeCustomerExecutionConfig(value = {}) {
    return {
        strategy: VALID_STRATEGIES.has(value.strategy) ? value.strategy : "auto",
        tool_intents: toStringList(value.tool_intents),
        backend_intents: toStringList(value.backend_intents),
        backend_capabilities: normalizeCapabilities(value.backend_capabilities || {}),
        response_policy: normalizeResponsePolicy(value.response_policy || {}),
    }
}

function validateIntentList(intents, allowedIntents, field, errors) {
    if (!allowedIntents || !allowedIntents.size) return
    for (const intent of intents) {
        if (!allowedIntents.has(intent)) {
            errors.push(`${field} contains unknown intent "${intent}"`)
        }
    }
}

function validateCustomerExecutionConfig(value = {}, allowedIntentNames = []) {
    const errors = []
    const allowedIntents = new Set((allowedIntentNames || []).map(v => String(v || "").trim()).filter(Boolean))
    const normalized = normalizeCustomerExecutionConfig(value)

    if (value.strategy !== undefined && !VALID_STRATEGIES.has(value.strategy)) {
        errors.push(`strategy must be one of: ${Array.from(VALID_STRATEGIES).join(", ")}`)
    }

    validateIntentList(normalized.tool_intents, allowedIntents, "tool_intents", errors)
    validateIntentList(normalized.backend_intents, allowedIntents, "backend_intents", errors)

    const overlaps = normalized.tool_intents.filter(intent => normalized.backend_intents.includes(intent))
    if (overlaps.length) {
        errors.push(`tool_intents and backend_intents overlap: ${overlaps.join(", ")}`)
    }

    const responsePolicy = value.response_policy || {}
    if (responsePolicy.max_chars !== undefined) {
        const maxChars = Number(responsePolicy.max_chars)
        if (!Number.isFinite(maxChars) || maxChars < 80 || maxChars > 4000) {
            errors.push("response_policy.max_chars must be a number between 80 and 4000")
        }
    }

    const capabilities = value.backend_capabilities || {}
    for (const key of Object.keys(capabilities)) {
        if (!Object.prototype.hasOwnProperty.call(DEFAULT_BACKEND_CAPABILITIES, key)) {
            errors.push(`backend_capabilities contains unsupported key "${key}"`)
            continue
        }
        if (typeof capabilities[key] !== "boolean") {
            errors.push(`backend_capabilities.${key} must be boolean`)
        }
    }

    if (Array.isArray(responsePolicy.disallow_patterns)) {
        for (const pattern of responsePolicy.disallow_patterns) {
            if (!String(pattern || "").trim()) errors.push("response_policy.disallow_patterns cannot contain empty values")
        }
    } else if (responsePolicy.disallow_patterns !== undefined) {
        errors.push("response_policy.disallow_patterns must be an array")
    }

    return { ok: errors.length === 0, errors, normalized }
}

module.exports = {
    VALID_STRATEGIES,
    DEFAULT_BACKEND_CAPABILITIES,
    DEFAULT_RESPONSE_POLICY,
    normalizeCustomerExecutionConfig,
    validateCustomerExecutionConfig,
}
