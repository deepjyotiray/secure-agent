"use strict"

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
    console.log("\nCustomer Execution Strategy Tests\n")

    const manifest = {
        intents: {
            general_chat: {},
            support: {},
            show_menu: {},
        },
    }

    let result = decideCustomerExecution({
        flowConfig: { backend: "openclaw", execution: { strategy: "auto" } },
        routedIntent: { intent: "support" },
        manifest,
    })
    assert("auto keeps structured intents on tools", [
        ["tool mode", result.mode === "tool"],
        ["structured reason", result.reason === "customer_structured_intent"],
    ])

    result = decideCustomerExecution({
        flowConfig: { backend: "openclaw", execution: { strategy: "auto" } },
        routedIntent: { intent: "greet" },
        manifest: {
            intents: {
                greet: {},
                general_chat: {},
                support: {},
                show_menu: {},
            },
        },
    })
    assert("auto keeps greet on tools for low-latency replies", [
        ["tool mode", result.mode === "tool"],
        ["structured reason", result.reason === "customer_structured_intent"],
    ])

    result = decideCustomerExecution({
        flowConfig: { backend: "openclaw", execution: { strategy: "tool_first" } },
        routedIntent: { intent: "general_chat" },
        manifest,
    })
    assert("tool_first prefers manifest-backed tools", [
        ["tool mode", result.mode === "tool"],
        ["tool-first reason", result.reason === "customer_tool_first_manifest_intent"],
    ])

    result = decideCustomerExecution({
        flowConfig: {
            backend: "openclaw",
            execution: {
                strategy: "backend_first",
                backend_capabilities: { conversational: true, structured: true },
            },
        },
        routedIntent: { intent: "show_menu" },
        manifest,
    })
    assert("backend_first sends even known intents to backend by default", [
        ["backend mode", result.mode === "backend"],
        ["backend-first reason", result.reason === "customer_backend_first_default"],
    ])

    result = decideCustomerExecution({
        flowConfig: {
            backend: "openclaw",
            execution: {
                strategy: "backend_first",
                tool_intents: ["support"],
            },
        },
        routedIntent: { intent: "support" },
        manifest,
    })
    assert("explicit tool overrides beat backend_first", [
        ["tool mode", result.mode === "tool"],
        ["override reason", result.reason === "customer_strategy_tool_intent"],
    ])

    result = decideCustomerExecution({
        flowConfig: {
            backend: "openclaw",
            execution: {
                strategy: "tool_first",
                backend_intents: ["general_chat"],
            },
        },
        routedIntent: { intent: "general_chat" },
        manifest,
    })
    assert("explicit backend overrides beat tool_first", [
        ["backend mode", result.mode === "backend"],
        ["override reason", result.reason === "customer_strategy_backend_intent"],
    ])

    console.log(`\nPassed: ${passed}/${total}`)
    if (failed) process.exit(1)
}

main()
