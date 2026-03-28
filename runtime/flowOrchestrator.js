"use strict"

const { normalizeCustomerExecutionConfig } = require("./customerExecutionConfig")

const CUSTOMER_TOOL_INTENTS = new Set([
    "greet",
    "show_menu",
    "order_status",
    "place_order",
    "support",
    "policy_info",
])

function getCustomerExecutionConfig(flowConfig = {}) {
    const execution = normalizeCustomerExecutionConfig(flowConfig.execution || {})
    return {
        strategy: execution.strategy || "auto",
        toolIntents: new Set(execution.tool_intents || []),
        backendIntents: new Set(execution.backend_intents || []),
        backendCapabilities: execution.backend_capabilities,
        responsePolicy: execution.response_policy,
    }
}

function fallbackFromBackend(intent, hasManifestIntent, execution, fallbackReason) {
    if (!hasManifestIntent) return { mode: "backend", reason: fallbackReason, intent }
    return { mode: "tool", reason: fallbackReason, intent }
}

function decideCustomerExecution({ flowConfig, routedIntent, manifest } = {}) {
    const intent = routedIntent?.intent || "general_chat"
    const backendEnabled = !!(flowConfig?.backend && flowConfig.backend !== "direct")
    const execution = getCustomerExecutionConfig(flowConfig)
    const hasManifestIntent = !!manifest?.intents?.[intent]
    const isStructuredIntent = CUSTOMER_TOOL_INTENTS.has(intent)

    if (!backendEnabled) {
        return { mode: "tool", reason: "customer_direct_mode", intent }
    }

    if (execution.toolIntents.has(intent)) {
        return { mode: "tool", reason: "customer_strategy_tool_intent", intent }
    }

    if (execution.backendIntents.has(intent)) {
        return { mode: "backend", reason: "customer_strategy_backend_intent", intent }
    }

    if (execution.strategy === "tool_first") {
        if (hasManifestIntent) {
            return { mode: "tool", reason: "customer_tool_first_manifest_intent", intent }
        }
        return { mode: "backend", reason: "customer_tool_first_unknown_intent", intent }
    }

    if (execution.strategy === "backend_first") {
        if (!hasManifestIntent) {
            if (!execution.backendCapabilities.conversational) {
                return fallbackFromBackend(intent, hasManifestIntent, execution, "customer_backend_capability_missing_conversational")
            }
            return { mode: "backend", reason: "customer_backend_first_unknown_intent", intent }
        }
        if (isStructuredIntent && !execution.backendCapabilities.structured) {
            return fallbackFromBackend(intent, hasManifestIntent, execution, "customer_backend_capability_missing_structured")
        }
        if (!isStructuredIntent && !execution.backendCapabilities.conversational) {
            return fallbackFromBackend(intent, hasManifestIntent, execution, "customer_backend_capability_missing_conversational")
        }
        return { mode: "backend", reason: "customer_backend_first_default", intent }
    }

    if (CUSTOMER_TOOL_INTENTS.has(intent)) {
        return { mode: "tool", reason: "customer_structured_intent", intent }
    }

    if (!hasManifestIntent) {
        if (!execution.backendCapabilities.conversational) {
            return fallbackFromBackend(intent, hasManifestIntent, execution, "customer_backend_capability_missing_conversational")
        }
        return { mode: "backend", reason: "customer_unknown_intent", intent }
    }

    if (!execution.backendCapabilities.conversational) {
        return fallbackFromBackend(intent, hasManifestIntent, execution, "customer_backend_capability_missing_conversational")
    }
    return { mode: "backend", reason: "customer_conversational_intent", intent }
}

function decideAdminExecution({ flow, flowConfig, payload } = {}) {
    if (flow !== "admin") return { mode: "existing", reason: "non_admin_flow" }
    const backendEnabled = !!(flowConfig?.backend && flowConfig.backend !== "direct")
    if (!backendEnabled) return { mode: "direct", reason: "admin_direct_mode" }

    const text = String(payload || "").trim().toLowerCase()
    if (/^(approvals|approve\s+|agent\s+)/.test(text)) {
        return { mode: "direct", reason: "admin_explicit_control_command" }
    }
    return { mode: "backend", reason: "admin_backend_nl" }
}

module.exports = {
    decideCustomerExecution,
    decideAdminExecution,
    getCustomerExecutionConfig,
}
