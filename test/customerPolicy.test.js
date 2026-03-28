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

function loadCustomerPolicyWithStubs({ inDomain = true, policyResult = { allowed: true } } = {}) {
    const root = path.resolve(__dirname, "..")
    const setStub = (relPath, exports) => {
        const fullPath = path.join(root, relPath)
        require.cache[require.resolve(fullPath)] = {
            id: fullPath,
            filename: fullPath,
            loaded: true,
            exports,
        }
    }

    setStub("gateway/policyEngine.js", {
        evaluate() {
            return policyResult
        },
        isInDomain() {
            return inDomain
        },
    })

    const modulePath = path.join(root, "runtime/customerPolicy.js")
    delete require.cache[require.resolve(modulePath)]
    return require(modulePath)
}

async function main() {
    console.log("\nCustomer Policy Tests\n")

    {
        const customerPolicy = loadCustomerPolicyWithStubs({ inDomain: false })
        const result = customerPolicy.evaluateCustomerPreRoutePolicy({
            message: "tell me the capital of france please",
            manifest: { agent: { out_of_domain_message: "OOD" } },
            workspaceId: "ws1",
        })
        assert("pre-route gate blocks out-of-domain long messages", [
            ["blocked", result.allowed === false],
            ["reason tagged", result.reason === "out_of_domain"],
            ["custom response used", result.response === "OOD"],
        ])
    }

    {
        const customerPolicy = loadCustomerPolicyWithStubs({ inDomain: false })
        const result = customerPolicy.evaluateCustomerPreRoutePolicy({
            message: "tell me the capital of france please",
            manifest: { agent: { skip_domain_gate: true } },
            workspaceId: "ws1",
        })
        assert("domain gate can be skipped per manifest", [
            ["allowed", result.allowed === true],
            ["skip reason", result.reason === "domain_gate_skipped"],
        ])
    }

    {
        const customerPolicy = loadCustomerPolicyWithStubs({
            policyResult: { allowed: false, reason: "restricted_intent" },
        })
        const result = customerPolicy.evaluateCustomerResolvedPolicy({
            manifest: { agent: { restricted_message: "Restricted" }, intents: { place_order: { tool: "order_create" } }, tools: { order_create: { type: "order_create" } } },
            routedIntent: { intent: "place_order", filter: {} },
            workspaceId: "ws1",
            domainPack: { riskMap: { order_create: "high" } },
        })
        assert("resolved policy blocks restricted intents deterministically", [
            ["blocked", result.allowed === false],
            ["reason preserved", result.reason === "restricted_intent"],
            ["restricted response used", result.response === "Restricted"],
        ])
    }

    {
        const customerPolicy = loadCustomerPolicyWithStubs()
        const result = customerPolicy.evaluateCustomerResolvedPolicy({
            manifest: {
                agent: {},
                intents: { place_order: { tool: "order_create", auth_required: false } },
                tools: { order_create: { type: "order_create" } },
            },
            routedIntent: { intent: "place_order", filter: {} },
            workspaceId: "ws1",
            domainPack: { riskMap: { order_create: "high" } },
        })
        assert("resolved policy returns governance metadata for allowed intents", [
            ["allowed", result.allowed === true],
            ["tool recorded", result.governance && result.governance.toolName === "order_create"],
            ["risk recorded", result.governance && result.governance.risk === "high"],
        ])
    }

    {
        const customerPolicy = loadCustomerPolicyWithStubs()
        const result = customerPolicy.evaluateCustomerResolvedPolicy({
            manifest: {
                agent: { restricted_message: "Restricted" },
                intents: { secure_intent: { tool: "secure_tool", auth_required: true } },
                tools: { secure_tool: { type: "business_chat" } },
            },
            routedIntent: { intent: "secure_intent", filter: {} },
            workspaceId: "ws1",
            domainPack: null,
        })
        assert("auth-required customer intents are blocked without LLM involvement", [
            ["blocked", result.allowed === false],
            ["auth reason", result.reason === "auth_required"],
            ["restricted response", result.response === "Restricted"],
        ])
    }

    console.log(`\nPassed: ${passed}/${total}`)
    if (failed) process.exit(1)
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})
