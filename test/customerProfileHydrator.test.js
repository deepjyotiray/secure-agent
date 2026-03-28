"use strict"

const fs = require("fs")
const path = require("path")
const Database = require("better-sqlite3")

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

function createDb(dbPath, setup) {
    try { fs.unlinkSync(dbPath) } catch {}
    const db = new Database(dbPath)
    try {
        setup(db)
    } finally {
        db.close()
    }
}

function main() {
    console.log("\nCustomer Profile Hydrator Tests\n")

    const { hydrateCustomerProfile, clearHydratedCustomerProfileCache } = require("../runtime/customerProfileHydrator")
    const dbPath = path.join(__dirname, "..", "tmp", "customer-profile-test.db")
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })

    createDb(dbPath, db => {
        db.exec(`
            CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                name TEXT,
                mobile TEXT,
                address TEXT,
                email TEXT
            );
        `)
        db.prepare("INSERT INTO users (name, mobile, address, email) VALUES (?, ?, ?, ?)").run(
            "Riya Sharma",
            "+91 9876543210",
            "12 MG Road",
            "riya@example.com"
        )
    })
    clearHydratedCustomerProfileCache()
    const userProfile = hydrateCustomerProfile({
        workspaceId: "test-hydrator",
        phone: "9876543210",
        dbPath,
    })

    assert("hydrates canonical profile fields from users table", [
        ["name loaded", userProfile.name === "Riya Sharma"],
        ["address loaded", userProfile.address === "12 MG Road"],
        ["email loaded", userProfile.email === "riya@example.com"],
        ["phone normalized", userProfile.phone === "9876543210"],
    ])

    createDb(dbPath, db => {
        db.exec(`
            CREATE TABLE orders (
                id TEXT PRIMARY KEY,
                customer TEXT,
                phone TEXT,
                delivery_address TEXT
            );
        `)
        db.prepare("INSERT INTO orders (id, customer, phone, delivery_address) VALUES (?, ?, ?, ?)").run(
            "ORD-9",
            "Aman",
            "9876543210",
            "44 Park Street"
        )
    })
    clearHydratedCustomerProfileCache()
    const orderProfile = hydrateCustomerProfile({
        workspaceId: "test-hydrator",
        phone: "+91 9876543210",
        dbPath,
    })

    assert("falls back to recent orders when users table is unavailable", [
        ["order customer loaded", orderProfile.name === "Aman"],
        ["order address loaded", orderProfile.address === "44 Park Street"],
        ["last order id loaded", orderProfile.lastOrderId === "ORD-9"],
    ])

    try { fs.unlinkSync(dbPath) } catch {}

    console.log(`\nPassed: ${passed}/${total}`)
    if (failed) process.exit(1)
}

main()
