"use strict"

const logger = require("../gateway/logger")

// Tool type → module mapping — add new tool types here only
const TOOL_REGISTRY = {
    rag:     require("../tools/ragTool"),
    sqlite:  require("../tools/sqliteTool"),
    otp:     require("../tools/otpTool"),
    support: require("../tools/supportTool"),
    static:  null,
}

/**
 * Resolves and executes a tool based on the agent manifest.
 *
 * @param {object} manifest   - loaded agent manifest
 * @param {object} intent     - { intent: string, parameters: object }
 * @param {object} context    - { phone, rawMessage }
 * @returns {Promise<string|null>}
 */
async function execute(manifest, intent, context) {
    const intentConfig = manifest.intents[intent.intent]

    if (!intentConfig) {
        logger.warn({ intent: intent.intent }, "executor: no intent config in manifest")
        return manifest.agent.error_message || "This feature is not available yet."
    }

    const toolName   = intentConfig.tool
    const toolConfig = manifest.tools[toolName]

    if (!toolConfig) {
        logger.warn({ toolName }, "executor: tool not defined in manifest")
        return manifest.agent.error_message || "This feature is not available yet."
    }

    // Static tools are resolved from manifest messages — no module invoked
    if (toolConfig.type === "static") {
        if (toolName === "static_greet") return manifest.agent.greet_message || "Hello!"
        if (toolName === "static_help")  return manifest.agent.help_message  || "How can I help?"
        return null
    }

    const tool = TOOL_REGISTRY[toolConfig.type]

    if (!tool) {
        logger.warn({ type: toolConfig.type }, "executor: unknown tool type")
        return manifest.agent.error_message || "This feature is not available yet."
    }

    logger.info({ intent: intent.intent, tool: toolName, type: toolConfig.type }, "executor: dispatching")

    return await tool.execute(intent.parameters, context, toolConfig)
}

module.exports = { execute }
