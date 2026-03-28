"use strict"

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
    console.log("\nCustomer Context Tests\n")

    const { projectCustomerProfileForTurn } = require("../runtime/customerContext")

    const projected = projectCustomerProfileForTurn({
        phone: "9594614752",
        dietaryPreferences: ["vegetarian"],
    }, "Share the menu", [
        { role: "customer", text: "Need high protein high spicy non veg" },
        { role: "customer", text: "Chicken" },
    ])

    assert("conflicting dietary memory is suppressed for the active turn", [
        ["projected profile exists", !!projected],
        ["vegetarian preference removed", Array.isArray(projected.dietaryPreferences) && projected.dietaryPreferences.length === 0],
    ])

    const unchanged = projectCustomerProfileForTurn({
        phone: "1111111111",
        dietaryPreferences: ["vegetarian"],
    }, "Show me veg dishes", [
        { role: "customer", text: "I am vegetarian" },
    ])

    assert("aligned dietary memory is preserved", [
        ["vegetarian preference kept", Array.isArray(unchanged.dietaryPreferences) && unchanged.dietaryPreferences.includes("vegetarian")],
    ])

    console.log(`\nPassed: ${passed}/${total}`)
    if (failed) process.exit(1)
}

main()
