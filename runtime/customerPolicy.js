"use strict"

const { evaluate, isInDomain } = require("../gateway/policyEngine")

const CORE_RISK_MAP = {
    sqlite: "medium",
    sqlite_query: "medium",
    rag: "low",
    rag_generic: "low",
    support: "low",
    support_generic: "low",
    business_chat: "low",
}

function customerRiskOf(toolType, domainPack) {
    if (domainPack?.riskMap?.[toolType]) return domainPack.riskMap[toolType]
    return CORE_RISK_MAP[toolType] || "medium"
}

function blockedResponseForPolicy(reason, manifest) {
    if (reason === "restricted_intent") {
        return manifest.agent?.restricted_message || "Sorry, I cannot perform that request."
    }
    if (reason === "unknown_intent" || reason === "not_in_allowlist") {
        return manifest.agent?.out_of_domain_message || "Sorry, I can only help within my domain."
    }
    return manifest.agent?.error_message || "Something went wrong. Please try again."
}

function evaluateCustomerPreRoutePolicy({ message, manifest, workspaceId, stateContext }) {
    if (stateContext?.bypassPreRoutePolicy) {
        return { allowed: true, reason: "stateful_follow_up" }
    }

    if (manifest?.agent?.skip_domain_gate) {
        return { allowed: true, reason: "domain_gate_skipped" }
    }

    const wordCount = String(message || "").trim().split(/\s+/).filter(Boolean).length
    if (wordCount > 3 && !isInDomain(String(message || ""), workspaceId)) {
        return {
            allowed: false,
            reason: "out_of_domain",
            response: manifest.agent?.out_of_domain_message || "Sorry, I can only help within my domain.",
        }
    }

    return { allowed: true, reason: "in_domain" }
}

function evaluateCustomerResolvedPolicy({ manifest, routedIntent, workspaceId, domainPack }) {
    const intent = routedIntent?.intent || "general_chat"
    const filter = routedIntent?.filter || {}
    const policyResult = evaluate({ intent, filter }, workspaceId)
    if (!policyResult.allowed) {
        return {
            allowed: false,
            reason: policyResult.reason,
            response: blockedResponseForPolicy(policyResult.reason, manifest),
        }
    }

    const intentConfig = manifest?.intents?.[intent]
    if (!intentConfig) {
        return {
            allowed: true,
            reason: "intent_not_in_manifest",
            governance: {
                intent,
                toolName: null,
                toolType: null,
                risk: "low",
            },
        }
    }

    if (intentConfig.auth_required) {
        return {
            allowed: false,
            reason: "auth_required",
            response: manifest.agent?.restricted_message || "Sorry, I cannot perform that request.",
        }
    }

    const toolName = intentConfig.tool
    const toolConfig = manifest?.tools?.[toolName]
    if (!toolConfig) {
        return {
            allowed: false,
            reason: "missing_tool",
            response: manifest.agent?.error_message || "Something went wrong. Please try again.",
        }
    }

    const risk = customerRiskOf(toolConfig.type, domainPack)
    if (risk === "critical") {
        return {
            allowed: false,
            reason: "critical_risk_tool",
            response: manifest.agent?.restricted_message || "Sorry, I cannot perform that request.",
        }
    }

    return {
        allowed: true,
        reason: "allowed",
        governance: {
            intent,
            toolName,
            toolType: toolConfig.type || null,
            risk,
        },
    }
}

module.exports = {
    customerRiskOf,
    evaluateCustomerPreRoutePolicy,
    evaluateCustomerResolvedPolicy,
}
