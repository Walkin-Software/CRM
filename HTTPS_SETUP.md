# HTTPS Setup Guide

## SSL Certificates
Self-signed SSL certificates have been generated in the `cert/` folder:
- `cert/cert.pem` - SSL Certificate
- `cert/key.pem` - Private Key

These are valid for 365 days.

## Starting the Backend with HTTPS

The backend now runs with HTTPS by default:

```bash
cd /Users/ifocus/Documents/kill/backend
./run_backend.sh
```

The backend will start on: **https://localhost:3003**

## Starting the Frontend with HTTPS

The frontend Vite dev server is configured to use HTTPS:

```bash
cd /Users/ifocus/Documents/kill/frontend
npm run dev
```

The frontend will start on: **https://localhost:5173**

## Accessing the Application

1. Navigate to: **https://localhost:5173**
2. Your browser will show a security warning about the self-signed certificate - this is normal for development
3. Click "Advanced" → "Proceed to localhost" (or equivalent option in your browser)
4. You should now see the login page

## Important: Twilio Webhooks

⚠️ **Twilio cannot reach `localhost` URLs**

For Twilio webhooks to work, you need a public URL. Options:

### Option 1: Use ngrok (Recommended for Local Development)

```bash
# In a new terminal window:
ngrok http https://localhost:3003

# Copy the ngrok URL and update in backend/.env:
TWILIO_WEBHOOK_URL=https://YOUR_NGROK_URL/webhooks/twilio
```

### Option 2: Deploy to a Public Server

Update `TWILIO_WEBHOOK_URL` in `.env` to your production URL:

```
TWILIO_WEBHOOK_URL=https://your-production-domain.com/webhooks/twilio
```

## Browser SSL Warning Handling

For development with self-signed certificates:

1. **Chrome/Edge**: Click "Advanced" → "Proceed to localhost"
2. **Firefox**: Click "Advanced" → "Accept the Risk and Continue"
3. **Safari**: You may need to add the certificate to your system keychain

## Regenerating Certificates

If you need to regenerate the certificates:

```bash
cd /Users/ifocus/Documents/kill/cert
rm -f cert.pem key.pem
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=localhost"
```

Then restart both backend and frontend.

## Environment Variables

Updated for HTTPS:
- `VITE_API_BASE_URL=https://localhost:3003`
- `TWILIO_WEBHOOK_URL=https://localhost:3003` (requires ngrok for public access)

## Verification Checklist

✅ Backend compiles without errors
✅ SSL certificates created
✅ Backend run script updated to use SSL
✅ Frontend Vite config updated to use SSL
✅ Environment variables updated to HTTPS
✅ Ready to start both services
