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

function loadToolWithStubs() {
    const root = path.resolve(__dirname, "..")
    const sent = []

    class FakeDatabase {
        pragma() {}
        prepare(sql) {
            return {
                get() {
                    if (/FROM users/.test(sql)) return { name: "Test Customer" }
                    return undefined
                },
                all() {
                    if (/FROM orders/.test(sql)) {
                        return [{ id: "ORD-1", order_for: "Lunch", total: 250, delivery_status: "pending", payment_status: "paid" }]
                    }
                    return []
                },
            }
        }
        close() {}
    }

    stubModule(path.join(root, "config/settings.json"), {
        api: { port: 3010, secret: "secret" },
        admin: { number: "+919999999999" },
        log: { level: "silent" },
    })
    stubModule(path.join(root, "node_modules/better-sqlite3/lib/index.js"), FakeDatabase)
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
    const toolPath = path.join(root, "domain-packs/restaurant/tools/restaurantSupport.js")
    delete require.cache[require.resolve(cartStorePath)]
    delete require.cache[require.resolve(supportFlowPath)]
    delete require.cache[require.resolve(toolPath)]

    const cart = require(cartStorePath)
    cart.clearAll()

    return {
        cart,
        tool: require(toolPath),
        sent,
    }
}

async function main() {
    console.log("\nRestaurant Support Tool Tests\n")

    {
        const { tool, cart, sent } = loadToolWithStubs()
        const context = {
            phone: "support-natural-1",
            rawMessage: "I need help",
            profile: { businessName: "Healthy Meal Spot" },
            profileFacts: "- contactPhone: +919999999999",
        }
        const config = { db_path: "./data/orders.db", escalation_phone: "+919999999999" }

        const firstReply = await tool.execute({}, context, config)
        context.rawMessage = "my order was late by 2 hours"
        const secondReply = await tool.execute({}, context, config)

        assert("natural-language follow-up is accepted while menu is open", [
            ["menu shown first", /How can we help you today/.test(firstReply)],
            ["issue is acknowledged", /We've received your message/.test(secondReply)],
            ["support state cleared after escalation", cart.get("support:support-natural-1") === null],
            ["escalation sent once", sent.length === 1],
            ["late delivery label included", /Late delivery/.test(sent[0]?.options?.body || "")],
        ])
    }

    {
        const { tool, cart, sent } = loadToolWithStubs()
        const context = {
            phone: "support-natural-2",
            rawMessage: "late delivery",
            profile: { businessName: "Healthy Meal Spot" },
            profileFacts: "",
        }
        const config = { db_path: "./data/orders.db", escalation_phone: "+919999999999" }

        const reply = await tool.execute({}, context, config)

        assert("short natural-language category routes to the matching prompt", [
            ["late-delivery prompt returned", /expected delivery time/.test(reply)],
            ["collecting state opened", (cart.get("support:support-natural-2") || {}).state === "collecting"],
            ["issue type inferred", (cart.get("support:support-natural-2") || {}).issueType === 2],
            ["no escalation yet", sent.length === 0],
        ])
    }

    console.log(`\nPassed: ${passed}/${total}`)
    if (failed) process.exit(1)
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})
