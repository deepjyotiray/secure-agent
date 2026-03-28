"use strict"

const { addTurn } = require("./sessionMemory")
const flowMemory = require("./flowMemory")
const conversationState = require("./conversationState")
const debugInterceptor = require("./debugInterceptor")
const { extractPackConversationState } = require("../core/domainPacks")
const { getActiveWorkspace } = require("../core/workspace")
const { persistCustomerProfile, buildCustomerStatePatch } = require("./customerState")

function recordCustomerOutcome({
    phone,
    message,
    response,
    manifest,
    domainPack,
    effectiveMessage,
    routedIntent,
    resolvedRequest,
    resolved,
    route,
    task,
    executionMeta,
}) {
    const workspaceId = getActiveWorkspace()
    const savedProfile = persistCustomerProfile({ workspaceId, phone, message })
    const currentConversationState = conversationState.getState("customer", phone)
    const packState = extractPackConversationState(domainPack, {
        flow: "customer",
        message,
        resolvedMessage: effectiveMessage,
        response,
        intent: routedIntent?.intent || currentConversationState.lastIntent || "general_chat",
        filters: routedIntent?.filter || currentConversationState.filters || {},
        conversationState: currentConversationState,
    }) || {}
    const statePatch = buildCustomerStatePatch({
        message,
        response,
        routedIntent,
        currentState: currentConversationState,
        customerProfile: savedProfile || currentConversationState.customerProfile,
    })

    addTurn(phone, message, response, manifest.agent?.name || "customer")
    flowMemory.addTurn("customer", phone, message, response, manifest.agent?.name || "customer")
    conversationState.recordInteraction("customer", phone, {
        message,
        response,
        intent: routedIntent?.intent,
        route,
        task,
        topic: resolvedRequest?.wasRewritten ? resolvedRequest.activeTopic : undefined,
        filters: resolvedRequest?.appliedFilters,
        slots: resolved?.resolved
            ? { resolvedMessage: effectiveMessage, resolutionReason: resolved.reason }
            : undefined,
        execution: executionMeta || undefined,
        selection: statePatch.selection !== undefined ? statePatch.selection : undefined,
        pending: statePatch.pending !== undefined ? statePatch.pending : undefined,
        customerProfile: statePatch.customerProfile !== undefined ? statePatch.customerProfile : undefined,
        ...packState,
    })
    debugInterceptor.logMessage(phone, message, response, route, "whatsapp", executionMeta || null)
}

module.exports = {
    recordCustomerOutcome,
}
