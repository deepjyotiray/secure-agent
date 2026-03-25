"use strict"

const { retrieveContext: retrieveLanceContext } = require("../../../rag")
const { generateResponse } = require("../../../gateway/responder")

async function retrieveContext(query = "", dbPath, vectordbPath, filter = {}) {
    return await retrieveLanceContext(query, { type: "menu" })
}

// tool handler interface — called by executor when type is "menu_rag"
async function execute(filter, context, toolConfig) {
    const query = context.resolvedRequest?.effectiveMessage || context.rawMessage || ""
    const effectiveFilter = context.resolvedRequest?.appliedFilters || filter
    const data  = await retrieveContext(query, toolConfig.db_path, null, effectiveFilter)
    
    // Also include coupons if user asks for them
    if (query.toLowerCase().match(/coupon|discount|offer|promo/)) {
        const coupons = await retrieveLanceContext(query, { type: "coupons" })
        return await generateResponse(query, data + "\n\n" + coupons, toolConfig.system_prompt, { history: context.history })
    }

    return await generateResponse(query, data, toolConfig.system_prompt, { history: context.history })
}

module.exports = { retrieveContext, execute }
