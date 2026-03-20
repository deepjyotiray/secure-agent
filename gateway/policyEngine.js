"use strict"

const fs   = require("fs")
const path = require("path")
const yaml = require("js-yaml")

const GLOBAL_POLICY_PATH = path.resolve(__dirname, "..", "policy", "policy.yml")

// cache: workspaceId|"__global__" → { policy, keywords, loadedAt }
const _cache = new Map()
const CACHE_TTL = 60_000 // 60s safety net

function _loadPolicyFile(filePath) {
    if (!fs.existsSync(filePath)) return null
    return yaml.load(fs.readFileSync(filePath, "utf8"))
}

function _resolvePolicy(workspaceId) {
    const key = workspaceId || "__global__"
    const cached = _cache.get(key)
    if (cached && (Date.now() - cached.loadedAt) < CACHE_TTL) return cached

    let policy = null

    // try workspace-specific policy first
    if (workspaceId) {
        const wsPath = path.resolve(__dirname, "..", "data", "workspaces", workspaceId, "policy.yml")
        policy = _loadPolicyFile(wsPath)
    }

    // fall back to global
    if (!policy) {
        policy = _loadPolicyFile(GLOBAL_POLICY_PATH)
    }

    if (!policy) {
        // absolute fallback — allow everything, no domain keywords
        policy = { allowed_intents: [], restricted_intents: [], domain_keywords: [] }
    }

    const entry = {
        policy,
        keywords: new Set((policy.domain_keywords || []).map(k => k.toLowerCase())),
        loadedAt: Date.now(),
    }
    _cache.set(key, entry)
    return entry
}

function evaluate(intent, workspaceId) {
    if (!intent || typeof intent.intent !== "string") {
        return { allowed: false, reason: "malformed_intent" }
    }

    if (intent.intent === "unknown") {
        return { allowed: false, reason: "unknown_intent" }
    }

    const { policy } = _resolvePolicy(workspaceId)

    if ((policy.restricted_intents || []).includes(intent.intent)) {
        return { allowed: false, reason: "restricted_intent" }
    }

    // empty allowlist means allow all (for new domains without policy yet)
    const allowlist = policy.allowed_intents || []
    if (allowlist.length && !allowlist.includes(intent.intent)) {
        return { allowed: false, reason: "not_in_allowlist" }
    }

    return { allowed: true }
}

function isInDomain(message, workspaceId) {
    const { keywords } = _resolvePolicy(workspaceId)
    // empty keywords = no domain gate (allow everything through)
    if (!keywords.size) return true
    const lower = message.toLowerCase()
    for (const keyword of keywords) {
        if (lower.includes(keyword)) return true
    }
    return false
}

function clearCache() {
    _cache.clear()
}

module.exports = { evaluate, isInDomain, clearCache }
