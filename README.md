# Real-time Phone Call Transcription

A production-ready real-time phone call transcription system using Twilio, Deepgram, and WebSocket.

## Features

- 📞 **Real-time call handling** with Twilio
- 🎤 **Live speech-to-text** transcription using Deepgram
- 🌐 **WebSocket-based dashboard** for real-time transcript viewing
- 💾 **Persistent storage** with MongoDB and Redis
- 📱 **Responsive web interface**
- 🔄 **Auto-reconnection** and error handling

## Architecture

```
Twilio Call → Media WebSocket → Deepgram → Transcripts → Dashboard WebSocket → React UI
                    ↓
               MongoDB + Redis Storage
```

## Quick Start

### Prerequisites

- Node.js 18+
- MongoDB (local or Atlas)
- Redis (local or cloud)
- Twilio account with phone number
- Deepgram API account

### Installation

1. **Clone and install:**
   ```bash
   git clone <repository>
   cd rnd
   npm install
   cd client && npm install && cd ..
   ```

2. **Configure environment:**
   ```bash
   cp env.example .env
   # Edit .env with your credentials
   ```

3. **Start services:**
   ```bash
   # Start MongoDB and Redis
   # Then start the application
   npm run dev
   ```

4. **Start frontend:**
   ```bash
   cd client && npm start
   ```

## Environment Variables

```env
# Twilio Configuration (Required)
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=your_twilio_number
TARGET_PHONE_NUMBER=destination_number

# Deepgram Configuration (Required)
DEEPGRAM_API_KEY=your_deepgram_api_key

# Database Configuration
MONGODB_URI=mongodb://localhost:27017/transcription
REDIS_URL=redis://localhost:6379

# Server Configuration
PORT=3001
NODE_ENV=development
```

## Twilio Webhook Setup

Configure your Twilio phone number webhook:
- **Voice URL:** `https://your-domain.com/api/twilio/voice`
- **Method:** POST

For development with ngrok:
```bash
ngrok http 3001
# Use the HTTPS URL for Twilio webhook
```

## API Endpoints

- `GET /health` - Server health check
- `POST /api/twilio/voice` - Twilio voice webhook
- `POST /api/twilio/call-status` - Call status updates
- `POST /api/twilio/recording-status` - Recording availability
- `WebSocket /ws/dashboard` - Dashboard real-time updates
- `WebSocket /api/twilio/media-stream` - Twilio media streaming

## WebSocket Events

### Dashboard Events
- `connection_confirmed` - Connection established
- `recent_transcripts` - Historical transcripts
- `new_transcript` - Real-time transcript
- `stream_started` - Call stream began
- `stream_ended` - Call stream ended
- `deepgram_connected` - Transcription ready
- `transcription_error` - Error occurred

## Usage

1. **Open dashboard:** `http://localhost:3000`
2. **Call your Twilio number**
3. **Watch real-time transcripts** appear on dashboard
4. **View call history** and recordings

## Technology Stack

- **Backend:** Node.js, Express, express-ws
- **Frontend:** React, native WebSocket
- **Telephony:** Twilio Voice API, Media Streams
- **Transcription:** Deepgram Nova-2 model
- **Storage:** MongoDB, Redis
- **Real-time:** WebSocket (no Socket.IO)

## Production Deployment

1. **Set environment variables**
2. **Configure HTTPS/SSL**
3. **Setup production databases**
4. **Configure Twilio webhooks**
5. **Deploy with PM2 or Docker**

```bash
npm run build
npm start
```

## Troubleshooting

### No Transcripts Appearing
- Check Deepgram account credits
- Verify all parties are speaking clearly
- Ensure call is connected (not just ringing)
- Check WebSocket connections in browser console

### Common Issues
- **WebSocket errors:** Check firewall/proxy settings
- **Database errors:** Verify MongoDB/Redis connectivity
- **Webhook timeouts:** Ensure server is publicly accessible

## License

MIT License 