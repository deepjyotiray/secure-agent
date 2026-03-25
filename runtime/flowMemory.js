"use strict"

const SESSION_TTL_MS = 30 * 60 * 1000
const MAX_TURNS = 10

const sessions = new Map()

function makeKey(flow, conversationId) {
    const safeFlow = String(flow || "").trim() || "unknown"
    const safeConversationId = String(conversationId || "").trim()
    if (!safeConversationId) return null
    return `${safeFlow}::${safeConversationId}`
}

function ensureSession(flow, conversationId) {
    const key = makeKey(flow, conversationId)
    if (!key) return null
    const existing = sessions.get(key)
    if (existing && Date.now() <= existing.expiresAt) return existing
    const next = { flow, conversationId, history: [], expiresAt: Date.now() + SESSION_TTL_MS, lastActor: null }
    sessions.set(key, next)
    return next
}

setInterval(() => {
    const now = Date.now()
    for (const [key, session] of sessions.entries()) {
        if (now > session.expiresAt) sessions.delete(key)
    }
}, 60_000).unref()

function getHistory(flow, conversationId) {
    const key = makeKey(flow, conversationId)
    if (!key) return []
    const session = sessions.get(key)
    if (!session || Date.now() > session.expiresAt) {
        sessions.delete(key)
        return []
    }
    return session.history
}

function addTurn(flow, conversationId, userText, agentText, actorName) {
    const session = ensureSession(flow, conversationId)
    if (!session) return
    if (actorName) session.lastActor = actorName
    session.history.push({ role: "customer", text: userText })
    if (agentText) session.history.push({ role: "agent", text: agentText })
    const maxEntries = MAX_TURNS * 2
    if (session.history.length > maxEntries) {
        session.history = session.history.slice(-maxEntries)
    }
    session.expiresAt = Date.now() + SESSION_TTL_MS
}

function clearSession(flow, conversationId) {
    const key = makeKey(flow, conversationId)
    if (key) sessions.delete(key)
}

module.exports = {
    getHistory,
    addTurn,
    clearSession,
}
