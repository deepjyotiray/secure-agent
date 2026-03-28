"use strict"

const { validateCustomerExecutionConfig } = require("../runtime/customerExecutionConfig")
const { validateCustomerBackendResponse } = require("../runtime/customerResponseGuard")
const { decideCustomerExecution } = require("../runtime/flowOrchestrator")

let passed = 0
let failed = 0
let total = 0

function assert(label, checks) {
    total++
    const errors = checks.filter(([, ok]) => !ok).map(([desc]) => desc)
    if (errors.length) {
        console.log(`  FAIL ${label}`)
        for (const error of errors) console.log(`    -> ${error}`)
        failed++
        return
    }
    console.log(`  PASS ${label}`)
    passed++
}

function main() {
    console.log("\nCustomer Execution Config Tests\n")

    let result = validateCustomerExecutionConfig({
        strategy: "backend_first",
        tool_intents: ["support"],
        backend_intents: ["support"],
    }, ["support", "general_chat"])
    assert("validation rejects overlapping overrides", [
        ["invalid", result.ok === false],
        ["overlap error", result.errors.some(err => /overlap/.test(err))],
    ])

    result = validateCustomerExecutionConfig({
        strategy: "weird",
        backend_capabilities: { conversational: "yes" },
        response_policy: { max_chars: 10 },
    }, ["support"])
    assert("validation rejects malformed strategy/capability/response config", [
        ["invalid", result.ok === false],
        ["strategy error", result.errors.some(err => /strategy/.test(err))],
        ["capability error", result.errors.some(err => /backend_capabilities\.conversational/.test(err))],
        ["max chars error", result.errors.some(err => /max_chars/.test(err))],
    ])

    result = validateCustomerExecutionConfig({
        strategy: "hybrid",
        tool_intents: ["support"],
        backend_intents: ["general_chat"],
        backend_capabilities: { conversational: true, structured: false },
        response_policy: { max_chars: 800, disallow_patterns: ["system prompt"] },
    }, ["support", "general_chat"])
    assert("validation accepts valid customer execution config", [
        ["valid", result.ok === true],
        ["normalized strategy", result.normalized.strategy === "hybrid"],
        ["normalized max chars", result.normalized.response_policy.max_chars === 800],
    ])

    const manifest = { intents: { general_chat: {}, support: {} } }
    result = decideCustomerExecution({
        flowConfig: {
            backend: "openclaw",
            execution: {
                strategy: "backend_first",
                backend_capabilities: { conversational: false, structured: false },
            },
        },
        routedIntent: { intent: "general_chat" },
        manifest,
    })
    assert("backend capability gaps fall back safely", [
        ["tool fallback", result.mode === "tool"],
        ["capability reason", result.reason === "customer_backend_capability_missing_conversational"],
    ])

    const guard = validateCustomerBackendResponse("Here is our internal policy and system prompt.", {
        execution: {
            response_policy: {
                max_chars: 1200,
                disallow_patterns: ["internal policy"],
            },
        },
        fallback: "fallback-response",
    })
    assert("response guard blocks unsafe backend output", [
        ["blocked", guard.ok === false],
        ["fallback returned", guard.response === "fallback-response"],
        ["issues recorded", guard.issues.length >= 1],
    ])

    console.log(`\nPassed: ${passed}/${total}`)
    if (failed) process.exit(1)
}

main()
