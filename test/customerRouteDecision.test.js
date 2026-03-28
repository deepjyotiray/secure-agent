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

function loadRouterWithParseStub(parseResult) {
    const root = path.resolve(__dirname, "..")
    const parserPath = path.join(root, "gateway/intentParser.js")
    const routerPath = path.join(root, "gateway/customerRouter.js")

    require.cache[require.resolve(parserPath)] = {
        id: parserPath,
        filename: parserPath,
        loaded: true,
        exports: {
            async parseIntent() {
                return parseResult
            },
        },
    }

    delete require.cache[require.resolve(routerPath)]
    return require(routerPath)
}

async function main() {
    console.log("\nCustomer Route Decision Tests\n")

    const manifest = {
        intents: {
            greet: {},
            general_chat: {},
            show_menu: {},
            support: {},
            place_order: {},
        },
        _domainPackFilterSchema: {
            veg: { type: "boolean" },
            min_protein: { type: "number" },
        },
        _domainPackHeuristics: {
            menu_items: ["menu", "dish", "dishes", "food", "non veg", "spicy", "protein"],
            support: ["help", "support", "complaint", "wrong", "missing"],
            _intentMap: {
                menu_items: "show_menu",
                support: "support",
            },
        },
    }

    {
        const { routeCustomerMessage } = loadRouterWithParseStub({
            intent: "support",
            filter: {},
            confidence: 0.32,
        })
        const result = await routeCustomerMessage("Non veg spicy dishes", manifest, {
            resolvedRequest: {
                effectiveMessage: "Non veg spicy dishes",
                appliedFilters: {},
            },
        })
        assert("strong lexical menu evidence can override weak backend support classification", [
            ["routes to show_menu", result.intent === "show_menu"],
        ])
    }

    {
        const { routeCustomerMessage } = loadRouterWithParseStub({
            intent: "support",
            filter: {},
            confidence: 0.92,
        })
        const result = await routeCustomerMessage("wrong item and missing order", manifest, {
            resolvedRequest: {
                effectiveMessage: "wrong item and missing order",
                appliedFilters: {},
            },
        })
        assert("high-confidence backend support classification is preserved", [
            ["routes to support", result.intent === "support"],
        ])
    }

    {
        const { routeCustomerMessage } = loadRouterWithParseStub({
            intent: "show_menu",
            filter: { min_protein: 20 },
            confidence: 0.81,
        })
        const result = await routeCustomerMessage("High spicy", manifest, {
            resolvedRequest: {
                effectiveMessage: "Tell me which chicken items you want.\nCustomer follow-up: High spicy",
                lastIntent: "general_chat",
                followUpReason: "pending_clarification",
                appliedFilters: {},
            },
        })
        assert("backend can use conversational context to recover a structured menu intent", [
            ["routes to show_menu", result.intent === "show_menu"],
            ["preserves extracted filters", result.filter.min_protein === 20],
        ])
    }

    console.log(`\nPassed: ${passed}/${total}`)
    if (failed) process.exit(1)
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})
