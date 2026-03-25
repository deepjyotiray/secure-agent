"use strict"

const fs   = require("fs")
const yaml = require("js-yaml")
const path = require("path")

const { sanitize }         = require("../gateway/sanitizer")
const { parseIntent }      = require("../gateway/intentParser")
const { evaluate }         = require("../gateway/policyEngine")
const { isAdmin, parseAdminMessage, handleAdmin } = require("../gateway/admin")
const executor             = require("./executor")
const logger               = require("../gateway/logger")

class Runtime {
    constructor() {
        this.manifest = null
        this._ready   = false
    }

    /**
     * Load and validate an agent manifest from a YAML file.
     * @param {string} manifestPath
     */
    loadAgent(manifestPath) {
        const resolved = path.resolve(manifestPath)
        if (!fs.existsSync(resolved)) throw new Error(`Manifest not found: ${resolved}`)

        this.manifest = yaml.load(fs.readFileSync(resolved, "utf8"))

        if (!this.manifest.agent?.name)   throw new Error("Manifest missing agent.name")
        if (!this.manifest.intents)       throw new Error("Manifest missing intents")
        if (!this.manifest.tools)         throw new Error("Manifest missing tools")

        this._ready = true
        logger.info({ agent: this.manifest.agent.name }, "runtime: agent loaded")
    }

    /**
     * Full secure pipeline — every message passes through all gates.
     * @param {string} message
     * @param {string} phone
     * @returns {Promise<string|null>}
     */
    async execute(message, phone) {
        if (!this._ready) throw new Error("Runtime: no agent loaded. Call loadAgent() first.")

        const manifest = this.manifest

        // 0. Admin intercept — bypasses all gates, only for registered admin number
        if (isAdmin(phone)) {
            const admin = parseAdminMessage(message, phone)
            if (admin.isAdmin) return await handleAdmin(admin.payload, { user: admin.user, flow: admin.flow, phone })
        }

        // 1. Sanitizer
        const sanity = sanitize(message)
        if (!sanity.safe) {
            logger.warn({ phone, reason: sanity.reason }, "runtime: sanitizer blocked")
            return "Your message could not be processed."
        }

        // 2. Domain gate — messages over 3 words must match a domain keyword
        const wordCount = message.trim().split(/\s+/).length
        if (wordCount > 3 && !this._isInDomain(message)) {
            logger.info({ phone, message }, "runtime: out of domain")
            return manifest.agent.out_of_domain_message || "Sorry, I can only help within my domain."
        }

        // 4. Intent parser — LLM as translator only, sandboxed
        let intent
        try {
            intent = await parseIntent(message)
        } catch (err) {
            logger.error({ phone, err }, "runtime: intent parser error")
            return manifest.agent.error_message || "Something went wrong. Please try again."
        }

        logger.info({ phone, intent }, "runtime: intent parsed")

        // 5. Policy engine — allowlist/blocklist check
        const policy = evaluate(intent)
        if (!policy.allowed) {
            logger.warn({ phone, intent: intent.intent, reason: policy.reason }, "runtime: policy blocked")
            return policy.reason === "restricted_intent"
                ? manifest.agent.restricted_message || "Sorry, I cannot perform that request."
                : manifest.agent.out_of_domain_message || "Sorry, I can only help within my domain."
        }

        // 6. Manifest resolver + tool executor — deterministic, no LLM
        try {
            return await executor.execute(manifest, intent, { phone, rawMessage: message })
        } catch (err) {
            logger.error({ phone, intent: intent.intent, err }, "runtime: executor error")
            return manifest.agent.error_message || "Something went wrong. Please try again."
        }
    }

    /**
     * Returns the agent's declared capabilities for discovery.
     * @returns {object}
     */
    getCapabilities() {
        if (!this._ready) return { ready: false }
        const { agent, intents, tools } = this.manifest
        return {
            agent:   agent.name,
            version: agent.version,
            domain:  agent.domain,
            intents: Object.keys(intents),
            tools:   Object.keys(tools),
        }
    }

    /**
     * Basic health check — confirms runtime is loaded and pipeline modules are reachable.
     * @returns {object}
     */
    healthCheck() {
        return {
            status:    this._ready ? "ok" : "no_agent",
            agent:     this.manifest?.agent?.name || null,
            timestamp: new Date().toISOString(),
        }
    }

    // ── Internal ────────────────────────────────────────────────────────────

    _isInDomain(message) {
        // Domain keywords come from policyEngine which reads policy.yml
        // Re-use the same isInDomain function
        const { isInDomain } = require("../gateway/policyEngine")
        return isInDomain(message)
    }
}

module.exports = new Runtime()
