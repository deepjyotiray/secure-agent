"use strict"

const { normalizeCustomerExecutionConfig } = require("./customerExecutionConfig")

const PRESETS = {
    openclaw: {
        id: "openclaw",
        name: "OpenClaw Default",
        description: "Balanced customer routing with conversational backend support and strict response guarding.",
        execution: {
            strategy: "auto",
            tool_intents: ["support", "place_order", "order_status", "policy_info", "show_menu"],
            backend_intents: ["general_chat", "greet"],
            backend_capabilities: {
                conversational: true,
                structured: false,
                memory: true,
                handoffs: false,
                structured_output: false,
            },
            response_policy: {
                max_chars: 1200,
                strip_markdown: false,
                disallow_patterns: ["system prompt", "internal policy"],
            },
        },
    },
    myclaw: {
        id: "myclaw",
        name: "MyClaw Structured",
        description: "Tool-heavy mode with backend support for richer structured and memory-backed follow-ups.",
        execution: {
            strategy: "hybrid",
            tool_intents: ["support", "place_order", "order_status"],
            backend_intents: ["general_chat"],
            backend_capabilities: {
                conversational: true,
                structured: true,
                memory: true,
                handoffs: true,
                structured_output: true,
            },
            response_policy: {
                max_chars: 1000,
                strip_markdown: true,
                disallow_patterns: ["system prompt", "hidden instructions"],
            },
        },
    },
    nemoclaw: {
        id: "nemoclaw",
        name: "NemoClaw Concierge",
        description: "Backend-led conversational assistant with graceful fallback to tools for strict business actions.",
        execution: {
            strategy: "backend_first",
            tool_intents: ["place_order", "order_status", "support"],
            backend_intents: ["general_chat", "greet"],
            backend_capabilities: {
                conversational: true,
                structured: true,
                memory: false,
                handoffs: false,
                structured_output: false,
            },
            response_policy: {
                max_chars: 900,
                strip_markdown: true,
                disallow_patterns: ["system prompt", "internal policy"],
            },
        },
    },
}

function listCustomerBackendPresets() {
    return Object.values(PRESETS).map(preset => ({
        ...preset,
        execution: normalizeCustomerExecutionConfig(preset.execution),
    }))
}

function getCustomerBackendPreset(id) {
    const preset = PRESETS[id]
    if (!preset) return null
    return {
        ...preset,
        execution: normalizeCustomerExecutionConfig(preset.execution),
    }
}

module.exports = {
    listCustomerBackendPresets,
    getCustomerBackendPreset,
}
