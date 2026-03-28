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

function loadToolWithStubs({ llmText = "Fallback reply" } = {}) {
    const root = path.resolve(__dirname, "..")
    const sent = []
    let prompts = []

    stubModule(path.join(root, "config/settings.json"), {
        api: { port: 3010, secret: "secret" },
        admin: { number: "+919999999999" },
        log: { level: "silent" },
    })
    stubModule(path.join(root, "node_modules/node-fetch/lib/index.js"), async (url, options) => {
        sent.push({ url, options })
        return { ok: true }
    })
    stubModule(path.join(root, "gateway/logger.js"), {
        info() {},
        warn() {},
        error() {},
    })

    const cartStorePath = path.join(root, "tools/cartStore.js")
    const supportFlowPath = path.join(root, "tools/supportFlow.js")
    const toolPath = path.join(root, "tools/genericSupportTool.js")
    delete require.cache[require.resolve(cartStorePath)]
    delete require.cache[require.resolve(supportFlowPath)]
    delete require.cache[require.resolve(toolPath)]

    const cart = require(cartStorePath)
    cart.clearAll()

    return {
        cart,
        tool: require(toolPath),
        sent,
        context: {
            phone: "919999999999",
            rawMessage: "",
            profile: { businessName: "Test Biz", contactPhone: "+919999999999" },
            profileFacts: "- contactPhone: +919999999999",
            async prepareLLMRequest(prompt) {
                prompts.push(prompt)
                return llmText
            },
        },
        getPrompts() { return prompts },
    }
}

async function main() {
    console.log("\nGeneric Support Tool Tests\n")

    {
        const { tool, context } = loadToolWithStubs()
        context.rawMessage = "my payment is not reflecting"
        const reply = await tool.execute({}, context, {
            faq_path: "./agents/support/faq.yml",
            business_name: "Test Biz",
            escalation_phone: "+919999999999",
        })

        assert("faq match returns grounded answer", [
            ["payment guidance returned", /Payment issues are usually resolved/.test(reply)],
        ])
    }

    {
        const { tool, context, sent, cart } = loadToolWithStubs()
        context.rawMessage = "I want to talk to human"
        const reply = await tool.execute({}, context, {
            faq_path: "./agents/support/faq.yml",
            business_name: "Test Biz",
            escalation_phone: "+919999999999",
        })

        assert("escalation trigger notifies admin and clears support state", [
            ["acknowledgement returned", /We've notified our team/.test(reply)],
            ["escalation sent", sent.length === 1],
            ["support state cleared", cart.get("support:919999999999") === null],
            ["customer phone included", /\+9999999999/.test(sent[0]?.options?.body || "")],
        ])
    }

    {
        const { tool, context, getPrompts } = loadToolWithStubs({ llmText: "We can help with that." })
        context.resolvedRequest = { effectiveMessage: "do you have parking" }
        context.rawMessage = "ignored raw message"
        const reply = await tool.execute({}, context, {
            faq_path: "./agents/support/faq.yml",
            business_name: "Test Biz",
            escalation_phone: "+919999999999",
        })

        assert("llm fallback uses prepared request and resolved message", [
            ["fallback returned", reply === "We can help with that."],
            ["prompt built once", getPrompts().length === 1],
            ["effective message included", /Customer message: do you have parking/.test(getPrompts()[0] || "")],
        ])
    }

    console.log(`\nPassed: ${passed}/${total}`)
    if (failed) process.exit(1)
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})
