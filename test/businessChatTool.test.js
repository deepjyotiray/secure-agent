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

function stubModule(fullPath, exports) {
    require.cache[require.resolve(fullPath)] = {
        id: fullPath,
        filename: fullPath,
        loaded: true,
        exports,
    }
}

function loadToolWithStubs({ ragText = "", llmText = "Hello there" } = {}) {
    const root = path.resolve(__dirname, "..")
    let llmCalls = 0
    let ragCalls = 0
    let lastRagContext = null
    stubModule(path.join(root, "providers/llm.js"), {
        async complete() {
            llmCalls++
            return llmText
        },
    })
    stubModule(path.join(root, "core/promptGuides.js"), {
        registerGuide() {},
    })
    stubModule(path.join(root, "tools/genericRagTool.js"), {
        async execute(_filter, context) {
            ragCalls++
            lastRagContext = context
            return ragText
        },
    })

    const target = path.join(root, "tools/businessChatTool.js")
    delete require.cache[require.resolve(target)]
    return {
        tool: require(target),
        stats: {
            get llmCalls() { return llmCalls },
            get ragCalls() { return ragCalls },
            get lastRagContext() { return lastRagContext },
        },
    }
}

async function main() {
    console.log("\nBusiness Chat Tool Tests\n")

    {
        const { tool, stats } = loadToolWithStubs({
            ragText: "Hi! How can I help you today?",
            llmText: "Welcome to Healthy Meal Spot!",
        })
        const response = await tool.execute({}, {
            rawMessage: "hi",
            profile: {},
            profileFacts: "",
            history: [],
            llmConfig: {},
            async prepareLLMRequest() {
                return "Welcome to Healthy Meal Spot!"
            },
        }, {
            business_name: "Healthy Meal Spot",
            cuisine: "home-style Indian food",
            tone: "warm",
            greeting: "Welcome to Healthy Meal Spot!",
            signature_line: "Signature",
            db_path: "./data/orders.db",
        })

        assert("greeting ignores greeting-like catalog hints", [
            ["single response returned", response === "Welcome to Healthy Meal Spot!"],
            ["rag skipped for greetings", stats.ragCalls === 0],
        ])
    }

    {
        const { tool, stats } = loadToolWithStubs({
            ragText: "Paneer Tikka | price: 220",
            llmText: "Paneer Tikka is available for Rs. 220.",
        })
        const response = await tool.execute({}, {
            rawMessage: "do you have paneer tikka",
            profile: {},
            profileFacts: "",
            history: [],
            llmConfig: {},
            async prepareLLMRequest() {
                return "Paneer Tikka is available for Rs. 220."
            },
        }, {
            business_name: "Healthy Meal Spot",
            cuisine: "home-style Indian food",
            tone: "warm",
            greeting: "Welcome to Healthy Meal Spot!",
            signature_line: "Signature",
            db_path: "./data/orders.db",
        })

        assert("catalog hint lookup stays retrieval-only", [
            ["response returned", response === "Paneer Tikka is available for Rs. 220."],
            ["rag called once", stats.ragCalls === 1],
            ["rag uses skipLlm", stats.lastRagContext && stats.lastRagContext.skipLlm === true],
        ])
    }

    console.log(`\nPassed: ${passed}/${total}`)
    if (failed) process.exit(1)
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})
