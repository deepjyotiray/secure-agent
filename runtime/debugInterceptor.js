"use strict"

const { buildPreview } = require("./previewEngine")
const logger = require("../gateway/logger")

let _enabled = false
const _held = new Map()  // requestId → { preview, phone, rawJid, text, sock, createdAt }
const HELD_TTL = 10 * 60 * 1000

setInterval(() => {
    const now = Date.now()
    for (const [id, entry] of _held) {
        if (now - entry.createdAt > HELD_TTL) {
            logger.warn({ requestId: id }, "debug: held message expired, auto-executing")
            _autoExecute(id)
        }
    }
}, 30_000).unref()

async function _autoExecute(requestId) {
    const entry = _held.get(requestId)
    if (!entry) return
    _held.delete(requestId)
    try {
        const agentChain = require("./agentChain")
        const response = await agentChain.execute(entry.text, entry.phone)
        if (response && entry.sock) await entry.sock.sendMessage(entry.rawJid, { text: response })
    } catch (err) {
        logger.error({ requestId, err }, "debug: auto-execute failed")
    }
}

function isEnabled() { return _enabled }

function setEnabled(val) {
    _enabled = !!val
    logger.info({ enabled: _enabled }, "debug interceptor toggled")
    if (!_enabled) {
        for (const id of [..._held.keys()]) _autoExecute(id)
    }
    return _enabled
}

async function intercept(text, phone, rawJid, sock, workspaceId) {
    if (!_enabled) return null
    const preview = await buildPreview(text, phone, workspaceId)
    _held.set(preview.requestId, { preview, phone, rawJid, text, sock, createdAt: Date.now() })
    logger.info({ requestId: preview.requestId, phone }, "debug: WhatsApp message held")
    return preview
}

async function approve(requestId) {
    const entry = _held.get(requestId)
    if (!entry) return { error: "not_found" }
    _held.delete(requestId)
    const agentChain = require("./agentChain")
    try {
        const response = await agentChain.execute(entry.text, entry.phone)
        if (response && entry.sock) await entry.sock.sendMessage(entry.rawJid, { text: response })
        return { requestId, status: "executed", response, phone: entry.phone }
    } catch (err) {
        logger.error({ requestId, err }, "debug: approve-execute failed")
        return { requestId, status: "execution_failed", error: err.message }
    }
}

function reject(requestId, replyText) {
    const entry = _held.get(requestId)
    if (!entry) return null
    _held.delete(requestId)
    if (replyText && entry.sock) {
        entry.sock.sendMessage(entry.rawJid, { text: replyText }).catch(() => {})
    }
    return { requestId, status: "rejected", phone: entry.phone }
}

function listHeld() {
    return [..._held.values()].map(e => ({
        requestId: e.preview.requestId,
        phone: e.phone,
        message: e.text,
        preview: e.preview,
        createdAt: e.createdAt,
        age: Math.round((Date.now() - e.createdAt) / 1000),
    }))
}

module.exports = { isEnabled, setEnabled, intercept, approve, reject, listHeld }
