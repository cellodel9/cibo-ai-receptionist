const nodemailer = require("nodemailer");
const { RESTAURANT } = require("./restaurant-config");

function buildTransport() {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_APP_PASSWORD;

  if (!user || !pass) {
    console.warn(
      "[mailer] EMAIL_USER / EMAIL_APP_PASSWORD not set — messages will only be logged, not emailed."
    );
    return null;
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
}

const transporter = buildTransport();

/**
 * Sends a caller's message to the restaurant's inbox.
 * Falls back to console logging if email isn't configured, so the call
 * never fails just because email is missing.
 */
async function sendCallerMessage({ callerName, callbackNumber, reason }) {
  const timestamp = new Date().toLocaleString("en-US", { timeZone: process.env.TIMEZONE || "America/Chicago" });

  const subject = `[${RESTAURANT.name}] New phone message from ${callerName || "Unknown caller"}`;
  const body = [
    `New message taken by the AI receptionist for ${RESTAURANT.name}.`,
    "",
    `Time: ${timestamp}`,
    `Caller name: ${callerName || "(not given)"}`,
    `Callback number: ${callbackNumber || "(not given)"}`,
    `Reason: ${reason || "(not given)"}`,
  ].join("\n");

  console.log("[mailer] New message:\n" + body);

  if (!transporter) {
    return { delivered: false, reason: "email not configured" };
  }

  const recipient = process.env.MESSAGE_RECIPIENT_EMAIL || process.env.EMAIL_USER;

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: recipient,
      subject,
      text: body,
    });
    return { delivered: true };
  } catch (err) {
    console.error("[mailer] Failed to send email:", err.message);
    return { delivered: false, reason: err.message };
  }
}

module.exports = { sendCallerMessage };
