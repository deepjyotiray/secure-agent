"use strict"

const settings = require("../config/settings.json")

const PROVIDERS = {
    ollama:    require("./ollama"),
    openai:    require("./openai"),
    anthropic: require("./anthropic"),
    mlx:       require("./mlx"),
}

const cfg      = settings.llm || settings.ollama  // backwards compat
const provider = PROVIDERS[cfg.provider || "ollama"]

if (!provider) throw new Error(`Unknown LLM provider: ${cfg.provider}. Supported: ${Object.keys(PROVIDERS).join(", ")}`)

/**
 * Send a prompt to the configured LLM provider.
 * @param {string} prompt
 * @param {Object} [overrideCfg]
 * @returns {Promise<string>}
 */
async function complete(prompt, overrideCfg) {
    const finalCfg = overrideCfg || cfg
    const finalProvider = overrideCfg ? PROVIDERS[overrideCfg.provider || "openai"] : provider
    
    try {
        const result = await finalProvider.complete(prompt, finalCfg)
        if (!result) {
            console.warn(`LLM provider ${finalCfg.provider || cfg.provider} returned an empty response.`)
        }
        return result
    } catch (e) {
        console.error(`LLM provider ${finalCfg.provider || cfg.provider} error:`, e.message)
        return ""
    }
}

module.exports = { complete }
