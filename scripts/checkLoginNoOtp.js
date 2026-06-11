import fs from "node:fs";

const source = fs.readFileSync("src/pages/AuthPage.jsx", "utf8");
const start = source.indexOf("const handleEmailLogin = async");
const end = source.indexOf("  const handleGoogleLogin", start);

if (start === -1 || end === -1) {
  throw new Error("Could not locate handleEmailLogin in AuthPage.jsx");
}

const handleEmailLogin = source.slice(start, end);
const forbiddenPatterns = [
  ["sendOTP(", "login flow must not send OTP"],
  ["setShowOTPVerification(true)", "login flow must not show OTP verification"],
  ["signOut(auth)", "login flow must not sign out after credential validation"],
  ["pendingAuth", "login flow must not store pending auth state"],
];

const failures = forbiddenPatterns
  .filter(([pattern]) => handleEmailLogin.includes(pattern))
  .map(([, message]) => message);

if (failures.length > 0) {
  throw new Error(`Email login still depends on OTP:\n- ${failures.join("\n- ")}`);
}

console.log("Email login does not require OTP.");
