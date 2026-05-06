#!/bin/bash
# Setup ngrok for Twilio Webhooks

echo "========================================="
echo "Setting up ngrok for Twilio Webhooks"
echo "========================================="
echo ""

# Check if ngrok is installed
if ! command -v ngrok &> /dev/null; then
    echo "❌ ngrok is not installed"
    echo ""
    echo "To install ngrok:"
    echo "  brew install ngrok"
    echo ""
    exit 1
fi

echo "✓ ngrok found: $(ngrok --version)"
echo ""

echo "========================================="
echo "Step 1: Make sure backend is running"
echo "========================================="
echo ""
echo "Run in Terminal 1:"
echo "  cd /Users/ifocus/Documents/kill/backend"
echo "  ./run_backend.sh"
echo ""
echo "Backend should be on: https://localhost:3003"
echo ""

read -p "Is backend running on https://localhost:3003? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Please start the backend first with: ./run_backend.sh"
    exit 1
fi

echo "========================================="
echo "Step 2: Starting ngrok tunnel"
echo "========================================="
echo ""
echo "Run this command in Terminal 2:"
echo "  ngrok http --url=$(curl -s https://api.github.com/repos/inconshreveable/ngrok/releases/latest | grep -oP '(?<="browser_download_url": ")[^"]*' | head -1 | xargs -I {} bash -c 'echo ""' || echo "") https://localhost:3003"
echo ""
echo "Or simply:"
echo "  ngrok http https://localhost:3003"
echo ""

read -p "Has ngrok tunnel been started? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Please start ngrok in another terminal with: ngrok http https://localhost:3003"
    exit 1
fi

echo "========================================="
echo "Step 3: Get ngrok URL"
echo "========================================="
echo ""
echo "Look for the ngrok URL in the tunnel output, something like:"
echo "  https://XXXX-XX-XXXX-XXXX-XXX.ngrok.io"
echo ""

read -p "Enter the ngrok HTTPS URL (include https://): " NGROK_URL

# Validate URL format
if [[ ! $NGROK_URL =~ ^https:// ]]; then
    echo "❌ Invalid URL format. Must start with https://"
    exit 1
fi

echo ""
echo "========================================="
echo "Step 4: Update environment variables"
echo "========================================="
echo ""
echo "Update TWILIO_WEBHOOK_URL in: /Users/ifocus/Documents/kill/backend/.env"
echo ""
echo "From:"
echo "  TWILIO_WEBHOOK_URL=https://localhost:3003"
echo ""
echo "To:"
echo "  TWILIO_WEBHOOK_URL=${NGROK_URL}"
echo ""

read -p "Update .env file now? (y/n) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    # Update .env file
    sed -i.bak "s|TWILIO_WEBHOOK_URL=.*|TWILIO_WEBHOOK_URL=${NGROK_URL}|g" /Users/ifocus/Documents/kill/backend/.env
    echo "✓ .env updated with ngrok URL"
    echo ""
fi

echo "========================================="
echo "Step 5: Restart backend"
echo "========================================="
echo ""
echo "Kill and restart the backend to pick up new environment:"
echo "  cd /Users/ifocus/Documents/kill/backend"
echo "  ./run_backend.sh"
echo ""

echo "========================================="
echo "Testing Webhook Endpoints"
echo "========================================="
echo ""
echo "After restarting, the Twilio webhooks will be at:"
echo "  ${NGROK_URL}/api/calls/webhooks/twilio/status"
echo "  ${NGROK_URL}/api/calls/webhooks/twilio/recording"
echo "  ${NGROK_URL}/api/calls/webhooks/twilio/conversation"
echo ""

read -p "Test webhook endpoint? (y/n) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Testing: ${NGROK_URL}/api/calls/webhooks/twilio/status"
    curl -X POST "${NGROK_URL}/api/calls/webhooks/twilio/status" \
        -d "CallSid=TEST123&CallStatus=completed&CallDuration=60" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -w "\nHTTP Status: %{http_code}\n"
    echo ""
fi

echo "========================================="
echo "✓ Setup Complete!"
echo "========================================="
echo ""
echo "Your Twilio webhooks are now properly configured:"
echo "  TWILIO_WEBHOOK_URL=${NGROK_URL}"
echo ""
echo "Next steps:"
echo "1. Verify ngrok tunnel is still running"
echo "2. Restart backend to pick up new .env"
echo "3. Test with a live Twilio call"
echo ""
echo "⚠️  Important: ngrok URLs change when you restart ngrok"
echo "   Keep the tunnel running or update .env again if it disconnects"
echo ""
