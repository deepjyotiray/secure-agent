"use strict"

const logger = require("../gateway/logger")

// built-in tool types — always available, eagerly loaded
const CORE_TOOLS = {
    business_chat: require("../tools/businessChatTool"),
    rag:          require("../tools/ragTool"),
    sqlite:       require("../tools/sqliteTool"),
    support:      require("../tools/supportTool"),
    order_create: require("../tools/orderCreateTool"),
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
    // pass filter as params so all tools receive it consistently
    return await tool.execute(intent.filter || {}, context, toolConfig)
}

module.exports = { execute, registerToolType, resolveToolHandler }
