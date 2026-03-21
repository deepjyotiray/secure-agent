"use strict"

/**
 * Menu RAG Test Suite
 * Covers: section queries, ingredient queries, cross-contamination, price filters,
 * veg/non-veg isolation, ambiguous queries, partial matches, description bleed,
 * subscription exclusion, empty results, natural language variations.
 */

const { retrieveContext } = require("../domain-packs/restaurant/tools/menuRag")
const DB = process.env.TEST_DB_PATH || "./data/orders.db"

let passed = 0, failed = 0, total = 0

function assert(label, r, checks) {
    total++
    const errors = []
    for (const [desc, ok] of checks) {
        if (!ok) errors.push(desc)
    }
    if (errors.length) {
        console.log(`  ❌ ${label}`)
        for (const e of errors) console.log(`       → FAIL: ${e}`)
        if (process.env.VERBOSE) console.log(`       RAW: ${r.slice(0, 300)}`)
        failed++
    } else {
        console.log(`  ✅ ${label}`)
        passed++
    }
}

async function run(query, filter = {}) {
    return await retrieveContext(query, DB, null, filter)
}

// Helper: extract all prices from result string
function prices(r) {
    return [...r.matchAll(/₹(\d+)/g)].map(m => parseInt(m[1]))
}

async function main() {
    console.log("\n🧪 Menu RAG — Comprehensive Test Suite\n")

    // ════════════════════════════════════════════════════════════════
    console.log("── Section isolation ───────────────────────────────────────")

    let r = await run("veg starters", { section: "Veg Starters" })
    assert("veg starters — exact section only", r, [
        ["has Mix Veg Starter Plate",               r.includes("Mix Veg Starter Plate")],
        ["has Veg Spring Roll Platter",             r.includes("Veg Spring Roll Platter")],
        ["has Paneer Chilli",                       r.includes("Paneer Chilli")],
        ["no Non-Veg Starters header",              !r.includes("Non-Veg Starters")],
        ["no Chicken Tandoori",                     !r.includes("Chicken Tandoori")],
        ["no Veg Main Course items",                !r.includes("Rajma Chawal")],
    ])

    r = await run("non veg starters", { section: "Non-Veg Starters" })
    assert("non-veg starters — exact section only", r, [
        ["has Chicken Tandoori",                    r.includes("Chicken Tandoori")],
        ["has Seekh Kabab",                         r.includes("Seekh Kabab")],
        ["no Veg Starters header",                  !r.includes("*Veg Starters*")],
        ["no Veg Spring Roll",                      !r.includes("Veg Spring Roll")],
        ["no Seafood items",                        !r.includes("Pomfret")],
    ])

    r = await run("seafood", { section: "Seafood Starters" })
    assert("seafood — exact section only", r, [
        ["has Pomfret rawa fry",                    r.includes("Pomfret rawa fry")],
        ["has Surmai fry",                          r.includes("Surmai fry")],
        ["has Bangda fry",                          r.includes("Bangda fry")],
        ["no Chicken items",                        !r.includes("Chicken")],
        ["no Non-Veg Main Course",                  !r.includes("Non-Veg Main Course")],
    ])

    r = await run("veg main course", { section: "Veg Main Course" })
    assert("veg main course — exact section only", r, [
        ["has Rajma Chawal",                        r.includes("Rajma Chawal")],
        ["has Matar Paneer",                        r.includes("Matar Paneer")],
        ["no Non-Veg items",                        !r.includes("🍗 Non-Veg")],
        ["no Veg Starters",                         !r.includes("Paneer Chilli")],
    ])

    r = await run("rice and breads", { section: "Rice & Breads" })
    assert("rice & breads — exact section only", r, [
        ["has Steamed Rice",                        r.includes("Steamed Rice")],
        ["has Chapati",                             r.includes("Chapati")],
        ["has Ghee Paratha",                        r.includes("Ghee Paratha")],
        ["no Rajma Chawal",                         !r.includes("Rajma Chawal")],
        ["no Dal Rice",                             !r.includes("Dal Rice")],
    ])

    r = await run("sweet dishes", { section: "Sweet Dishes and Sides" })
    assert("sweet dishes — exact section only", r, [
        ["has Kheer",                               r.includes("Kheer")],
        ["has Gulab Jamun",                         r.includes("Gulab Jamun")],
        ["has Sheera",                              r.includes("Sheera")],
        ["no Steamed Rice",                         !r.includes("Steamed Rice")],
        ["no main course items",                    !r.includes("Chicken")],
    ])

    // ════════════════════════════════════════════════════════════════
    console.log("\n── Cross-contamination (most dangerous) ────────────────────")

    // "veg" word must NOT pull non-veg items when section is set
    r = await run("veg biryani", { section: "Veg Main Course", query: "veg biryani" })
    assert("veg biryani — must NOT return Chicken Biryani or Mutton Biryani", r, [
        ["has Veg Biryani",                         r.includes("Veg Biryani")],
        ["no Chicken Biryani",                      !r.includes("Chicken Biryani")],
        ["no Mutton Biryani",                       !r.includes("Mutton Biryani")],
    ])

    // "chicken" in non-veg main must NOT pull chicken starters
    r = await run("chicken curry", { section: "Non-Veg Main Course", query: "chicken" })
    assert("chicken in non-veg main — no starters bleed", r, [
        ["has Chicken Masala",                      r.includes("Chicken Masala")],
        ["no Chicken Tandoori (starter)",           !r.includes("Chicken Tandoori")],
        ["no Chicken Kabab (starter)",              !r.includes("Chicken Kabab (5 pcs)")],
    ])

    // "paneer" must NOT return non-veg items
    r = await run("paneer", { query: "paneer" })
    assert("paneer query — zero non-veg items", r, [
        ["has Paneer Masala",                       r.includes("Paneer Masala")],
        ["has Matar Paneer",                        r.includes("Matar Paneer")],
        ["no Chicken",                              !r.includes("Chicken")],
        ["no Mutton",                               !r.includes("Mutton")],
        ["no Fish",                                 !r.includes("Fish")],
    ])

    // "masala" is ambiguous — appears in both veg and non-veg
    r = await run("masala", { query: "masala" })
    assert("masala — shows both veg and non-veg masala items", r, [
        ["has Paneer Masala",                       r.includes("Paneer Masala")],
        ["has Chicken Masala",                      r.includes("Chicken Masala")],
        ["has Chana Masala",                        r.includes("Chana Masala")],
        ["no subscription items",                   !r.includes("8800")],
    ])

    // "korma" appears in both mutton and chicken
    r = await run("korma", { query: "korma" })
    assert("korma — returns both Chicken Korma and Mutton Korma", r, [
        ["has Chicken Korma",                       r.includes("Chicken Korma")],
        ["has Mutton Korma",                        r.includes("Mutton Korma")],
        ["no unrelated items",                      !r.includes("Chicken Biryani")],
    ])

    // ════════════════════════════════════════════════════════════════
    console.log("\n── Description bleed (items matching only in description) ──")

    // "spinach" only in Aloo Palak description — should still return it
    r = await run("spinach", { query: "spinach" })
    assert("spinach — returns Aloo Palak via description", r, [
        ["has Aloo Palak",                          r.includes("Aloo Palak")],
        ["no unrelated items",                      !r.includes("Chicken Masala")],
    ])

    // "kidney beans" only in Rajma Chawal description
    r = await run("kidney beans", { query: "kidney beans" })
    assert("kidney beans — returns Rajma Chawal via description", r, [
        ["has Rajma Chawal",                        r.includes("Rajma Chawal")],
    ])

    // "rose milk" — Mohabbat ki Sharbat description contains "rose"
    r = await run("rose drink", { query: "rose" })
    assert("rose drink — returns Mohabbat ki Sharbat", r, [
        ["has Mohabbat ki Sharbat",                 r.includes("Mohabbat ki Sharbat")],
    ])

    // "kheer" contains "rice pudding" in description — must NOT appear in rice queries
    r = await run("rice", { section: "Rice & Breads" })
    assert("rice section query — Kheer must NOT appear", r, [
        ["has Steamed Rice",                        r.includes("Steamed Rice")],
        ["no Kheer",                                !r.includes("Kheer")],
    ])

    // ════════════════════════════════════════════════════════════════
    console.log("\n── Ambiguous single words ──────────────────────────────────")

    // "fry" appears in Chicken Fry (starter) and all seafood items
    r = await run("fry", { query: "fry" })
    assert("fry — returns fried items across sections", r, [
        ["has Chicken Fry",                         r.includes("Chicken Fry")],
        ["has Tawa fry special",                    r.includes("Tawa fry special")],
        ["has Surmai fry",                          r.includes("Surmai fry")],
        ["no Veg Biryani (unrelated)",              !r.includes("Veg Biryani")],
    ])

    // "thali" appears in both Veg Special Thali and Non-Veg Special Thali
    r = await run("thali", { query: "thali" })
    assert("thali — returns both veg and non-veg thali", r, [
        ["has Veg Special Thali",                   r.includes("Veg Special Thali")],
        ["has Non-Veg Special Thali",               r.includes("Non-Veg Special Thali")],
        ["no unrelated items",                      !r.includes("Chicken Masala")],
    ])

    // "kabab" vs "kebab" — both spellings exist in the menu
    r = await run("kabab", { query: "kabab" })
    assert("kabab spelling — returns kabab items", r, [
        ["has Chicken Kabab",                       r.includes("Kabab") || r.includes("Kebab")],
    ])

    // "aloo" — multiple dishes
    r = await run("aloo", { query: "aloo" })
    assert("aloo — returns all aloo dishes", r, [
        ["has Aloo Gobi",                           r.includes("Aloo Gobi")],
        ["has Aloo Palak",                          r.includes("Aloo Palak")],
        ["has Methi Aloo",                          r.includes("Methi Aloo")],
        ["has Aloo Bhindi",                         r.includes("Aloo Bhindi")],
        ["no non-veg items",                        !r.includes("🍗 Non-Veg")],
    ])

    // ════════════════════════════════════════════════════════════════
    console.log("\n── Price accuracy ──────────────────────────────────────────")

    // Prices must be exact — these were wrong before (350 vs 385)
    r = await run("brown rice", { query: "brown rice" })
    assert("brown rice — prices must be exactly ₹385", r, [
        ["has ₹385",                                r.includes("₹385")],
        ["no ₹350 (old wrong price)",               !r.includes("₹350")],
        ["no ₹8800 (subscription)",                 !r.includes("₹8800")],
    ])

    r = await run("items under 150", { max_price: 150 })
    assert("max_price 150 — no item above ₹150", r, [
        ["has items",                               r.includes("₹")],
        ["no price above 150",                      !prices(r).some(p => p > 150)],
    ])

    r = await run("items under 50", { max_price: 50 })
    assert("max_price 50 — only cheap items", r, [
        ["has Chapati ₹10",                         r.includes("₹10")],
        ["has Steamed Rice ₹35",                    r.includes("₹35")],
        ["no price above 50",                       !prices(r).some(p => p > 50)],
    ])

    r = await run("cheap veg options", { veg: true, max_price: 100 })
    assert("veg + max_price 100 — only cheap veg items", r, [
        ["all items are veg",                       !r.includes("🍗 Non-Veg")],
        ["no price above 100",                      !prices(r).some(p => p > 100)],
    ])

    // ════════════════════════════════════════════════════════════════
    console.log("\n── Subscription exclusion ──────────────────────────────────")

    r = await run("healthy salads", { section: "Healthy Salads" })
    assert("healthy salads section — no subscription items", r, [
        ["has Chicken with Brown Rice",             r.includes("Brown Rice, Broccoli")],
        ["has Paneer with Brown Rice",              r.includes("Paneer with Brown Rice")],
        ["no ₹8800",                               !r.includes("8800")],
        ["no ₹7700",                               !r.includes("7700")],
        ["no ₹9900",                               !r.includes("9900")],
        ["no '30 Healthy Salads' header",           !r.includes("30 Healthy Salads")],
    ])

    r = await run("show full menu", {})
    assert("full menu — zero subscription items anywhere", r, [
        ["no ₹8800",                               !r.includes("8800")],
        ["no ₹7700",                               !r.includes("7700")],
        ["no ₹9900",                               !r.includes("9900")],
        ["no 30 Healthy Salads",                   !r.includes("30 Healthy Salads")],
    ])

    // ════════════════════════════════════════════════════════════════
    console.log("\n── Veg / Non-veg strict isolation ──────────────────────────")

    r = await run("veg options", { veg: true })
    assert("veg:true — zero non-veg items in entire result", r, [
        ["has veg items",                           r.includes("🟢 Veg")],
        ["zero non-veg items",                      !r.includes("🍗 Non-Veg")],
        ["no subscription",                         !r.includes("7700")],
    ])

    r = await run("non veg options", { veg: false })
    assert("veg:false — zero veg items in entire result", r, [
        ["has non-veg items",                       r.includes("🍗 Non-Veg")],
        ["zero veg items",                          !r.includes("🟢 Veg")],
    ])

    // veg:true + section should still be veg-only
    r = await run("veg starters only", { section: "Veg Starters", veg: true })
    assert("veg:true + section — still veg only", r, [
        ["has Paneer Chilli",                       r.includes("Paneer Chilli")],
        ["zero non-veg",                            !r.includes("🍗 Non-Veg")],
    ])

    // ════════════════════════════════════════════════════════════════
    console.log("\n── Natural language variations ─────────────────────────────")

    r = await run("do you have brown rice", { query: "brown rice" })
    assert("natural: do you have brown rice", r, [
        ["has brown rice items",                    r.includes("Brown Rice")],
        ["correct price ₹385",                      r.includes("₹385")],
        ["no subscription",                         !r.includes("8800")],
    ])

    r = await run("anything in mutton", { section: "Non-Veg Main Course", query: "mutton" })
    assert("natural: anything in mutton", r, [
        ["has Mutton Biryani",                      r.includes("Mutton Biryani")],
        ["has Mutton Korma",                        r.includes("Mutton Korma")],
        ["has Mutton Curry",                        r.includes("Mutton Curry")],
        ["no Chicken Masala",                       !r.includes("Chicken Masala")],
        ["no Fish Curry",                           !r.includes("Fish Curry")],
    ])

    r = await run("what fish do you have", { section: "Seafood Starters", query: "fish" })
    assert("natural: what fish do you have", r, [
        ["has seafood items",                       r.includes("fry") || r.includes("Pomfret")],
        ["no Chicken",                              !r.includes("Chicken")],
    ])

    r = await run("show me something sweet", { section: "Sweet Dishes and Sides" })
    assert("natural: show me something sweet", r, [
        ["has Kheer",                               r.includes("Kheer")],
        ["has Gulab Jamun",                         r.includes("Gulab Jamun")],
        ["no main course",                          !r.includes("Chicken Masala")],
    ])

    r = await run("I want egg", { query: "egg" })
    assert("natural: I want egg", r, [
        ["has Egg Curry",                           r.includes("Egg Curry")],
        ["no unrelated items",                      !r.includes("Veg Biryani")],
    ])

    // ════════════════════════════════════════════════════════════════
    console.log("\n── Edge cases & no-match safety ────────────────────────────")

    r = await run("pizza burger pasta", { query: "pizza burger pasta" })
    assert("completely off-menu query — graceful no-match", r, [
        ["returns no-match message",                r.toLowerCase().includes("sorry") || r.toLowerCase().includes("nothing")],
        ["no menu items leaked",                    !r.includes("₹")],
    ])

    r = await run("", {})
    assert("empty query — returns menu not error", r, [
        ["has some content",                        r.length > 10],
        ["no crash / undefined",                    !r.includes("undefined") && !r.includes("null")],
    ])

    r = await run("chicken", { section: "Veg Starters", query: "chicken" })
    assert("chicken query in Veg Starters section — no results (no chicken in veg starters)", r, [
        ["no Chicken items",                        !r.includes("Chicken Tandoori") && !r.includes("Chicken Masala")],
    ])

    r = await run("mutton biryani price", { query: "mutton biryani" })
    assert("mutton biryani — correct price shown", r, [
        ["has Mutton Biryani",                      r.includes("Mutton Biryani")],
        ["has ₹165",                                r.includes("₹165")],
    ])

    // Partial name match — "paneer tikka" not a standalone item but in Mix Veg description
    r = await run("paneer tikka", { query: "paneer tikka" })
    assert("paneer tikka — returns Mix Veg Starter Plate (contains paneer tikka)", r, [
        ["has Mix Veg Starter Plate",               r.includes("Mix Veg Starter Plate")],
        ["no non-veg items",                        !r.includes("🍗 Non-Veg")],
    ])

    // "dal" — multiple dal items, all veg
    r = await run("dal", { query: "dal" })
    assert("dal — returns all dal items, all veg", r, [
        ["has Dal Rice",                            r.includes("Dal Rice")],
        ["has Dal Tadka",                           r.includes("Dal Tadka")],
        ["no non-veg items",                        !r.includes("🍗 Non-Veg")],
    ])

    // ════════════════════════════════════════════════════════════════
    const pct = Math.round((passed / total) * 100)
    console.log(`\n${"═".repeat(50)}`)
    console.log(`  Total: ${total} | ✅ ${passed} passed | ❌ ${failed} failed | ${pct}%`)
    if (failed > 0) process.exit(1)
}

main().catch(err => { console.error(err); process.exit(1) })
