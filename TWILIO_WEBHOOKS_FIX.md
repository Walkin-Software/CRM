# Twilio Webhook Setup - Quick Start

## The Problem
Twilio was getting 404 errors trying to reach the webhook endpoints. This was caused by:
1. ❌ Webhook URLs missing `/api` prefix
2. ❌ Twilio needs a public URL (ngrok tunnel)

## The Fix
✅ Webhook URLs corrected to include `/api` prefix:
- `/api/calls/webhooks/twilio/status`
- `/api/calls/webhooks/twilio/recording`
- `/api/calls/webhooks/twilio/conversation`

## What To Do Now

### Terminal 1: Start Backend with HTTPS
```bash
cd /Users/ifocus/Documents/kill/backend
pkill -f "uvicorn" || true  # Kill any existing process
./run_backend.sh
```

Backend will run on: **https://localhost:3003**

### Terminal 2: Start ngrok Tunnel
```bash
ngrok http https://localhost:3003
```

This will show output like:
```
Session Status                online
Account                       ...
Version                       ...
Region                        us
Latency                       ...
Web Interface                 http://127.0.0.1:4040
Forwarding                    https://XXXX-XXXX-XXXX.ngrok.io -> https://localhost:3003
```

**Copy the forwarding URL** (e.g., `https://XXXX-XXXX-XXXX.ngrok.io`)

### Terminal 1 (Again): Update .env and Restart

Edit `/Users/ifocus/Documents/kill/backend/.env`:

Change from:
```
TWILIO_WEBHOOK_URL=https://localhost:3003
```

To:
```
TWILIO_WEBHOOK_URL=https://XXXX-XXXX-XXXX.ngrok.io
```

Then kill and restart the backend:
```bash
pkill -f "uvicorn" || true
./run_backend.sh
```

### Verify Webhook URLs

Your Twilio webhooks are now at:
- `https://XXXX-XXXX-XXXX.ngrok.io/api/calls/webhooks/twilio/status` ✓
- `https://XXXX-XXXX-XXXX.ngrok.io/api/calls/webhooks/twilio/recording` ✓
- `https://XXXX-XXXX-XXXX.ngrok.io/api/calls/webhooks/twilio/conversation` ✓

### Test with Curl

```bash
curl -X POST "https://XXXX-XXXX-XXXX.ngrok.io/api/calls/webhooks/twilio/status" \
  -d "CallSid=TEST123&CallStatus=completed&CallDuration=60" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -k  # -k ignores self-signed cert warning
```

Should return: `200 OK` (not 404)

## Why This Happens

- **localhost doesn't work for Twilio**: Twilio is an external service and cannot reach `localhost`
- **ngrok tunnel**: Creates a public HTTPS URL that forwards to your local `https://localhost:3003`
- **Webhook path fix**: The routes are under `/api/calls/` in the main app, but the code was building URLs without `/api/`

## Important Notes

⚠️ **ngrok URL changes each time you restart**
- If ngrok disconnects or you restart it, you'll get a new URL
- Update `.env` again with the new URL and restart backend
- For production, use a real domain instead of ngrok

⚠️ **Keep terminal windows open**
- Keep both backend and ngrok running in separate terminals
- If ngrok stops, webhooks will fail with 404/connection refused

## Troubleshooting

If you still get 404:
1. Verify ngrok is running: `ngrok http https://localhost:3003`
2. Check .env has the correct ngrok URL
3. Verify backend is running on HTTPS
4. Check logs in backend terminal for errors

If you get SSL certificate errors:
- This is normal with self-signed certificates
- Use `-k` flag with curl to ignore the warning
- Browsers will show a warning - click "Advanced" → "Proceed"

## For Production

When deploying:
1. Update `TWILIO_WEBHOOK_URL` to your real domain (e.g., `https://api.example.com`)
2. Use real SSL certificates (from Let's Encrypt, AWS, etc.)
3. Don't use ngrok - it's for development only
