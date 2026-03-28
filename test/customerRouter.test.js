"use strict"

const { heuristicIntent } = require("../gateway/customerRouter")

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
    console.log("\nCustomer Router Tests\n")

    const greet = heuristicIntent("hi", null, null)
    assert("plain greeting still matches greet", [
        ["intent is greet", greet.intent === "greet"],
    ])

    const highSpicy = heuristicIntent("high spicy", null, null)
    assert("high does not accidentally match hi", [
        ["does not route to greet", highSpicy.intent !== "greet"],
    ])

    const chicken = heuristicIntent("chicken", null, null)
    assert("chicken does not accidentally match hi", [
        ["does not route to greet", chicken.intent !== "greet"],
    ])

    const restaurant = require("../domain-packs/restaurant")
    const heuristics = {
        support: ["problem", "issue", "complaint", "wrong", "missing", "human", "manager", "agent", "support", "help"],
        greet: ["hi", "hello", "hey", "namaste", "good morning", "good evening", "thanks", "thank you"],
        ...restaurant.heuristics,
        _intentMap: {
            support: "support",
            greet: "greet",
            ...restaurant.heuristicIntentMap,
        },
    }

    const menuLike = heuristicIntent("Non veg spicy dishes", heuristics, null)
    assert("food/menu phrases beat generic support routing", [
        ["routes to show_menu", menuLike.intent === "show_menu"],
    ])

    const actualSupport = heuristicIntent("wrong item and missing order", heuristics, null)
    assert("actual complaint phrases still route to support", [
        ["routes to support", actualSupport.intent === "support"],
    ])

    console.log(`\nPassed: ${passed}/${total}`)
    if (failed) process.exit(1)
}

main()
