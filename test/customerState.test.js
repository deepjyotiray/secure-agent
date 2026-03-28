"use strict"

const fs = require("fs")
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

async function main() {
    console.log("\nCustomer State Tests\n")

    const { workspacePath } = require("../core/workspace")
    const {
        memoryPath,
        getCustomerProfile,
        saveCustomerProfile,
        extractCustomerProfilePatch,
    } = require("../runtime/customerMemory")
    const {
        parseMenuSelection,
        resolveSelectionOrderIntent,
        resolvePendingClarification,
        buildActiveCustomerState,
    } = require("../runtime/customerState")

    const workspaceId = "test-customer-state"
    const storePath = memoryPath(workspaceId)
    try { fs.unlinkSync(storePath) } catch {}

    const patch = extractCustomerProfilePatch("call me Boss")
    assert("extract preferred name", [
        ["preferred name extracted", patch && patch.preferredName === "Boss"],
    ])

    const explicitDiet = extractCustomerProfilePatch("I am vegetarian")
    const implicitDiet = extractCustomerProfilePatch("show me non veg high protein spicy dishes")
    assert("only explicit dietary statements are stored", [
        ["explicit vegetarian captured", explicitDiet && explicitDiet.dietaryPreferences.includes("vegetarian")],
        ["non-veg menu query not stored as preference", implicitDiet === null],
    ])

    const saved = saveCustomerProfile(workspaceId, "+91 9876543210", {
        preferredName: "Boss",
        dietaryPreferences: ["vegetarian"],
    })
    const loaded = getCustomerProfile(workspaceId, "9876543210")
    assert("persist customer profile", [
        ["saved name available", saved.preferredName === "Boss"],
        ["loaded preferred name available", loaded.preferredName === "Boss"],
        ["dietary preference saved", loaded.dietaryPreferences.includes("vegetarian")],
        ["store file created", fs.existsSync(storePath)],
    ])

    const mergedState = buildActiveCustomerState({
        workspaceId,
        phone: "9876543210",
        message: "show me menu",
        conversationState: {
            customerProfile: {
                dietaryPreferences: ["vegetarian", "jain"],
            },
        },
        hydratedProfile: {
            name: "Riya Sharma",
            address: "12 MG Road",
        },
    })
    assert("build active customer state merges hydrated db profile with memory", [
        ["db name available", mergedState.customerProfile.name === "Riya Sharma"],
        ["memory preferred name preserved", mergedState.customerProfile.preferredName === "Boss"],
        ["db address available", mergedState.customerProfile.address === "12 MG Road"],
        ["conversation state preferences preserved", Array.isArray(mergedState.customerProfile.dietaryPreferences) && mergedState.customerProfile.dietaryPreferences.includes("jain")],
    ])

    const selection = parseMenuSelection(`Veg Main Course:

- Veg Special Thali — ₹165
- Rajma Chawal — ₹110
- Veg Biryani — ₹130`)
    assert("parse menu selection", [
        ["selection parsed", !!selection],
        ["label captured", selection && selection.label === "Veg Main Course"],
        ["items captured", selection && selection.items.length === 3],
    ])

    const orderIntent = resolveSelectionOrderIntent("add all these items to my cart", {
        selection,
        pending: { kind: "selection_order", allowFollowUp: true },
    })
    assert("selection add-all routes to place order", [
        ["intent override returned", orderIntent && orderIntent.intentOverride === "place_order"],
        ["policy bypass enabled", orderIntent && orderIntent.bypassPreRoutePolicy === true],
    ])

    const pendingFollowUp = resolvePendingClarification("High spicy.", {
        pending: { kind: "clarification", intent: "general_chat", prompt: "Tell me which spicy chicken items you want.", allowFollowUp: true },
        lastIntent: "general_chat",
    })
    assert("short replies can continue pending clarification", [
        ["pending clarification resolved", !!pendingFollowUp],
        ["follow-up message is enriched with prompt context", pendingFollowUp && /Customer follow-up: High spicy\./.test(pendingFollowUp.message)],
        ["policy bypass enabled", pendingFollowUp && pendingFollowUp.bypassPreRoutePolicy === true],
    ])

    try { fs.unlinkSync(storePath) } catch {}
    const configDir = path.dirname(workspacePath(workspaceId, "config/placeholder"))
    try { fs.rmSync(configDir, { recursive: true, force: true }) } catch {}

    console.log(`\nPassed: ${passed}/${total}`)
    if (failed) process.exit(1)
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})
