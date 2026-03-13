"use strict"

const fs   = require("fs")
const yaml = require("js-yaml")
const path = require("path")

const { sanitize }      = require("../gateway/sanitizer")
const { parseIntent }   = require("../gateway/intentParser")
const { evaluate, isInDomain } = require("../gateway/policyEngine")
const { isAdmin, parseAdminMessage, handleAdmin } = require("../gateway/admin")
const { addTurn }       = require("./sessionMemory")
const executor          = require("./executor")
const logger            = require("../gateway/logger")

class AgentChain {
    constructor() {
        this._agents = []   // ordered list of loaded manifests
        this._ready  = false
    }

    /**
     * Load primary manifest and recursively load any chained agents.
     * @param {string} manifestPath
     */
    loadAgent(manifestPath) {
        this._agents = []
        this._loadManifest(path.resolve(manifestPath))
        this._ready = true
        logger.info({ chain: this._agents.map(a => a.agent.name) }, "chain: loaded")
    }

    _loadManifest(resolved) {
        if (!fs.existsSync(resolved)) throw new Error(`Manifest not found: ${resolved}`)
        const manifest = yaml.load(fs.readFileSync(resolved, "utf8"))
        if (!manifest.agent?.name) throw new Error(`Manifest missing agent.name: ${resolved}`)
        if (!manifest.intents)     throw new Error(`Manifest missing intents: ${resolved}`)
        if (!manifest.tools)       throw new Error(`Manifest missing tools: ${resolved}`)
        this._agents.push(manifest)

        // Recursively load chained agents
        const chain = manifest.agent.chain || []
        for (const chainPath of chain) {
            this._loadManifest(path.resolve(chainPath))
        }
    }

    /**
     * Run the full secure pipeline, escalating through the chain on null response.
     * @param {string} message
     * @param {string} phone
     * @returns {Promise<string|null>}
     */
    async execute(message, phone) {
        if (!this._ready) throw new Error("AgentChain: call loadAgent() first.")

        // 0. Admin intercept — runs once, before any agent
        if (isAdmin(phone)) {
            const admin = parseAdminMessage(message)
            if (admin.isAdmin) return await handleAdmin(admin.payload)
        }

        // 1. Sanitizer — runs once
        const sanity = sanitize(message)
        if (!sanity.safe) {
            logger.warn({ phone, reason: sanity.reason }, "chain: sanitizer blocked")
            return "Your message could not be processed."
        }

        // Run through each agent in the chain
        for (const manifest of this._agents) {
            const agentName = manifest.agent.name
            const skipDomainGate = manifest.agent.skip_domain_gate === true

            // 2. Domain gate — skipped for agents that declare skip_domain_gate: true
            if (!skipDomainGate) {
                const wordCount = message.trim().split(/\s+/).length
                if (wordCount > 3 && !isInDomain(message)) {
                    logger.info({ phone, agent: agentName }, "chain: out of domain, trying next agent")
                    continue  // pass to next agent in chain
                }
            }

            // 3. Intent parser — LLM as translator only
            let intent
            try {
                intent = await parseIntent(message)
            } catch (err) {
                logger.error({ phone, err }, "chain: intent parser error")
                continue
            }

            // Support agent uses a catch-all intent — route everything to it
            if (manifest.agent.domain === "support") {
                intent = { intent: "support", parameters: {} }
            }

            logger.info({ phone, agent: agentName, intent: intent.intent }, "chain: intent parsed")

            // 4. Policy engine
            const policy = evaluate(intent)
            if (!policy.allowed) {
                logger.info({ phone, agent: agentName, intent: intent.intent }, "chain: policy blocked, trying next")
                // Only return restricted message from primary agent, others pass through
                if (this._agents.indexOf(manifest) === 0 && policy.reason === "restricted_intent") {
                    return manifest.agent.restricted_message || "Sorry, I cannot perform that request."
                }
                continue
            }

            // 5. Execute tool
            try {
                const response = await executor.execute(manifest, intent, { phone, rawMessage: message })
                if (response !== null && response !== undefined) {
                    // Store in session memory for support context
                    addTurn(phone, message, response)
                    logger.info({ phone, agent: agentName }, "chain: responded")
                    return response
                }
                // null = this agent couldn't handle it, try next
                logger.info({ phone, agent: agentName }, "chain: no response, escalating to next agent")
            } catch (err) {
                logger.error({ phone, agent: agentName, err }, "chain: executor error")
                continue
            }
        }

        // All agents exhausted
        return this._agents[0]?.agent?.out_of_domain_message || "Sorry, I can only help with food orders and related queries."
    }

    getCapabilities() {
        if (!this._ready) return { ready: false }
        return this._agents.map(m => ({
            agent:   m.agent.name,
            domain:  m.agent.domain,
            intents: Object.keys(m.intents),
            tools:   Object.keys(m.tools),
        }))
    }

    healthCheck() {
        return {
            status:    this._ready ? "ok" : "no_agent",
            agents:    this._agents.map(a => a.agent.name),
            timestamp: new Date().toISOString(),
        }
    }
}

module.exports = new AgentChain()
