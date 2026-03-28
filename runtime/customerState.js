"use strict"

const { extractCustomerProfilePatch, getCustomerProfile, saveCustomerProfile } = require("./customerMemory")

function normalizeText(value = "") {
    return String(value || "").trim().replace(/\s+/g, " ")
}

function lower(value = "") {
    return normalizeText(value).toLowerCase()
}

function compactProfile(profile = {}) {
    return Object.fromEntries(
        Object.entries(profile || {}).filter(([, value]) => {
            if (value === undefined || value === null) return false
            if (Array.isArray(value)) return value.length > 0
            return String(value).trim() !== ""
        })
    )
}

function buildActiveCustomerState({ workspaceId, phone, conversationState, message, hydratedProfile = null } = {}) {
    const storedProfile = getCustomerProfile(workspaceId, phone)
    const currentProfile = conversationState?.customerProfile && typeof conversationState.customerProfile === "object"
        ? conversationState.customerProfile
        : {}
    const inlinePatch = extractCustomerProfilePatch(message)
    const baseProfile = hydratedProfile && typeof hydratedProfile === "object"
        ? hydratedProfile
        : {}
    const customerProfile = inlinePatch
        ? { ...compactProfile(baseProfile), ...compactProfile(storedProfile), ...compactProfile(currentProfile), ...inlinePatch }
        : { ...compactProfile(baseProfile), ...compactProfile(storedProfile), ...compactProfile(currentProfile) }
    return {
        ...(conversationState || {}),
        customerProfile,
    }
}

function persistCustomerProfile({ workspaceId, phone, message } = {}) {
    const patch = extractCustomerProfilePatch(message)
    if (!patch) return null
    return saveCustomerProfile(workspaceId, phone, patch)
}

function parseMenuSelection(response = "") {
    const text = String(response || "")
    if (!text.trim()) return null

    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    if (!lines.length) return null

    let label = null
    const items = []

    for (const line of lines) {
        if (!label) {
            const heading = line
                .replace(/^\*+|\*+$/g, "")
                .replace(/:$/, "")
                .trim()
            if (heading && !heading.startsWith("-") && !heading.startsWith("•")) {
                label = heading
            }
        }

        const bulletMatch = line.match(/^(?:[-•]\s+)(.+?)(?:\s+[—-]\s+₹\s?(\d+(?:\.\d+)?))?(?:\s+\[.*\])?$/i)
        if (!bulletMatch) continue
        const itemName = normalizeText(bulletMatch[1]).replace(/\s+\([^)]*\)$/, "")
        if (!itemName) continue
        items.push({
            name: itemName,
            price: bulletMatch[2] ? Number(bulletMatch[2]) : null,
        })
    }

    if (!label || items.length < 2) return null
    return {
        kind: "catalog_list",
        label,
        items,
        itemCount: items.length,
        capturedAt: new Date().toISOString(),
    }
}

function matchesSelectionLabel(text, selection) {
    if (!selection?.label) return false
    const cleaned = lower(text).replace(/^all\s+/, "")
    const label = lower(selection.label)
    return cleaned === label || cleaned.endsWith(label)
}

function resolveSelectionOrderIntent(message, conversationState = {}) {
    const text = normalizeText(message)
    const cleaned = lower(text)
    const selection = conversationState.selection
    const pending = conversationState.pending

    if (!selection?.items?.length) return null

    const directAddPattern = /\b(add|order|put)\b.*\b(all|these|them|those|items)\b.*\b(cart|order)\b/i
    const addAllPattern = /^(?:all|all of them|all these|all those)$/i
    const labelledAllPattern = /^all\s+.+$/i

    if (directAddPattern.test(text)) {
        return {
            intentOverride: "place_order",
            message: text,
            reason: "selection_to_order",
            confidence: 0.98,
            selectionAction: "add_all",
            bypassPreRoutePolicy: true,
        }
    }

    if (pending?.kind === "selection_order" && (addAllPattern.test(text) || matchesSelectionLabel(text, selection) || labelledAllPattern.test(text))) {
        return {
            intentOverride: "place_order",
            message: text,
            reason: "selection_confirmation_to_order",
            confidence: 0.96,
            selectionAction: "add_all",
            bypassPreRoutePolicy: true,
        }
    }

    return null
}

function resolvePendingClarification(message, conversationState = {}) {
    const pending = conversationState.pending
    if (pending?.kind !== "clarification" || !pending.allowFollowUp) return null

    const text = normalizeText(message)
    if (!text) return null

    const wordCount = text.split(/\s+/).filter(Boolean).length
    if (wordCount > 8) return null

    return {
        message: pending.prompt
            ? `${normalizeText(pending.prompt)}\nCustomer follow-up: ${text}`
            : text,
        reason: "pending_clarification",
        confidence: 0.9,
        bypassPreRoutePolicy: true,
    }
}

function extractClarificationPending(response = "", intent = "") {
    const text = String(response || "").trim()
    if (!text) return null
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    const promptLine = lines.find(line => /\?$/.test(line) || /^tell me\b/i.test(line) || /^share\b/i.test(line))
    if (!promptLine) return null
    return {
        kind: "clarification",
        intent: intent || "general_chat",
        prompt: promptLine,
        allowFollowUp: true,
        createdAt: new Date().toISOString(),
    }
}

function buildCustomerStatePatch({
    message,
    response,
    routedIntent,
    currentState,
    customerProfile,
}) {
    const intent = routedIntent?.intent || currentState?.lastIntent || null
    const next = {}

    if (customerProfile) {
        next.customerProfile = customerProfile
    }

    if (intent === "show_menu") {
        const selection = parseMenuSelection(response)
        if (selection) {
            next.selection = selection
            next.pending = {
                kind: "selection_order",
                intent: "place_order",
                label: selection.label,
                allowFollowUp: true,
                createdAt: new Date().toISOString(),
            }
        }
        return next
    }

    if (intent === "general_chat" || intent === "greet") {
        const pending = extractClarificationPending(response, "general_chat")
        if (pending) {
            next.pending = pending
            return next
        }
        return next
    }

    if (intent === "place_order") {
        next.pending = null
        return next
    }

    if (!routedIntent?.intent || routedIntent.intent === "general_chat") {
        return next
    }

    next.pending = null
    return next
}

module.exports = {
    buildActiveCustomerState,
    persistCustomerProfile,
    parseMenuSelection,
    resolveSelectionOrderIntent,
    resolvePendingClarification,
    buildCustomerStatePatch,
}
