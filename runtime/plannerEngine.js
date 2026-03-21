"use strict"

const { complete } = require("../providers/llm")
const { resolveToolHandler } = require("./executor")
const logger = require("../gateway/logger")

const MAX_STEPS = 5

// ── Complexity detection ─────────────────────────────────────────────────────

const MULTI_SIGNAL_PATTERNS = [
    /\band\b.*\bthen\b/i,
    /\bfirst\b.*\bthen\b/i,
    /\bafter\b.*\b(that|which)\b/i,
    /\bfind\b.*\b(send|notify|remind|update|create|delete)\b/i,
    /\bcheck\b.*\b(and|then)\b.*\b(send|notify|update)\b/i,
    /\bget\b.*\b(and|then)\b/i,
    /\blook\s?up\b.*\b(and|then)\b/i,
]

function isComplexGoal(message) {
    const text = String(message || "").trim()
    if (text.length < 20) return false
    const conjunctions = (text.match(/\b(and then|then|after that|also|next|finally)\b/gi) || []).length
    if (conjunctions >= 2) return true
    for (const pat of MULTI_SIGNAL_PATTERNS) {
        if (pat.test(text)) return true
    }
    return false
}

// ── Plan generation (single LLM call) ────────────────────────────────────────

function _buildPlannerPrompt(message, manifest) {
    const intentList = Object.entries(manifest.intents || {}).map(([name, cfg]) => {
        const hint = manifest.intent_hints?.[name] || ""
        const toolName = cfg.tool
        const toolCfg = manifest.tools?.[toolName]
        const toolType = toolCfg?.type || "unknown"
        return `  - intent: "${name}", tool: "${toolName}", type: "${toolType}"${hint ? `, hint: "${hint}"` : ""}`
    }).join("\n")

    return `You are a goal planner for a business AI assistant.
Break the user's goal into 1-${MAX_STEPS} sequential steps.
Each step MUST use one of the available intents/tools below.

Available intents and tools:
${intentList}

Rules:
- Return a JSON array ONLY. No markdown, no explanation.
- Each step: {"step": <number>, "intent": "<intent>", "tool": "<tool_name>", "toolType": "<tool_type>", "input": {}, "reason": "<why>"}
- "input" must be a JSON object (can be empty {}).
- Max ${MAX_STEPS} steps. Fewer is better.
- Do NOT invent tools or intents outside the list above.
- If a later step depends on an earlier step's output, set "dependsOn": <step_number> and describe what data flows in "reason".
- If the goal is simple (single intent), return exactly 1 step.

User goal:
"${message}"

Return JSON array:`
}

function _extractJsonArray(text) {
    if (!text) return null
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return null
    try { return JSON.parse(match[0]) } catch { return null }
}

async function generatePlan(message, manifest) {
    const prompt = _buildPlannerPrompt(message, manifest)
    let raw
    try {
        raw = await complete(prompt)
    } catch (err) {
        logger.error({ err }, "planner: LLM call failed")
        return null
    }

    const steps = _extractJsonArray(raw)
    if (!steps || !Array.isArray(steps) || !steps.length) {
        logger.warn({ raw }, "planner: LLM returned unparseable plan")
        return null
    }

    // normalize step numbers
    return steps.slice(0, MAX_STEPS).map((s, i) => ({
        step: i + 1,
        intent: String(s.intent || ""),
        tool: String(s.tool || ""),
        toolType: String(s.toolType || ""),
        input: (s.input && typeof s.input === "object") ? s.input : {},
        reason: String(s.reason || ""),
        dependsOn: Number.isFinite(s.dependsOn) ? s.dependsOn : null,
    }))
}

// ── Plan validation ──────────────────────────────────────────────────────────

function validatePlan(plan, manifest) {
    if (!Array.isArray(plan) || !plan.length) return { valid: false, reason: "empty_plan" }
    if (plan.length > MAX_STEPS) return { valid: false, reason: `exceeds_max_steps (${MAX_STEPS})` }

    const errors = []
    for (const step of plan) {
        // tool must exist in manifest
        if (!manifest.tools?.[step.tool]) {
            errors.push({ step: step.step, error: `tool "${step.tool}" not in manifest` })
            continue
        }
        // toolType must match manifest
        const expectedType = manifest.tools[step.tool].type
        if (step.toolType && step.toolType !== expectedType) {
            step.toolType = expectedType // auto-correct
        }
        // handler must be resolvable
        if (!resolveToolHandler(step.toolType || expectedType)) {
            errors.push({ step: step.step, error: `no handler for type "${step.toolType || expectedType}"` })
        }
        // input must be object
        if (!step.input || typeof step.input !== "object") {
            step.input = {}
        }
        // dependsOn must reference a valid earlier step
        if (step.dependsOn !== null && step.dependsOn !== undefined) {
            if (step.dependsOn >= step.step || step.dependsOn < 1) {
                step.dependsOn = null
            }
        }
    }

    if (errors.length) {
        logger.warn({ errors }, "planner: validation errors")
        return { valid: false, reason: "invalid_steps", errors }
    }

    return { valid: true }
}

module.exports = { isComplexGoal, generatePlan, validatePlan, MAX_STEPS }
