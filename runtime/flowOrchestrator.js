"use strict"

const CUSTOMER_TOOL_INTENTS = new Set([
    "show_menu",
    "order_status",
    "place_order",
    "support",
    "policy_info",
])

function decideCustomerExecution({ flowConfig, routedIntent, manifest } = {}) {
    const intent = routedIntent?.intent || "general_chat"
    const backendEnabled = !!(flowConfig?.backend && flowConfig.backend !== "direct")

    if (!backendEnabled) {
        return { mode: "tool", reason: "customer_direct_mode", intent }
    }

    if (CUSTOMER_TOOL_INTENTS.has(intent)) {
        return { mode: "tool", reason: "customer_structured_intent", intent }
    }

    if (!manifest?.intents?.[intent]) {
        return { mode: "backend", reason: "customer_unknown_intent", intent }
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
}
