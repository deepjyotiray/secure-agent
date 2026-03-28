"use strict"

const path = require("path")

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

function loadPlannerWithStubbedLlm(responseText) {
    const root = path.resolve(__dirname, "..")
    const llmPath = path.join(root, "providers/llm.js")
    require.cache[require.resolve(llmPath)] = {
        id: llmPath,
        filename: llmPath,
        loaded: true,
        exports: {
            async complete() {
                return responseText
            },
            getFlowConfig() {
                return { backend: "direct" }
            },
        },
    }

    const target = path.join(root, "runtime/customerPlanner.js")
    delete require.cache[require.resolve(target)]
    return require(target)
}

async function main() {
    console.log("\nCustomer Planner Tests\n")

    {
        const { planCustomerTurn } = loadPlannerWithStubbedLlm(`{"mode":"respond","response":"You asked me to call you Boss.","confidence":0.91,"groundedIn":"customer_profile","reason":"grounded_profile"}`)
        const result = await planCustomerTurn({
            message: "what is my name",
            conversationState: {
                customerProfile: { preferredName: "Boss" },
            },
            manifest: { intents: { general_chat: {}, place_order: {} } },
            blockedReason: "out_of_domain",
        })

        assert("planner returns grounded response", [
            ["respond mode used", result.mode === "respond"],
            ["response preserved", result.response === "You asked me to call you Boss."],
            ["grounding captured", result.groundedIn === "customer_profile"],
        ])
    }

    {
        const { planCustomerTurn } = loadPlannerWithStubbedLlm(`{"mode":"refuse","response":"","confidence":0.2,"groundedIn":"none","reason":"not_grounded"}`)
        const result = await planCustomerTurn({
            message: "what is the capital of france",
            conversationState: {
                customerProfile: { preferredName: "Boss" },
            },
            manifest: { intents: { general_chat: {} } },
            blockedReason: "out_of_domain",
        })

        assert("planner refuses ungrounded questions", [
            ["refuse mode used", result.mode === "refuse"],
            ["reason preserved", result.reason === "not_grounded"],
        ])
    }

    console.log(`\nPassed: ${passed}/${total}`)
    if (failed) process.exit(1)
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})
