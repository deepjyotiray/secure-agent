"use strict"

const auth = require("../gateway/auth")

async function execute(_params, context, _toolConfig) {
    const { phone, rawMessage } = context
    const otpCandidate = (rawMessage || "").trim()

    if (/^\d{6}$/.test(otpCandidate) && auth.hasPendingOtp(phone)) {
        const result = auth.verifyOtp(phone, otpCandidate)
        if (result.success) return "✅ You are now logged in."
        if (result.reason === "otp_expired") return "OTP expired. Send 'login' to request a new one."
        return "Incorrect OTP. Please try again."
    }

    if (auth.isAuthorized(phone)) return "You are already logged in."

    const otp = auth.initiateLogin(phone)
    return `Your OTP is: ${otp}\nIt expires in 5 minutes. Reply with the 6-digit code to verify.`
}

module.exports = { execute }
