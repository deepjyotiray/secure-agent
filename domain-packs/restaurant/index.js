"use strict"

const menuRag           = require("./tools/menuRag")
const orderLookup       = require("./tools/orderLookup")
const orderCreate       = require("./tools/orderCreate")
const restaurantSupport = require("./tools/restaurantSupport")
const adminTools        = require("./admin-tools")

module.exports = {
    name: "restaurant",
    domain: "food",
    version: "1.0.0",
    description: "Restaurant / food-delivery domain pack",

    // tool type name → handler module (each exports execute())
    toolTypes: {
        menu_rag:           menuRag,
        order_lookup:       orderLookup,
        order_create:       orderCreate,
        restaurant_support: restaurantSupport,
    },

    // heuristic keywords for customerRouter
    heuristics: {
        menu:    ["menu", "dish", "dishes", "food", "eat", "hungry", "price", "veg", "nonveg", "non-veg", "thali", "biryani", "combo", "calorie", "calories", "protein", "fat", "carb", "carbs", "nutrition", "healthy", "low cal", "high protein", "keto", "diet"],
        order:   ["order", "buy", "cart", "checkout", "place order", "add"],
        support: ["help", "support", "complaint", "refund", "wrong", "missing", "late", "cancel"],
    },

    // filter schema for intentParser
    filterSchema: {
        veg:         { type: "boolean", description: "true = vegetarian only" },
        max_price:   { type: "number",  description: "maximum price" },
        max_calories:{ type: "number",  description: "maximum calories" },
        min_protein: { type: "number",  description: "minimum protein in grams" },
        max_fat:     { type: "number",  description: "maximum fat in grams" },
    },

    filterExamples: [
        { input: "show me veg items under 200", output: { veg: true, max_price: 200 } },
        { input: "high protein meals",          output: { min_protein: 20 } },
    ],

    // admin tool definitions (OpenAI function-calling format)
    adminToolDefinitions: adminTools.toolDefinitions,

    // admin tool dispatcher — returns result string or null if not handled
    dispatchAdminTool: adminTools.dispatch,

    // admin context builder — restaurant-specific business summary
    buildAdminContext: adminTools.buildAdminContext,

    // vision prompt and handler for admin image processing
    visionPrompt: adminTools.visionPrompt,
    insertVisionEntries: adminTools.insertVisionEntries,

    // session routing config
    sessionRouting: {
        activeCartIntent: "place_order",
    },
}
