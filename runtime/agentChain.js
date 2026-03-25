"use strict"

const fs   = require("fs")
const yaml = require("js-yaml")
const path = require("path")

const { sanitize }                       = require("../gateway/sanitizer")
const { routeCustomerMessage }           = require("../gateway/customerRouter")
const { isAdmin, parseAdminMessage, handleAdmin } = require("../gateway/admin")
const { getGovernanceSnapshot }          = require("../gateway/adminGovernance")
const { dispatchAgentTask }               = require("../gateway/adminAgent")
const cartStore                          = require("../tools/cartStore")
const executor                           = require("./executor")
const logger                             = require("../gateway/logger")
const { addTurn, getHistory }            = require("./sessionMemory")
const flowMemory                         = require("./flowMemory")
const conversationState                  = require("./conversationState")
const { getActiveWorkspace }             = require("../core/workspace")
const { loadPack, getPackForWorkspace }  = require("../core/domainPacks")
const debugInterceptor                   = require("./debugInterceptor")
const { getFlowConfig, complete }        = require("../providers/llm")
const { prepareRequest }                 = require("./contextPipeline")
const { resolveFollowUp }                = require("./followUpResolver")
const { buildResolvedRequest }           = require("./resolvedRequest")
const { decideCustomerExecution }        = require("./flowOrchestrator")
const { loadProfile }                    = require("../setup/profileService")
const { loadNotes }                      = require("../core/dataModelNotes")
const { buildDbContext, getDbSchema, selectRelevantTables } = require("../gateway/admin")
const { extractPackConversationState }   = require("../core/domainPacks")

function buildProfileFacts(profile = {}) {
    const lines = []
    for (const [k, v] of Object.entries(profile)) {
        if (!v || typeof v !== "string") continue
        if (["openaiKey", "workspaceId", "agentManifest", "domainPack", "scrapeWebsite", "customFields"].includes(k)) continue
        lines.push(`- ${k}: ${v}`)
    }
    const custom = Array.isArray(profile.customFields) ? profile.customFields : []
    for (const field of custom) {
        if (!field?.key || !field?.value) continue
        lines.push(`- ${field.key}: ${field.value}`)
    }
    return lines.join("\n") || "No profile data available."
}

async function loadCustomerRagHints(message, dbPath) {
    try {
        if (!dbPath) return ""
        const rag = require("../tools/genericRagTool")
        const result = await rag.execute({}, { rawMessage: message, skipLlm: true }, { db_path: dbPath })
        if (!result || /nothing matched/i.test(result)) return ""
        return result.split("\n").slice(0, 12).join("\n")
    } catch {
        return ""
    }
}

async function answerCustomerViaConfiguredMode(resolvedRequest, phone, manifest) {
    const message = resolvedRequest.effectiveMessage || resolvedRequest.originalMessage || ""
    const workspaceId = getActiveWorkspace()
    const flowCfg = getFlowConfig("customer")
    const profile = loadProfile(workspaceId)
    const dbPath = profile.dbPath
    const relevantTables = await selectRelevantTables(message, workspaceId)
    const dbContext = await buildDbContext(workspaceId, relevantTables)
    const schema = dbPath ? getDbSchema(dbPath, relevantTables) : ""
    const notes = loadNotes(workspaceId)
    const ragHints = await loadCustomerRagHints(message, dbPath)
    const history = flowMemory.getHistory("customer", phone)
    const businessName = profile.businessName || manifest.agent?.name || "the business"
    const systemContext = `You are the customer-facing assistant for ${businessName}.
Answer using the provided business profile, database context, schema, notes, retrieval hints, and recent conversation history.
If the configured mode is a backend service, keep this request on that backend path.
Be concise, accurate, and helpful for a WhatsApp customer.`
    const dynamicContext = [
        "=== DATABASE CONTEXT ===",
        dbContext,
        "",
        "=== DATABASE SCHEMA ===",
        schema,
        notes ? `\n=== DATA MODEL NOTES ===\n${notes}` : "",
        ragHints ? `\n=== RETRIEVAL HINTS ===\n${ragHints}` : "",
    ].filter(Boolean).join("\n")
    const messages = prepareRequest(`Customer message:\n${message}`, "customer", {
        systemContext,
        profileFacts: buildProfileFacts(profile),
        dynamicContext,
        history,
        conversationState: conversationState.getState("customer", phone),
        resolvedRequest,
    })
    const response = await complete(messages, { flow: "customer", llmConfig: flowCfg, phone })
    return response || manifest.agent.error_message || "I'm sorry, I couldn't process that right now."
}

function isSupportMenuReply(message) {
    const text = String(message || "").trim()
    return text === "0" || /^[1-5]$/.test(text)
}

class AgentChain {
    constructor() {
        this._manifest = null
        this._ready    = false
    }

    async _executeAndStore(intent, context, originalMessage, phone) {
        context.conversationState = context.conversationState || conversationState.getState("customer", phone)
        const response = await executor.execute(this._manifest, intent, context)
        if (response) {
            const packState = extractPackConversationState(this._domainPack, {
                flow: "customer",
                message: originalMessage,
                resolvedMessage: context.rawMessage,
                response,
                intent: intent.intent,
                filters: intent.filter || {},
                conversationState: context.conversationState,
            }) || {}
            addTurn(phone, originalMessage, response, this._manifest.agent?.name || "customer")
            flowMemory.addTurn("customer", phone, originalMessage, response, this._manifest.agent?.name || "customer")
            conversationState.recordInteraction("customer", phone, {
                message: originalMessage,
                response,
                intent: intent.intent,
                filters: context.resolvedRequest?.appliedFilters || intent.filter || {},
                route: context.flow || "customer",
                task: intent.intent,
                topic: context.resolvedRequest?.wasRewritten ? context.resolvedRequest.activeTopic : undefined,
                slots: context.resolvedMeta?.resolved
                    ? { resolvedMessage: context.rawMessage, resolutionReason: context.resolvedMeta.reason }
                    : undefined,
                ...packState,
            })
        }
        return response
    }

    async execute(message, phone) {
        if (!this._ready) throw new Error("AgentChain: call loadAgent() first.")

        // 0. Admin intercept
        const admin = parseAdminMessage(message, phone)
        if (admin.isAdmin) {
            const response = await handleAdmin(admin.payload, { user: admin.user, flow: admin.flow, phone })
            debugInterceptor.logMessage(phone, message, response, "admin", "whatsapp", null)
            return response
        }
        if (admin.matchedFlow && admin.message) {
            debugInterceptor.logMessage(phone, message, admin.message, "admin_auth", "whatsapp", null)
            return admin.message
        }

        // 1. Sanitizer
        const sanity = sanitize(message)
        if (!sanity.safe) {
            logger.warn({ phone, reason: sanity.reason }, "chain: sanitizer blocked")
            return "Your message could not be processed."
        }

        const currentConversationState = conversationState.getState("customer", phone)
        const resolved = resolveFollowUp({
            flow: "customer",
            message,
            conversationState: currentConversationState,
            domainPack: this._domainPack,
        })
        const effectiveMessage = resolved.message || message
        const resolvedRequest = buildResolvedRequest({
            flow: "customer",
            originalMessage: message,
            effectiveMessage,
            conversationState: currentConversationState,
            resolution: resolved,
        })
        if (resolved.resolved) {
            logger.info({ phone, originalMessage: message, effectiveMessage, reason: resolved.reason, confidence: resolved.confidence }, "chain: follow-up resolved")
        }

        const customerFlowCfg = getFlowConfig("customer")

        // 2. Active session check — skip LLM entirely
        const activeSession = cartStore.get(phone)
        const activeSupport = cartStore.get(`support:${phone}`)

        if (activeSession && activeSession.state === "support_handoff") {
            // active session handed off to support — clear session, route to support
            cartStore.clear(phone)
            return await this._executeAndStore({ intent: "support", filter: {} }, { phone, rawMessage: effectiveMessage, resolvedMeta: resolved, resolvedRequest }, message, phone)
        }

        if (activeSession) {
            const cartIntent = this._sessionRouting.activeCartIntent || Object.keys(this._manifest.intents)[0] || "general_chat"
            return await this._executeAndStore({ intent: cartIntent, filter: {} }, { phone, rawMessage: effectiveMessage, resolvedMeta: resolved, resolvedRequest }, message, phone)
        }

        if (activeSupport) {
            if (activeSupport.state === "menu" && !isSupportMenuReply(message)) {
                try {
                    const reroute = await routeCustomerMessage(effectiveMessage, this._manifest, { resolvedRequest })
                    if (reroute.intent && reroute.intent !== "support") {
                        cartStore.clear(`support:${phone}`)
                    } else {
                        return await this._executeAndStore({ intent: "support", filter: {} }, { phone, rawMessage: effectiveMessage, resolvedMeta: resolved, resolvedRequest }, message, phone)
                    }
                } catch {
                    cartStore.clear(`support:${phone}`)
                }
            } else {
                return await this._executeAndStore({ intent: "support", filter: {} }, { phone, rawMessage: effectiveMessage, resolvedMeta: resolved, resolvedRequest }, message, phone)
            }
        }

        let routedIntent = null
        try {
            const { getCachedIntent } = require("./previewEngine")
            const cached = getCachedIntent(phone, message)
            if (cached) {
                routedIntent = { intent: cached.intent, filter: cached.filter || {} }
                logger.info({ phone, intent: routedIntent.intent, source: "cache" }, "chain: intent parsed (cached)")
            } else {
                routedIntent = await routeCustomerMessage(effectiveMessage, this._manifest, { resolvedRequest })
                logger.info({ phone, intent: routedIntent.intent }, "chain: intent parsed")
            }
        } catch {
            routedIntent = { intent: "general_chat", filter: {} }
        }

        const executionPlan = decideCustomerExecution({
            flowConfig: customerFlowCfg,
            routedIntent,
            manifest: this._manifest,
        })
        logger.info({ phone, mode: executionPlan.mode, reason: executionPlan.reason, intent: executionPlan.intent }, "chain: customer flow orchestrated")

        if (executionPlan.mode === "backend") {
            resolvedRequest.lastIntent = routedIntent.intent
            resolvedRequest.appliedFilters = routedIntent.filter || resolvedRequest.appliedFilters
            const response = await answerCustomerViaConfiguredMode(resolvedRequest, phone, this._manifest)
            const packState = extractPackConversationState(this._domainPack, {
                flow: "customer",
                message,
                resolvedMessage: effectiveMessage,
                response,
                intent: routedIntent.intent || currentConversationState.lastIntent || "general_chat",
                filters: routedIntent.filter || currentConversationState.filters || {},
                conversationState: currentConversationState,
            }) || {}
            addTurn(phone, message, response, this._manifest.agent?.name || "customer")
            flowMemory.addTurn("customer", phone, message, response, this._manifest.agent?.name || "customer")
            conversationState.recordInteraction("customer", phone, {
                message,
                response,
                intent: routedIntent.intent,
                route: "customer_backend",
                task: "customer_backend",
                topic: resolvedRequest.wasRewritten ? resolvedRequest.activeTopic : undefined,
                filters: resolvedRequest.appliedFilters,
                slots: resolved.resolved
                    ? { resolvedMessage: effectiveMessage, resolutionReason: resolved.reason }
                    : undefined,
                ...packState,
            })
            debugInterceptor.logMessage(phone, message, response, "customer_backend", "whatsapp", null)
            return response
        }

        // 3. Intent router — manifest-driven business classification
        let intent = routedIntent.intent
        let filter = routedIntent.filter || {}

        // 4. Guard — fallback to public concierge if route is unknown
        if (!this._manifest.intents[intent]) {
            intent = this._manifest.intents.general_chat ? "general_chat" : Object.keys(this._manifest.intents)[0]
        }

        // 5. Execute
        try {
            resolvedRequest.lastIntent = intent
            resolvedRequest.appliedFilters = filter || resolvedRequest.appliedFilters
            const response = await this._executeAndStore({ intent, filter }, { phone, rawMessage: effectiveMessage, resolvedMeta: resolved, resolvedRequest }, message, phone)
            if (response) {
                return response
            }

            // check domain gate as fallback for empty/out-of-domain responses
            const { isInDomain } = require("../gateway/policyEngine")
            if (!isInDomain(message, getActiveWorkspace())) {
                return this._manifest.agent.out_of_domain_message || "I can only help with business-related questions."
            }

            return this._manifest.agent.error_message || "I'm sorry, I couldn't process that. How else can I help?"
        } catch (err) {
            logger.error({ phone, intent, err }, "chain: executor error")
        }

        return this._manifest.agent.error_message || "Something went wrong. Please try again."
    }

    getCapabilities() {
        if (!this._ready) return { ready: false }
        const governance = getGovernanceSnapshot()
        return {
            agent:   this._manifest.agent.name,
            intents: Object.keys(this._manifest.intents),
            tools:   Object.keys(this._manifest.tools),
            governance: {
                role: governance.role,
                workerCount: Object.keys(governance.workers || {}).length,
                governedToolCount: Object.keys(governance.tools || {}).length,
            },
        }
    }

    healthCheck() {
        return {
            status:    this._ready ? "ok" : "no_agent",
            agent:     this._manifest?.agent?.name,
            timestamp: new Date().toISOString(),
        }
    }

    getManifestPath() {
        return this._manifestPath
    }

    loadAgent(manifestPath) {
        const resolved = path.resolve(manifestPath)
        if (!fs.existsSync(resolved)) throw new Error(`Manifest not found: ${resolved}`)
        this._manifestPath = resolved
        this._manifest = yaml.load(fs.readFileSync(resolved, "utf8"))
        if (!this._manifest.agent?.name) throw new Error("Manifest missing agent.name")
        if (!this._manifest.intents)     throw new Error("Manifest missing intents")
        if (!this._manifest.tools)       throw new Error("Manifest missing tools")

        // wire domain pack if workspace has one configured
        this._sessionRouting = {}
        this._domainPack = null
        try {
            this._domainPack = this._loadDomainPack()
        } catch (err) {
            logger.warn({ err: err.message }, "chain: domain pack load failed, continuing without")
        }

        this._ready = true
        logger.info({ agent: this._manifest.agent.name, domainPack: this._domainPack?.name || null }, "chain: loaded")
    }

    _loadDomainPack() {
        // try to resolve workspace profile → domainPack field
        let profile
        try {
            const { loadProfile } = require("../setup/profileService")
            const workspaceId = getActiveWorkspace()
            profile = loadProfile(workspaceId)
        } catch { return null }

        const pack = getPackForWorkspace(profile)
        if (!pack) return null

        // register domain pack tool types with executor
        for (const [name, handler] of Object.entries(pack.toolTypes || {})) {
            executor.registerToolType(name, handler)
        }

        // register domain pack risk map with preview engine
        if (pack.riskMap) {
            try {
                const { registerRiskMap } = require("./previewEngine")
                registerRiskMap(pack.riskMap)
            } catch {}
        }

        // attach domain pack config to manifest for customerRouter/intentParser
        if (pack.heuristics) {
            const merged = { ...pack.heuristics }
            if (pack.heuristicIntentMap) merged._intentMap = pack.heuristicIntentMap
            this._manifest._domainPackHeuristics = merged
        }
        if (pack.filterSchema)    this._manifest._domainPackFilterSchema   = pack.filterSchema
        if (pack.filterExamples)  this._manifest._domainPackFilterExamples = pack.filterExamples

        // session routing
        this._sessionRouting = pack.sessionRouting || {}

        logger.info({ pack: pack.name, toolTypes: Object.keys(pack.toolTypes || {}) }, "chain: domain pack wired")
        return pack
    }

    getIntents() {
        if (!this._ready) throw new Error("No agent loaded")
        const hints = this._manifest.intent_hints || {}
        return Object.entries(this._manifest.intents).map(([name, cfg]) => ({
            name,
            tool: cfg.tool,
            auth_required: cfg.auth_required ?? false,
            hint: hints[name] || null,
        }))
    }

    getIntent(name) {
        if (!this._ready) throw new Error("No agent loaded")
        const cfg = this._manifest.intents[name]
        if (!cfg) throw new Error(`Intent '${name}' not found`)
        return { name, tool: cfg.tool, auth_required: cfg.auth_required ?? false, hint: this._manifest.intent_hints?.[name] || null }
    }

    getTools() {
        if (!this._ready) throw new Error("No agent loaded")
        return Object.entries(this._manifest.tools).map(([name, cfg]) => this._resolveToolPaths({ name, ...cfg }))
    }

    getTool(name) {
        if (!this._ready) throw new Error("No agent loaded")
        const cfg = this._manifest.tools[name]
        if (!cfg) throw new Error(`Tool '${name}' not found`)
        return this._resolveToolPaths({ name, ...cfg })
    }

    _resolveToolPaths(tool) {
        const pathKeys = ["db_path", "vectordb_path", "faq_path"]
        for (const k of pathKeys) {
            if (tool[k]) try { tool[k] = fs.realpathSync(path.resolve(tool[k])) } catch {}
        }
        return tool
    }

    addIntent(name, config) {
        if (!this._ready) throw new Error("No agent loaded")
        this._manifest.intents[name] = config
        this._saveManifest()
        return Object.keys(this._manifest.intents)
    }

    addIntentHint(name, hint) {
        if (!this._ready) throw new Error("No agent loaded")
        if (!this._manifest.intent_hints) this._manifest.intent_hints = {}
        this._manifest.intent_hints[name] = hint
        this._saveManifest()
    }

    addTool(name, config) {
        if (!this._ready) throw new Error("No agent loaded")
        this._manifest.tools[name] = config
        this._saveManifest()
        return Object.keys(this._manifest.tools)
    }

    deleteIntent(name) {
        if (!this._ready) throw new Error("No agent loaded")
        if (!this._manifest.intents[name]) throw new Error(`Intent '${name}' not found`)
        delete this._manifest.intents[name]
        this._saveManifest()
        return Object.keys(this._manifest.intents)
    }

    deleteTool(name) {
        if (!this._ready) throw new Error("No agent loaded")
        if (!this._manifest.tools[name]) throw new Error(`Tool '${name}' not found`)
        delete this._manifest.tools[name]
        this._saveManifest()
        return Object.keys(this._manifest.tools)
    }

    reloadAgent() {
        if (!this._manifestPath) throw new Error("No agent loaded yet")
        // clear cached settings so require() re-reads from disk
        delete require.cache[require.resolve("../config/settings.json")]
        this.loadAgent(this._manifestPath)
        logger.info("chain: hot-reloaded manifest + settings")
    }

    _saveManifest() {
        fs.writeFileSync(this._manifestPath, yaml.dump(this._manifest, { lineWidth: -1 }), "utf8")
    }
}

module.exports = new AgentChain()
