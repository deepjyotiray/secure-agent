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

function loadOrderCreateWithStubs({ existingUser = null } = {}) {
    const root = path.resolve(__dirname, "..")
    const setStub = (target, exports, options = {}) => {
        const fullPath = options.module
            ? require.resolve(target)
            : path.join(root, target)
        require.cache[require.resolve(fullPath)] = {
            id: fullPath,
            filename: fullPath,
            loaded: true,
            exports,
        }
    }

    const sessions = new Map()

    setStub("tools/cartStore.js", {
        get(key) { return sessions.get(key) || null },
        set(key, value) { sessions.set(key, value) },
        update(key, patch) { sessions.set(key, { ...(sessions.get(key) || {}), ...patch }) },
        clear(key) { sessions.delete(key) },
    })
    setStub("config/settings.json", {
        api: { secret: "x", port: 9999 },
    })
    setStub("node-fetch", async () => ({ json: async () => ({ success: true, user: { name: "Boss", address: "Somewhere" } }) }), { module: true })
    setStub("better-sqlite3", function Database() {
        return {
            pragma() {},
            close() {},
            prepare(sql) {
                return {
                    get() {
                        if (/SELECT \* FROM users/i.test(sql)) return existingUser
                        return null
                    },
                    all() {
                        if (/FROM menu_sections/i.test(sql)) return [{ id: 1, title: "Veg Main Course" }]
                        if (/FROM menu_items/i.test(sql)) return []
                        return []
                    },
                }
            },
        }
    }, { module: true })

    const target = path.join(root, "domain-packs/restaurant/tools/orderCreate.js")
    delete require.cache[require.resolve(target)]
    return {
        orderCreate: require(target),
        sessions,
    }
}

async function main() {
    console.log("\nOrder Selection Tests\n")

    {
        const { orderCreate, sessions } = loadOrderCreateWithStubs({
            existingUser: { name: "Boss", address: "MG Road" },
        })
        const response = await orderCreate.execute({}, {
            phone: "+919999999999",
            rawMessage: "add all these items to my cart",
            conversationState: {
                selection: {
                    label: "Veg Main Course",
                    items: [
                        { name: "Veg Special Thali", price: 165 },
                        { name: "Rajma Chawal", price: 110 },
                    ],
                },
                pending: { kind: "selection_order" },
            },
        }, {
            db_path: "/tmp/test.db",
            backend_url: "http://localhost:9999",
        })

        const cart = sessions.get("+919999999999")
        assert("selection order initializes populated cart", [
            ["confirmation returned", /Added all items from \*Veg Main Course\*/.test(response)],
            ["cart created", !!cart],
            ["state moved to add more", cart && cart.state === "order_add_more"],
            ["two items stored", cart && cart.items.length === 2],
        ])
    }

    {
        const { orderCreate, sessions } = loadOrderCreateWithStubs({
            existingUser: null,
        })
        const response = await orderCreate.execute({}, {
            phone: "+919111111111",
            rawMessage: "all veg main course",
            conversationState: {
                selection: {
                    label: "Veg Main Course",
                    items: [
                        { name: "Veg Special Thali", price: 165 },
                        { name: "Rajma Chawal", price: 110 },
                    ],
                },
                pending: { kind: "selection_order" },
            },
        }, {
            db_path: "/tmp/test.db",
            backend_url: "http://localhost:9999",
        })

        const cart = sessions.get("+919111111111")
        assert("selection order can resume after registration", [
            ["asks for name", /full name/i.test(response)],
            ["registration state used", cart && cart.state === "registering_name"],
            ["pending items stored", cart && cart.items.length === 2],
        ])
    }

    console.log(`\nPassed: ${passed}/${total}`)
    if (failed) process.exit(1)
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})
