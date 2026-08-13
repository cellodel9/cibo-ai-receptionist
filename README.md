# Cibo Italia — AI Phone Receptionist

When someone calls your restaurant's phone number, this answers, greets them, and can talk
about your hours, location, and general questions. If it doesn't know the answer (delivery,
dietary/allergen questions, dress code, wanting a manager, reservations, etc.), it takes down
their name and number and emails it to you.

It's built on two services working together:

- **Twilio** — routes phone calls to a number you own
- **OpenAI's Realtime API** — the actual voice AI that talks to callers

Nothing here requires prior coding experience — just follow the steps in order. It'll take
roughly 30–45 minutes the first time.

---

## Part 1 — Create accounts

### 1. OpenAI account + API key

1. Go to https://platform.openai.com/ and sign up (or log in).
2. You'll need billing set up (Settings → Billing) — the Realtime API is pay-as-you-go per
   minute of call audio, not a flat subscription.
3. Go to **API keys** (left sidebar) → **Create new secret key**. Copy it somewhere safe —
   you'll paste it into `.env` as `OPENAI_API_KEY` in Part 3.
4. Note your **Project ID**: go to **Settings → General**, the project ID is shown on that
   page (looks like `proj_XXXXXXXXXXXX`). You'll need this in Part 2.

### 2. Twilio account + phone number

1. Go to https://www.twilio.com/try-twilio and sign up.
2. In the Twilio Console, go to **Phone Numbers → Buy a number**. Search for a local number
   with **Voice** capability and buy it (a few dollars/month). This becomes your restaurant's
   AI-answered number.

### 3. Gmail App Password (so the server can email you messages)

Your normal Gmail password won't work for this — Google requires a separate "App Password"
for apps that send mail on your behalf.

1. Go to https://myaccount.google.com/security
2. Turn on **2-Step Verification** if it isn't already on (required for App Passwords).
3. Go to https://myaccount.google.com/apppasswords
4. Create a new app password (name it something like "Cibo AI Receptionist"). Copy the
   16-character password shown — you'll paste it into `.env` as `EMAIL_APP_PASSWORD`.

---

## Part 2 — Connect Twilio to OpenAI

This tells Twilio: "when this number rings, send the call to OpenAI's AI instead of a phone."

### Step A: Register a webhook in OpenAI

1. Go to https://platform.openai.com/settings/ → **Webhooks** → **Create webhook**.
2. Name it anything, e.g. "Cibo receptionist."
3. **URL**: you won't have this until after you deploy the server in Part 3 — you can come
   back and fill this in once you have your live server URL.
4. **Event type**: `realtime.call.incoming`
5. Save it, then copy the **Webhook secret** shown (starts with `whsec_`) — you'll need it in
   `.env` as `OPENAI_WEBHOOK_SECRET`.

### Step B: Create a SIP Trunk in Twilio

1. In Twilio Console, go to **Voice → SIP Trunks** → click **+** to create a new trunk.
2. Name it e.g. "OpenAI Routing."
3. Inside the trunk, go to **Origination** → **Add Origination URI**.
4. Set the URI to:
   ```
   sip:YOUR_PROJECT_ID@sip.api.openai.com;transport=tls
   ```
   Replacing `YOUR_PROJECT_ID` with the project ID you copied in Part 1.
5. Go to **Phone Numbers** (within the trunk settings) → **Add Phone Number** → select the
   number you bought in Part 1.

That's it on the Twilio side — from now on, calls to that number will ring OpenAI directly.

---

## Part 3 — Deploy the server

This small server is what OpenAI calls (via the webhook) the moment a call comes in — it tells
OpenAI to answer the call using Cibo Italia's info, and it emails you any messages the AI takes.

The easiest free option is **Render**. These steps assume you're starting from this folder.

### 1. Put this folder in its own GitHub repo

1. Create a free GitHub account at https://github.com if you don't have one.
2. Create a new empty repository (e.g. `cibo-ai-receptionist`).
3. Upload the contents of this folder to that repository (GitHub's web uploader works fine —
   drag and drop all the files except `.env`, which doesn't exist yet).

### 2. Deploy on Render

1. Go to https://render.com and sign up (free), then connect your GitHub account.
2. Click **New → Web Service**, select your `cibo-ai-receptionist` repo.
3. Settings:
   - **Runtime**: Node
   - **Build command**: `npm install`
   - **Start command**: `npm start`
   - **Instance type**: Free is fine to test; consider a paid tier for production so the
     server doesn't spin down between calls.
4. Under **Environment**, add each variable from `.env.example` with your real values:
   - `OPENAI_API_KEY`
   - `OPENAI_WEBHOOK_SECRET`
   - `EMAIL_USER`
   - `EMAIL_APP_PASSWORD`
   - `MESSAGE_RECIPIENT_EMAIL` (defaults to marcellodelpietro5@gmail.com — change if needed)
   - `TIMEZONE` (optional, defaults to America/Chicago)
5. Click **Create Web Service**. Once deployed, Render gives you a URL like
   `https://cibo-ai-receptionist.onrender.com`.

### 3. Finish the webhook setup

Go back to the OpenAI webhook you created in Part 2, Step A, and set its **URL** to your
Render URL (just the root, e.g. `https://cibo-ai-receptionist.onrender.com`). Save it.

---

## Part 4 — Test it

Call the Twilio number you bought. You should hear:

> "Thanks for calling Cibo Italia! I'm the automated assistant — how can I help you today?"

Try asking about hours, or ask something out of scope (like delivery) and confirm it offers to
take a message. Check your inbox (`MESSAGE_RECIPIENT_EMAIL`) for the message email.

You can also check the **Logs** tab in Render to see real-time server activity and catch
errors.

---

## Editing what the AI knows or says

Open `restaurant-config.js` — hours, address, and instructions are all plain text in there.
Edit it, save, and redeploy (Render redeploys automatically when you push changes to GitHub).
No other files need to change for content updates.

## Troubleshooting

- **Call rings but nothing happens / goes to voicemail**: double-check the SIP Origination
  URI in Twilio matches your OpenAI project ID exactly, and that the webhook URL in OpenAI
  points at your live Render URL (not localhost).
- **"Invalid signature" errors in logs**: `OPENAI_WEBHOOK_SECRET` in Render doesn't match the
  one shown on the OpenAI webhook page — copy it again.
- **"Accept failed" in logs**: usually a bad or expired `OPENAI_API_KEY`, or billing not set
  up on the OpenAI account.
- **Messages aren't arriving by email**: confirm `EMAIL_APP_PASSWORD` is an App Password (16
  characters, no spaces when pasted), not your regular Gmail password, and that 2-Step
  Verification is on for that Gmail account. Messages still get logged in Render's Logs tab
  even if email fails.

## Costs to expect

- Twilio phone number: a few dollars/month
- OpenAI Realtime API: billed per minute of call audio (check current pricing at
  https://platform.openai.com/docs/pricing before going live)
- Render: free tier works for testing; paid tier (~$7/month) recommended for production so the
  server responds instantly instead of waking up from sleep
