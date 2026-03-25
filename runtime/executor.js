"use strict"

const logger = require("../gateway/logger")
const { getActiveWorkspace } = require("../core/workspace")
const { prepareRequest } = require("./contextPipeline")
const { complete, getFlowConfig } = require("../providers/llm")
const { getHistory } = require("./sessionMemory")
const flowMemory = require("./flowMemory")
const conversationState = require("./conversationState")

let _cachedProfile = null
let _cachedWorkspace = null

function getProfile() {
    const ws = getActiveWorkspace()
    if (_cachedWorkspace === ws && _cachedProfile) return _cachedProfile
    try {
        const { loadProfile } = require("../setup/profileService")
        _cachedProfile = loadProfile(ws)
        _cachedWorkspace = ws
    } catch { _cachedProfile = {} }
    return _cachedProfile
}

function invalidateProfileCache() { _cachedProfile = null; _cachedWorkspace = null }

// built-in tool types — always available, eagerly loaded
const CORE_TOOLS = {
    business_chat:   require("../tools/businessChatTool"),

    // generic core types — domain-agnostic, no business-specific logic
    sqlite:          require("../tools/sqliteQueryTool"),
    rag:             require("../tools/genericRagTool"),
    support:         require("../tools/genericSupportTool"),
    sqlite_query:    require("../tools/sqliteQueryTool"),
    rag_generic:     require("../tools/genericRagTool"),
    support_generic: require("../tools/genericSupportTool"),
}

// domain-pack tool types — registered at runtime
const _dynamicTypes = new Map()

function registerToolType(name, handler) {
    if (!name || typeof handler?.execute !== "function") {
        throw new Error(`registerToolType: "${name}" must export execute()`)
    }
    if (CORE_TOOLS[name]) {
        logger.warn({ type: name }, "executor: dynamic type shadows core type")
    }
    _dynamicTypes.set(name, handler)
    logger.info({ type: name }, "executor: registered dynamic tool type")
}

function resolveToolHandler(type) {
    return _dynamicTypes.get(type) || CORE_TOOLS[type] || null
}

const SKIP_PROFILE_KEYS = new Set(["workspaceId", "domainPack", "agentManifest", "openaiKey", "scrapeWebsite", "customFields"])

function buildProfileFacts(profile, toolName) {
    const lines = []
    for (const [k, v] of Object.entries(profile)) {
        if (!v || SKIP_PROFILE_KEYS.has(k) || typeof v !== "string") continue
        lines.push(`- ${k}: ${v}`)
    }
    const custom = Array.isArray(profile.customFields) ? profile.customFields : []
    for (const f of custom) {
        if (!f.key || !f.value) continue
        if (f.tools && f.tools.length && !f.tools.includes(toolName)) continue
        lines.push(`- ${f.key}: ${f.value}`)
    }
    return lines.join("\n") || "No profile data available."
}

async function execute(manifest, intent, context) {
    const intentConfig = manifest.intents[intent.intent]
    if (!intentConfig) {
        logger.warn({ intent: intent.intent }, "executor: no intent config")
        return manifest.agent.error_message || "Something went wrong."
    }

    const toolName   = intentConfig.tool
    const toolConfig = manifest.tools[toolName]
    if (!toolConfig) {
        logger.warn({ toolName }, "executor: tool not in manifest")
        return manifest.agent.error_message || "Something went wrong."
    }

    const tool = resolveToolHandler(toolConfig.type)
    if (!tool) {
        logger.warn({ type: toolConfig.type }, "executor: unknown tool type")
        return manifest.agent.error_message || "Something went wrong."
    }

    logger.info({ intent: intent.intent, tool: toolName }, "executor: dispatching")
    context.profile = getProfile()
    context.profileFacts = buildProfileFacts(context.profile, toolName)
    context.flow = context.flow || "customer"
    if (!Array.isArray(context.history) && context.phone) {
        context.history = context.flow === "customer"
            ? flowMemory.getHistory("customer", context.phone)
            : getHistory(context.phone)
    }
    if (!context.conversationState && context.phone && (context.flow === "customer" || context.flow === "admin")) {
        context.conversationState = conversationState.getState(context.flow, context.phone)
    }
    if (!context.resolvedRequest && context.rawMessage) {
        context.resolvedRequest = {
            flow: context.flow,
            originalMessage: context.rawMessage,
            effectiveMessage: context.rawMessage,
            wasRewritten: false,
            followUpReason: null,
            followUpConfidence: 0,
            activeTopic: context.conversationState?.topic || null,
            selection: context.conversationState?.selection || null,
            appliedFilters: intent.filter || {},
            lastIntent: intent.intent || null,
        }
    }
    
    // Resolve flow and LLM config
    context.llmConfig = manifest.agent?.llm || getFlowConfig(context.flow)

    // Standard context prep for tools that use LLM directly
    context.prepareLLMRequest = (prompt, options = {}) => {
        const messages = prepareRequest(prompt, context.flow, context)
        return complete(messages, { ...options, flow: context.flow, llmConfig: context.llmConfig })
    }

    return await tool.execute(intent.filter || {}, context, toolConfig)
}

module.exports = { execute, registerToolType, resolveToolHandler, invalidateProfileCache }
