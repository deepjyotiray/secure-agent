"use strict"

const crypto = require("crypto")
const { sanitize, normalize } = require("../gateway/sanitizer")
const { heuristicIntent } = require("../gateway/customerRouter")
const { parseIntent } = require("../gateway/intentParser")
const { evaluate, isInDomain } = require("../gateway/policyEngine")
const { resolveToolHandler } = require("./executor")
const { isComplexGoal, generatePlan, validatePlan } = require("./plannerEngine")
const workflowStore = require("./workflowStore")
const cartStore = require("../tools/cartStore")
let _agentChain = null
function agentChain() { if (!_agentChain) _agentChain = require("./agentChain"); return _agentChain }
const logger = require("../gateway/logger")

const _pending = new Map()
const _intentCache = new Map()
const PREVIEW_TTL = 10 * 60 * 1000
const INTENT_CACHE_TTL = 30 * 1000 // 30 seconds

setInterval(() => {
    const now = Date.now()
    for (const [id, p] of _pending) {
        if (now - new Date(p.preview.timestamp).getTime() > PREVIEW_TTL) _pending.delete(id)
    }
    for (const [key, val] of _intentCache) {
        if (now - val.timestamp > INTENT_CACHE_TTL) _intentCache.delete(key)
    }
}, 60_000).unref()

function getCachedIntent(phone, message) {
    const key = `${phone}:${message}`
    const cached = _intentCache.get(key)
    if (cached && Date.now() - cached.timestamp < INTENT_CACHE_TTL) return cached.data
    return null
}

// ── Execution Policy ─────────────────────────────────────────────────────────

const DEFAULT_POLICY = { low: "preview", medium: "preview", high: "approval", critical: "blocked" }
let _executionPolicy = { ...DEFAULT_POLICY }
let _autoModeEnabled = false

function setExecutionPolicy(policy) {
    _executionPolicy = { ...DEFAULT_POLICY, ...policy }
}
function getExecutionPolicy() { return { ..._executionPolicy, autoMode: _autoModeEnabled } }
function setAutoMode(enabled) { _autoModeEnabled = !!enabled }
function isAutoMode() { return _autoModeEnabled }

// ── helpers ──────────────────────────────────────────────────────────────────

function rid() { return `prev-${crypto.randomBytes(8).toString("hex")}` }
function elapsed(start) { return `${Date.now() - start}ms` }

// Core risk map — generic tool types only. Domain packs extend via riskMap export.
const CORE_RISK_MAP = {
    sqlite: "medium", sqlite_query: "medium",
    rag: "low", rag_generic: "low",
    support: "low", support_generic: "low",
    business_chat: "low",
}
const _dynamicRiskMap = new Map()
function registerRiskMap(map) { for (const [k, v] of Object.entries(map)) _dynamicRiskMap.set(k, v) }
const RISK_ORDER = ["low", "medium", "high", "critical"]
function riskOf(type) { return _dynamicRiskMap.get(type) || CORE_RISK_MAP[type] || "medium" }

function aggregateRisk(plan) {
    if (!plan || !plan.length) return "low"
    let max = 0
    for (const step of plan) {
        const idx = RISK_ORDER.indexOf(step.risk || "medium")
        if (idx > max) max = idx
    }
    return RISK_ORDER[max]
}

function resolveExecutionMode(finalRisk) {
    if (!_autoModeEnabled) return finalRisk === "critical" ? "blocked" : "preview"
    return _executionPolicy[finalRisk] || "preview"
}

// ── Explanation Builder (deterministic, no LLM) ──────────────────────────────

function buildExplanation(intent, toolName, toolType, toolConfig, manifest, policyChecks, routing, plan) {
    const hints = manifest.intent_hints || {}
    const isMultiStep = plan && plan.length > 1

    const intentDesc = hints[intent] || manifest.intents?.[intent]?.description || `Matched intent "${intent}"`
    const toolDesc = toolConfig?.description || `Tool "${toolName}" of type "${toolType}"`
    const risk = riskOf(toolType)
    const riskReasons = []
    if (risk === "high" || risk === "critical") riskReasons.push(`Tool type "${toolType}" is classified as ${risk} risk`)
    else if (risk === "medium") riskReasons.push(`Tool type "${toolType}" performs data queries`)
    else riskReasons.push(`Tool type "${toolType}" is read-only/informational`)

    const explanation = {
        intent: `${routing?.source === "llm" ? "LLM classified" : routing?.source === "session" ? "Session routed" : routing?.source === "planner" ? "Goal planner decomposed" : "Heuristic matched"} → "${intent}": ${intentDesc}`,
        tool: toolDesc,
        risk: riskReasons.join("; "),
    }

    if (isMultiStep) {
        explanation.plan = `Goal decomposed into ${plan.length} steps by the planner`
        const deps = plan.filter(s => s.dependsOn)
        explanation.flow = deps.length
            ? deps.map(s => `Step ${s.step} uses output of step ${s.dependsOn}`).join("; ")
            : "Steps are independent"
    }

    return explanation
}

// ── Summary Builder ──────────────────────────────────────────────────────────

function buildSummary(plan, finalRisk, mode, intent, manifest) {
    const isMultiStep = plan && plan.length > 1
    const intentConfig = manifest.intents?.[intent]
    const title = isMultiStep
        ? `Multi-step workflow (${plan.length} steps)`
        : (intentConfig?.description || `Execute "${intent}" intent`)
    const steps = (plan || []).map(s => s.reason || `Run ${s.tool} (${s.toolType})`)
    const actionMap = { auto: "auto", preview: "review", approval: "approval required", blocked: "blocked" }
    return { title, steps, risk: finalRisk, action: actionMap[mode] || mode }
}

// ── main builder ─────────────────────────────────────────────────────────────

async function buildPreview(message, phone, workspaceId) {
    const manifest = agentChain()._manifest
    if (!manifest) throw new Error("No agent loaded")

    const requestId = rid()
    const timestamp = new Date().toISOString()
    const gates = []

    // ── Gate 1: Sanitizer ────────────────────────────────────────────────────
    let t0 = Date.now()
    const sanity = sanitize(message)
    const sanitized = sanity.safe ? normalize(message) : null
    gates.push({
        id: "sanitizer", name: "Input Sanitizer", order: 1,
        status: sanity.safe ? "pass" : "fail", duration: elapsed(t0),
        input: { raw: message, length: message.length },
        output: sanity.safe
            ? { sanitized, reason: "All 5 security layers passed" }
            : { blocked: true, reason: sanity.reason },
        detail: sanity.safe
            ? "Message passed injection, code-exec, path-traversal, XSS, and SQL checks."
            : `Blocked: ${sanity.reason}`,
    })

    if (!sanity.safe) {
        return _store(requestId, timestamp, gates, "blocked", null, { phone, workspaceId, message })
    }

    // ── Gate 2: Session State ────────────────────────────────────────────────
    t0 = Date.now()
    const activeSession = cartStore.get(phone)
    const activeSupport = cartStore.get(`support:${phone}`)
    let sessionOverride = null

    if (activeSession && activeSession.state === "support_handoff") {
        sessionOverride = { intent: "support", reason: "Session support_handoff" }
    } else if (activeSession) {
        const cartIntent = agentChain()._sessionRouting?.activeCartIntent || Object.keys(agentChain()._manifest?.intents || {})[0] || "general_chat"
        sessionOverride = { intent: cartIntent, reason: `Active session (${activeSession.state})` }
    } else if (activeSupport) {
        sessionOverride = { intent: "support", reason: `Active support (${activeSupport.state})` }
    }

    gates.push({
        id: "session", name: "Session State", order: 2,
        status: sessionOverride ? "override" : "pass", duration: elapsed(t0),
        input: { phone, hasSession: !!activeSession, hasSupport: !!activeSupport },
        output: sessionOverride
            ? { override: true, forcedIntent: sessionOverride.intent, reason: sessionOverride.reason }
            : { override: false, reason: "No active session" },
        detail: sessionOverride
            ? `Session override → "${sessionOverride.intent}"`
            : "No active session. Proceeding to classification.",
    })

    // ── Gate 3: Heuristic ────────────────────────────────────────────────────
    t0 = Date.now()
    const domainHeuristics = manifest._domainPackHeuristics || null
    const heuristic = heuristicIntent(message, domainHeuristics)
    gates.push({
        id: "heuristic", name: "Heuristic Classifier", order: 3,
        status: sessionOverride ? "skipped" : "pass", duration: elapsed(t0),
        input: { message, source: domainHeuristics ? "domain_pack" : "default" },
        output: sessionOverride
            ? { skipped: true }
            : { intent: heuristic.intent, filter: heuristic.filter },
        detail: sessionOverride
            ? "Skipped — session override active."
            : `Keyword match → "${heuristic.intent}"`,
    })

    // ── Gate 4: LLM Intent ───────────────────────────────────────────────────
    let llmIntent = null, llmFilter = {}, llmPrompt = null
    t0 = Date.now()

    if (sessionOverride) {
        gates.push({
            id: "llm_intent", name: "LLM Intent Classifier", order: 4,
            status: "skipped", duration: "0ms",
            input: { skipped: true }, output: { reason: "Session override" },
            llmRequest: null, detail: "Skipped — session override.",
        })
    } else {
        llmPrompt = _buildIntentPrompt(message, manifest)
        try {
            const configuredIntents = Object.keys(manifest.intents || {})
            const result = await parseIntent(message, {
                allowedIntents: configuredIntents,
                intentHints: manifest.intent_hints || {},
                businessProfile: manifest.agent?.description || manifest.agent?.name || "business assistant",
                defaultIntent: configuredIntents.includes("general_chat") ? "general_chat" : configuredIntents[0] || "general_chat",
                filterSchema: manifest._domainPackFilterSchema || undefined,
                filterExamples: manifest._domainPackFilterExamples || undefined,
            })
            llmIntent = result.intent
            llmFilter = result.filter || {}
            _intentCache.set(`${phone}:${message}`, { timestamp: Date.now(), data: result })
        } catch { llmIntent = null }

        const agreed = llmIntent === heuristic.intent
        gates.push({
            id: "llm_intent", name: "LLM Intent Classifier", order: 4,
            status: llmIntent ? "pass" : "fail", duration: elapsed(t0),
            input: { message, model: "gpt-4o-mini", allowedIntents: Object.keys(manifest.intents || {}) },
            output: llmIntent
                ? { intent: llmIntent, filter: llmFilter, agreedWithHeuristic: agreed, reason: agreed ? "Confirmed heuristic" : `LLM: "${llmIntent}" vs heuristic: "${heuristic.intent}"` }
                : { intent: null, reason: "LLM failed — falling back to heuristic" },
            llmRequest: llmPrompt,
            detail: llmIntent
                ? `LLM → "${llmIntent}". ${agreed ? "Agrees with heuristic." : `Overrides heuristic ("${heuristic.intent}").`}`
                : "LLM failed. Using heuristic.",
        })
    }

    // resolve final intent + filter
    let intent, filter
    if (sessionOverride) {
        intent = sessionOverride.intent; filter = {}
    } else if (llmIntent && (manifest.intents || {})[llmIntent]) {
        intent = llmIntent; filter = llmFilter
    } else {
        intent = heuristic.intent; filter = heuristic.filter || {}
    }

    // ── Gate 5: Policy ───────────────────────────────────────────────────────
    t0 = Date.now()
    const domainCheck = isInDomain(message, workspaceId)
    const policyResult = evaluate({ intent }, workspaceId)
    const policyChecks = [
        { rule: "domain_keywords", passed: domainCheck, detail: domainCheck ? "Message contains domain keyword" : "No domain keyword match" },
        { rule: "intent_not_restricted", passed: policyResult.allowed || policyResult.reason !== "restricted_intent", detail: policyResult.reason === "restricted_intent" ? `"${intent}" is restricted` : "Not restricted" },
        { rule: "intent_in_allowlist", passed: policyResult.allowed || policyResult.reason !== "not_in_allowlist", detail: policyResult.reason === "not_in_allowlist" ? `"${intent}" not in allowlist` : "Allowed" },
    ]
    gates.push({
        id: "policy", name: "Policy Engine", order: 5,
        status: policyResult.allowed ? "pass" : "fail", duration: elapsed(t0),
        input: { intent, workspaceId },
        output: { allowed: policyResult.allowed, reason: policyResult.reason || "allowed", checks: policyChecks },
        detail: policyResult.allowed
            ? `"${intent}" passed all policy checks.`
            : `"${intent}" blocked: ${policyResult.reason}.`,
    })

    // ── Gate 6: Manifest Guard ───────────────────────────────────────────────
    t0 = Date.now()
    const originalIntent = intent
    const inManifest = !!manifest.intents[intent]
    if (!inManifest) intent = manifest.intents.general_chat ? "general_chat" : Object.keys(manifest.intents)[0]
    gates.push({
        id: "manifest_guard", name: "Manifest Guard", order: 6,
        status: inManifest ? "pass" : "fallback", duration: elapsed(t0),
        input: { intent: originalIntent, availableIntents: Object.keys(manifest.intents) },
        output: inManifest
            ? { intent, reason: `"${intent}" exists in manifest` }
            : { intent, originalIntent, reason: `"${originalIntent}" not in manifest → "${intent}"` },
        detail: inManifest
            ? `"${intent}" found in manifest.`
            : `Fallback: "${originalIntent}" → "${intent}".`,
    })

    // ── Gate 7: Tool Resolution ──────────────────────────────────────────────
    t0 = Date.now()
    const intentConfig = manifest.intents[intent]
    const toolName = intentConfig?.tool
    const toolConfig = toolName ? manifest.tools[toolName] : null
    const toolType = toolConfig?.type || null
    const toolHandler = toolConfig ? resolveToolHandler(toolType) : null
    gates.push({
        id: "tool_resolution", name: "Tool Resolution", order: 7,
        status: toolHandler ? "pass" : "fail", duration: elapsed(t0),
        input: { intent, toolName, toolType },
        output: toolHandler
            ? { resolved: true, tool: toolName, type: toolType, risk: riskOf(toolType) }
            : { resolved: false, reason: toolName ? `No handler for "${toolType}"` : "No tool for intent" },
        detail: toolHandler
            ? `"${toolName}" (${toolType}) resolved. Risk: ${riskOf(toolType)}.`
            : "Tool resolution failed.",
    })

    // ── Build structured plan + input ────────────────────────────────────────
    let plan = null
    let inputTrace = { raw: message, sanitized }
    let routing = {
        intent,
        source: sessionOverride ? "session" : (llmIntent ? "llm" : "heuristic"),
        confidence: null,
        filter,
    }

    // ── Multi-step planner (Gate 8, only for complex goals) ───────────────
    let isMultiStep = false
    if (policyResult.allowed && toolHandler && !sessionOverride && isComplexGoal(message)) {
        t0 = Date.now()
        const rawPlan = await generatePlan(message, manifest)
        if (rawPlan && rawPlan.length > 1) {
            const validation = validatePlan(rawPlan, manifest)
            if (validation.valid) {
                isMultiStep = true
                plan = rawPlan.map((s, i) => {
                    const tc = manifest.tools[s.tool] || {}
                    const safeConfig = { ...tc }; delete safeConfig.api_key
                    return {
                        ...s,
                        step: i + 1,
                        toolType: tc.type || s.toolType,
                        toolConfig: safeConfig,
                        risk: riskOf(tc.type || s.toolType),
                    }
                })
                routing.source = "planner"
                gates.push({
                    id: "planner", name: "Goal Planner", order: 8,
                    status: "pass", duration: elapsed(t0),
                    input: { message, complexity: "multi-step" },
                    output: { steps: plan.length, intents: plan.map(s => s.intent) },
                    detail: `Decomposed into ${plan.length} steps.`,
                })
            } else {
                gates.push({
                    id: "planner", name: "Goal Planner", order: 8,
                    status: "fallback", duration: elapsed(t0),
                    input: { message, complexity: "multi-step" },
                    output: { reason: validation.reason, errors: validation.errors },
                    detail: `Plan validation failed: ${validation.reason}. Falling back to single-step.`,
                })
            }
        } else {
            gates.push({
                id: "planner", name: "Goal Planner", order: 8,
                status: "skipped", duration: elapsed(t0),
                input: { message, complexity: "simple" },
                output: { reason: "LLM returned single step or failed" },
                detail: "Single-step goal. Using standard flow.",
            })
        }
    }

    // ── Single-step plan (default) ───────────────────────────────────────
    if (!plan && policyResult.allowed && toolHandler) {
        const safeConfig = { ...toolConfig }; delete safeConfig.api_key
        plan = [{
            step: 1,
            tool: toolName,
            toolType,
            toolConfig: safeConfig,
            input: filter || {},
            risk: riskOf(toolType),
            reason: `Intent "${intent}" → tool "${toolName}" (${toolType})`,
        }]
    }

    // freeze execution context for deterministic replay
    const frozenContext = {
        phone, workspaceId, message, intent, filter,
        toolName, toolType, toolConfig: toolConfig ? { ...toolConfig } : null,
        isMultiStep,
    }

    // ── Risk aggregation + decision engine ────────────────────────────────
    const finalRisk = plan ? aggregateRisk(plan) : "low"
    const mode = (!policyResult.allowed || !toolHandler) ? "blocked" : resolveExecutionMode(finalRisk)

    const status = !policyResult.allowed ? "policy_blocked"
        : !toolHandler ? "no_handler"
        : mode === "blocked" ? "blocked"
        : mode === "auto" ? "auto_executing"
        : "awaiting_approval"

    const explanation = (policyResult.allowed && toolHandler)
        ? buildExplanation(intent, toolName, toolType, toolConfig, manifest, policyChecks, routing, plan)
        : null
    const summary = buildSummary(plan, finalRisk, mode, intent, manifest)
    const execution = { mode, finalRisk, isMultiStep }

    const preview = _store(requestId, timestamp, gates, status, plan, frozenContext, inputTrace, routing, policyChecks, execution, explanation, summary)

    // ── Auto-execute if policy says so ───────────────────────────────────
    if (mode === "auto" && plan && plan.length) {
        logger.info({ requestId, finalRisk }, "preview: auto-executing low-risk plan")
        const result = await _executeSteps(requestId, plan, frozenContext)
        return { ...preview, autoExecuted: true, executionResult: result }
    }

    return preview
}

function _store(requestId, timestamp, gates, status, plan, frozenContext, inputTrace, routing, policyChecks, execution, explanation, summary) {
    const preview = {
        requestId, timestamp, status,
        input: inputTrace || { raw: frozenContext?.message || "" },
        routing: routing || null,
        policy: { allowed: status !== "policy_blocked", checks: policyChecks || [] },
        plan: plan || [],
        gates,
        execution: execution || { mode: "preview", finalRisk: "low" },
        explanation: explanation || null,
        summary: summary || null,
    }
    _pending.set(requestId, {
        preview,
        frozen: frozenContext || {},
        approvedAt: null,
        executionResult: null,
    })
    return preview
}

// ── Shared step executor (used by approve AND auto-execute) ──────────────────

async function _executeSteps(requestId, plan, frozen) {
    const results = []
    const memory = {}
    for (const step of plan) {
        const handler = resolveToolHandler(step.toolType)
        if (!handler) {
            results.push({ step: step.step, status: "error", error: `No handler for "${step.toolType}"` })
            continue
        }
        const toolConfig = step.toolConfig || frozen.toolConfig || {}
        const context = { phone: frozen.phone, rawMessage: frozen.message, memory }
        // merge previous step output into input if dependsOn is set
        let input = step.input || frozen.filter || {}
        if (step.dependsOn && memory[`step_${step.dependsOn}`]) {
            input = { ...input, _previousOutput: memory[`step_${step.dependsOn}`] }
        }
        try {
            const t0 = Date.now()
            const response = await handler.execute(input, context, toolConfig)
            memory[`step_${step.step}`] = response
            results.push({ step: step.step, tool: step.tool, toolType: step.toolType, status: "success", duration: `${Date.now() - t0}ms`, response, dependsOn: step.dependsOn || null })
        } catch (err) {
            logger.error({ requestId, step: step.step, err }, "preview: step execution failed")
            results.push({ step: step.step, tool: step.tool, toolType: step.toolType, status: "error", error: err.message, dependsOn: step.dependsOn || null })
        }
    }

    const entry = _pending.get(requestId)
    if (entry) {
        entry.preview.status = "executed"
        entry.executionResult = results
    }

    const finalResponse = results.find(r => r.status === "success")?.response || results[0]?.error || "Execution completed."
    try {
        const { addTurn } = require("./sessionMemory")
        addTurn(frozen.phone, frozen.message, finalResponse, frozen.intent)
    } catch { /* optional */ }

    return { requestId, status: "executed", intent: frozen.intent, response: finalResponse, steps: results }
}

// ── Approve + deterministic execution ────────────────────────────────────────

async function approveAndExecute(requestId, modifiedPlan) {
    const entry = _pending.get(requestId)
    if (!entry) return { error: "preview_not_found" }
    if (entry.preview.status !== "awaiting_approval") {
        return { error: "not_approvable", message: `Status is "${entry.preview.status}"` }
    }

    entry.approvedAt = new Date().toISOString()
    const frozen = entry.frozen
    const plan = modifiedPlan || entry.preview.plan

    if (!plan || !plan.length) {
        _pending.delete(requestId)
        return { requestId, status: "executed", intent: frozen.intent, response: "No execution steps in plan.", steps: [] }
    }

    logger.info({ requestId, intent: frozen.intent, steps: plan.length }, "preview: approved, executing frozen plan")
    const result = await _executeSteps(requestId, plan, frozen)
    result.approvedAt = entry.approvedAt
    return result
}

function reject(requestId) {
    const entry = _pending.get(requestId)
    if (!entry) return null
    entry.preview.status = "rejected"
    return { requestId, status: "rejected" }
}

function getPending(requestId) {
    const entry = _pending.get(requestId)
    if (!entry) return null
    return { preview: entry.preview, executionResult: entry.executionResult }
}

function listPending() {
    return [..._pending.entries()].map(([, e]) => e.preview)
}

function getEntry(requestId) {
    return _pending.get(requestId) || null
}

// ── Intent prompt builder (mirrors intentParser.js) ──────────────────────────

function _buildIntentPrompt(message, manifest) {
    const configuredIntents = Object.keys(manifest.intents || {})
    const intentHints = manifest.intent_hints || {}
    const businessProfile = manifest.agent?.description || manifest.agent?.name || "business assistant"
    const defaultIntent = configuredIntents.includes("general_chat") ? "general_chat" : configuredIntents[0] || "general_chat"

    const filterSchema = manifest._domainPackFilterSchema || {
        query: { type: "string", description: "search terms" },
    }

    const filterTemplate = JSON.stringify(
        Object.fromEntries(Object.keys(filterSchema).map(k => [k, null])), null, 2
    )

    const intentGuide = configuredIntents.map(i => `- "${i}": ${intentHints[i] || "No hint."}`).join("\n")

    const defaultExamples = [
        { input: `"what can you help with"`, output: `{"intent":"general_chat","filter":{"query":null}}` },
        { input: `"I need support"`, output: `{"intent":"support","filter":{"query":null}}` },
    ]
    const examples = manifest._domainPackFilterExamples || defaultExamples
    const examplesStr = examples.map(ex => `- ${ex.input} -> ${typeof ex.output === "string" ? ex.output : JSON.stringify(ex.output)}`).join("\n")

    return `You are a WhatsApp business intent router for ${businessProfile}.
Return JSON only.

Allowed intents:
${intentGuide}

Filter template:
${filterTemplate}

Examples:
${examplesStr}

Message:
${message}

Return: {"intent":"${defaultIntent}","filter":${filterTemplate}}`
}

// ── Workflow Preview (skip planner, use stored plan) ─────────────────────────

async function buildWorkflowPreview(workflowId, phone, workspaceId, params) {
    const manifest = agentChain()._manifest
    if (!manifest) throw new Error("No agent loaded")

    const workflow = workflowStore.get(workflowId)
    if (!workflow) throw new Error("workflow_not_found")

    let plan = workflow.plan.map((s, i) => {
        const tc = manifest.tools[s.tool] || {}
        const safeConfig = { ...tc }; delete safeConfig.api_key
        return {
            ...s,
            step: i + 1,
            toolType: tc.type || s.toolType,
            toolConfig: safeConfig,
            risk: riskOf(tc.type || s.toolType),
        }
    })

    // inject runtime parameters
    if (params && Object.keys(params).length) {
        plan = workflowStore.injectParams(plan, params)
    }

    const requestId = rid()
    const timestamp = new Date().toISOString()
    const gates = [{
        id: "workflow", name: "Workflow Template", order: 0,
        status: "pass", duration: "0ms",
        input: { workflowId, name: workflow.name, params: params || {} },
        output: { steps: plan.length },
        detail: `Loaded workflow "${workflow.name}" (${plan.length} steps).`,
    }]

    // validate all tools still resolve
    for (const step of plan) {
        if (!resolveToolHandler(step.toolType)) {
            return _store(requestId, timestamp, gates, "no_handler", null, { phone, workspaceId, message: `[workflow] ${workflow.name}`, intent: plan[0]?.intent })
        }
    }

    const finalRisk = aggregateRisk(plan)
    const mode = resolveExecutionMode(finalRisk)
    const isMultiStep = plan.length > 1

    const status = mode === "blocked" ? "blocked" : mode === "auto" ? "auto_executing" : "awaiting_approval"

    const frozenContext = {
        phone, workspaceId, message: `[workflow] ${workflow.name}`,
        intent: plan[0]?.intent || "workflow", filter: {},
        toolName: plan[0]?.tool, toolType: plan[0]?.toolType,
        toolConfig: plan[0]?.toolConfig, isMultiStep,
    }

    const routing = { intent: "workflow", source: "workflow", confidence: null, filter: {} }
    const execution = { mode, finalRisk, isMultiStep, workflowId, workflowName: workflow.name }
    const explanation = {
        intent: `Workflow template: "${workflow.name}"`,
        tool: plan.map(s => s.tool).join(" → "),
        risk: `Aggregated risk across ${plan.length} steps: ${finalRisk}`,
        plan: `Saved workflow with ${plan.length} steps`,
        flow: plan.filter(s => s.dependsOn).map(s => `Step ${s.step} uses output of step ${s.dependsOn}`).join("; ") || "Steps are independent",
    }
    const summary = {
        title: workflow.name,
        steps: plan.map(s => s.reason || `Run ${s.tool} (${s.toolType})`),
        risk: finalRisk,
        action: { auto: "auto", preview: "review", approval: "approval required", blocked: "blocked" }[mode] || mode,
    }

    const preview = _store(requestId, timestamp, gates, status, plan, frozenContext, { raw: `[workflow] ${workflow.name}` }, routing, [], execution, explanation, summary)

    if (mode === "auto" && plan.length) {
        logger.info({ requestId, workflowId, finalRisk }, "workflow: auto-executing")
        const result = await _executeSteps(requestId, plan, frozenContext)
        return { ...preview, autoExecuted: true, executionResult: result }
    }

    return preview
}

module.exports = {
    buildPreview, buildWorkflowPreview, approveAndExecute, reject, getPending, listPending, getEntry,
    setExecutionPolicy, getExecutionPolicy, setAutoMode, isAutoMode, registerRiskMap,
    getCachedIntent
}
