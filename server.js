require("dotenv/config");
const express = require("express");
const WebSocket = require("ws");
const OpenAI = require("openai");
const { SYSTEM_INSTRUCTIONS, GREETING } = require("./restaurant-config");
const { sendCallerMessage } = require("./mailer");

const PORT = Number(process.env.PORT || 8000);
const WEBHOOK_SECRET = process.env.OPENAI_WEBHOOK_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.REALTIME_MODEL || "gpt-realtime";
const VOICE = process.env.REALTIME_VOICE || "coral";

if (!WEBHOOK_SECRET || !OPENAI_API_KEY) {
  console.error("Missing OPENAI_WEBHOOK_SECRET or OPENAI_API_KEY in your .env file.");
  process.exit(1);
}

const client = new OpenAI({ apiKey: OPENAI_API_KEY });

// Tool definition the model can call when it needs to take a message
// instead of answering directly.
const TAKE_MESSAGE_TOOL = {
  type: "function",
  name: "take_message",
  description:
    "Record a message from the caller when you can't answer their question yourself " +
    "(out-of-scope topics, complaints, requests to speak to a manager, reservations, etc.). " +
    "Always collect a caller name and callback number before calling this.",
  parameters: {
    type: "object",
    properties: {
      caller_name: { type: "string", description: "The caller's name, or 'unknown' if they wouldn't give one." },
      callback_number: { type: "string", description: "A phone number to call them back on, or 'unknown'." },
      reason: { type: "string", description: "Brief summary of what the caller needs." },
    },
    required: ["caller_name", "callback_number", "reason"],
  },
};

// Config sent to OpenAI when accepting the call. This defines the entire
// voice session: which model, which voice, what the assistant knows, and
// what tools (functions) it can call.
const callAccept = {
  type: "realtime",
  model: MODEL,
  instructions: SYSTEM_INSTRUCTIONS,
  audio: {
    output: { voice: VOICE },
    input: {
      // Noise reduction tuned for a phone line picking up restaurant
      // background noise (not a close-talking headset mic).
      noise_reduction: { type: "far_field" },
      turn_detection: {
        type: "server_vad",
        // Higher threshold = needs louder/clearer speech to trigger,
        // so it's less likely to react to background noise.
        threshold: 0.65,
        prefix_padding_ms: 300,
        // Waits a bit longer of silence before deciding the caller is
        // done talking, so it's less trigger-happy on brief noise gaps.
        silence_duration_ms: 650,
      },
    },
  },
  tools: [TAKE_MESSAGE_TOOL],
};

const RealtimeIncomingCall = "realtime.call.incoming";

/**
 * Opens the control WebSocket for an accepted call, sends the opening
 * greeting, and handles any function calls (like take_message) that come
 * back from the model during the conversation.
 */
async function handleCallSession(callId) {
  const wssUrl = `wss://api.openai.com/v1/realtime?call_id=${callId}`;

  const ws = new WebSocket(wssUrl, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      origin: "https://api.openai.com",
    },
  });

  ws.on("open", () => {
    console.log(`[call ${callId}] session connected`);
    ws.send(
      JSON.stringify({
        type: "response.create",
        response: { instructions: `Say to the caller: ${GREETING}` },
      })
    );
  });

  ws.on("message", async (data) => {
    let event;
    try {
      event = JSON.parse(data.toString("utf8"));
    } catch {
      return;
    }

    if (event.type === "error") {
      console.error(`[call ${callId}] realtime error:`, JSON.stringify(event));
      return;
    }

    // The model finished producing arguments for a function call.
    if (event.type === "response.function_call_arguments.done") {
      const { name, call_id, arguments: argsJson } = event;

      if (name === "take_message") {
        let args = {};
        try {
          args = JSON.parse(argsJson);
        } catch (err) {
          console.error(`[call ${callId}] failed to parse function args:`, err.message);
        }

        const result = await sendCallerMessage({
          callerName: args.caller_name,
          callbackNumber: args.callback_number,
          reason: args.reason,
        });

        // Send the function result back so the model can continue talking.
        ws.send(
          JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id,
              output: JSON.stringify({
                success: result.delivered,
                note: result.delivered
                  ? "Message delivered to the restaurant."
                  : "Message logged, but email delivery was not confirmed.",
              }),
            },
          })
        );

        // Ask the model to keep talking now that the function has returned.
        ws.send(JSON.stringify({ type: "response.create" }));
      }
    }
  });

  ws.on("error", (err) => {
    console.error(`[call ${callId}] websocket error:`, err.message);
  });

  ws.on("close", (code, reason) => {
    console.log(`[call ${callId}] session closed`, code, reason?.toString?.());
  });
}

const app = express();
// OpenAI's webhook signature check needs the exact raw request bytes.
app.use(express.raw({ type: "*/*" }));

app.post("/", async (req, res) => {
  try {
    const event = await client.webhooks.unwrap(
      req.body.toString("utf8"),
      req.headers,
      WEBHOOK_SECRET
    );

    if (event.type !== RealtimeIncomingCall) {
      return res.sendStatus(200);
    }

    const callId = event.data.call_id;
    console.log(`[call ${callId}] incoming call, accepting...`);

    const acceptResp = await fetch(
      `https://api.openai.com/v1/realtime/calls/${encodeURIComponent(callId)}/accept`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(callAccept),
      }
    );

    if (!acceptResp.ok) {
      const text = await acceptResp.text().catch(() => "");
      console.error("[call] accept failed:", acceptResp.status, acceptResp.statusText, text);
      return res.status(500).send("Accept failed");
    }

    handleCallSession(callId).catch((err) =>
      console.error(`[call ${callId}] session error:`, err.message)
    );

    return res.sendStatus(200);
  } catch (err) {
    const msg = String(err && err.message ? err.message : "");
    if (err && err.name === "InvalidWebhookSignatureError" || msg.toLowerCase().includes("invalid signature")) {
      return res.status(400).send("Invalid signature");
    }
    console.error("Webhook handling error:", msg);
    return res.status(500).send("Server error");
  }
});

app.get("/", (_req, res) => {
  res.send("Cibo Italia AI receptionist is running.");
});

app.listen(PORT, () => {
  console.log(`Cibo Italia AI receptionist listening on port ${PORT}`);
});
