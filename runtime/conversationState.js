"use strict"

const STATE_TTL_MS = 30 * 60 * 1000

const states = new Map()

function makeKey(flow, conversationId) {
    const safeFlow = String(flow || "").trim()
    const safeConversationId = String(conversationId || "").trim()
    if (!safeFlow || !safeConversationId) return null
    return `${safeFlow}::${safeConversationId}`
}

function createDefaultState(flow, conversationId) {
    return {
        flow,
        conversationId,
        task: null,
        route: null,
        topic: null,
        selection: null,
        pending: null,
        customerProfile: null,
        filters: {},
        slots: {},
        execution: null,
        lastIntent: null,
        lastMessage: null,
        lastResponse: null,
        turnCount: 0,
        updatedAt: new Date().toISOString(),
        expiresAt: Date.now() + STATE_TTL_MS,
    }
}

function cleanupExpired() {
    const now = Date.now()
    for (const [key, value] of states.entries()) {
        if (now > value.expiresAt) states.delete(key)
    }
}

setInterval(cleanupExpired, 60_000).unref()

function cloneState(state) {
    return JSON.parse(JSON.stringify(state))
}

function getState(flow, conversationId) {
    const key = makeKey(flow, conversationId)
    if (!key) return createDefaultState(flow, conversationId)
    const existing = states.get(key)
    if (!existing || Date.now() > existing.expiresAt) {
        states.delete(key)
        return createDefaultState(flow, conversationId)
    }
    return cloneState(existing)
}

function saveState(flow, conversationId, nextState) {
    const key = makeKey(flow, conversationId)
    if (!key) return createDefaultState(flow, conversationId)
    const merged = {
        ...createDefaultState(flow, conversationId),
        ...nextState,
        flow,
        conversationId,
        updatedAt: new Date().toISOString(),
        expiresAt: Date.now() + STATE_TTL_MS,
    }
    states.set(key, merged)
    return cloneState(merged)
}

function inferTopic(flow, message, filters = {}, previous = null) {
    if (typeof filters.query === "string" && filters.query.trim()) {
        return { label: filters.query.trim(), source: "filter", confidence: 0.7 }
    }
    if (flow === "customer") return previous || null
    if (typeof message === "string") {
        const cleaned = message.trim().replace(/\s+/g, " ")
        if (cleaned && cleaned.split(/\s+/).length >= 2) {
            return { label: cleaned.slice(0, 120), source: "message", confidence: 0.45 }
        }
    }
    return previous || null
}

function recordInteraction(flow, conversationId, details = {}) {
    const current = getState(flow, conversationId)
    const next = {
        ...current,
        task: details.task || current.task || null,
        route: details.route || current.route || null,
        topic: details.topic || inferTopic(flow, details.message, details.filters || {}, current.topic),
        selection: details.selection || current.selection || null,
        pending: details.pending !== undefined ? details.pending : current.pending || null,
        customerProfile: details.customerProfile !== undefined ? details.customerProfile : current.customerProfile || null,
        filters: details.filters ? { ...details.filters } : current.filters || {},
        slots: details.slots ? { ...current.slots, ...details.slots } : current.slots || {},
        execution: details.execution ? { ...(current.execution || {}), ...details.execution } : current.execution || null,
        lastIntent: details.intent || current.lastIntent || null,
        lastMessage: details.message || current.lastMessage || null,
        lastResponse: details.response || current.lastResponse || null,
        turnCount: (current.turnCount || 0) + 1,
    }
    return saveState(flow, conversationId, next)
}

function clearState(flow, conversationId) {
    const key = makeKey(flow, conversationId)
    if (key) states.delete(key)
}

module.exports = {
    getState,
    saveState,
    recordInteraction,
    clearState,
}
