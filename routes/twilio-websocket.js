const express = require('express');
const expressWs = require('express-ws');
const twilio = require('twilio');
const Call = require('../models/Call');

const router = express.Router();

// Add WebSocket support to this router
expressWs(router);
const VoiceResponse = twilio.twiml.VoiceResponse;

// Handle incoming calls
router.post('/voice', async (req, res) => {
  const timestamp = new Date().toISOString();
  console.log(`\n🔊 [${timestamp}] TWILIO WEBHOOK RECEIVED`);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body:', JSON.stringify(req.body, null, 2));
  console.log('Host:', req.get('host'));
  console.log('User-Agent:', req.get('user-agent'));
  
  try {
    const twiml = new VoiceResponse();
    const callSid = req.body.CallSid || `test-${Date.now()}`;
    const callerNumber = req.body.From || 'Unknown';
    const targetNumber = process.env.TARGET_PHONE_NUMBER;

    console.log(`📞 [${callSid}] Processing call: ${callerNumber} → ${targetNumber}`);

    // Create call record in database (only if MongoDB is available)
    try {
      const call = new Call({
        callSid: callSid,
        callerNumber: callerNumber,
        targetNumber: targetNumber,
        status: 'initiated'
      });
      await call.save();
      console.log(`✅ [${callSid}] Call record saved to MongoDB`);
    } catch (dbError) {
      console.log(`⚠️  [${callSid}] MongoDB save failed:`, dbError.message);
    }

    // Start real-time transcription stream FIRST (before dial)
    const protocol = req.secure ? 'wss' : 'wss'; // Force wss for ngrok
    const host = req.get('host');
    const streamUrl = `${protocol}://${host}/api/twilio/media-stream`;
    
    // Debug: Check if this is a real Twilio call
    const isRealTwilioCall = req.headers['user-agent'] && req.headers['user-agent'].includes('TwilioProxy');
    console.log(`🔍 [${callSid}] Is real Twilio call: ${isRealTwilioCall}`);
    console.log(`🔍 [${callSid}] User-Agent: ${req.headers['user-agent']}`);
    
    console.log(`🎵 [${callSid}] Configuring media stream:`);
    console.log(`   - Protocol: ${protocol}`);
    console.log(`   - Host: ${host}`);
    console.log(`   - Stream URL: ${streamUrl}`);
    
        // Generate complete TwiML manually since helper library doesn't support transcription yet
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Transcription 
      track="both_tracks" 
      statusCallbackUrl="https://${host}/api/twilio/transcription-status" 
      transcriptionEngine="deepgram" 
      partialResults="true" 
      languageCode="en-US" 
      enableAutomaticPunctuation="true" />
  </Start>
  <Dial record="record-from-ringing" recordingStatusCallback="/api/twilio/recording-status" recordingStatusCallbackMethod="POST">
    <Number statusCallback="/api/twilio/call-status" statusCallbackMethod="POST" statusCallbackEvent="initiated ringing answered completed">${targetNumber}</Number>
  </Dial>
</Response>`;
    console.log(`📋 [${callSid}] TwiML Response:`, twimlResponse);
    console.log(`✅ [${callSid}] Webhook response sent successfully`);
      console.log(`🔍 [${callSid}] EXPECTING TRANSCRIPTION CALLBACKS TO: ${protocol}://${host}/api/twilio/transcription-status`);
  console.log(`⏰ [${callSid}] Real-time transcription should start when call connects\n`);

    res.type('text/xml');
    res.send(twimlResponse);
  } catch (error) {
    console.error(`❌ [WEBHOOK] Error processing voice webhook:`, error);
    console.error('Error stack:', error.stack);
    res.status(500).send('Error processing call');
  }
});

// Get task list
router.get('/task-list', (req, res) => {
  const tasks = [
    'Should ask for the name of the of customer',
    'Should ask for the phone number of the customer',
    'Should ask customer requirements'
  ];
  const completedTasks = [
    'Should ask for the name of the of customer',
    'Should ask for the phone number of the customer',
  ];
  const tasksWithStatus = tasks.map(task => {
    const status = completedTasks.includes(task) ? 'completed' : 'pending';
    return {task, status};
  });
  res.json({tasksWithStatus});
});

// Handle call status updates
router.post('/call-status', async (req, res) => {
  try {
    const callSid = req.body.CallSid;
    const callStatus = req.body.CallStatus;
    const duration = req.body.CallDuration;

    console.log(`📞 [${callSid}] Call status update: ${callStatus}`);

    // Update call status in database
    const updateData = { status: callStatus };
    if (callStatus === 'completed' && duration) {
      updateData.endTime = new Date();
      updateData.duration = parseInt(duration);
    }

    await Call.findOneAndUpdate(
      { callSid: callSid },
      updateData
    );

    // Broadcast call status to dashboard
    if (req.broadcastToDashboard) {
      req.broadcastToDashboard({
        type: 'call_status_update',
        data: {
          callSid,
          status: callStatus,
          duration: duration || null,
          timestamp: new Date().toISOString()
        }
      });
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Error updating call status:', error);
    res.sendStatus(500);
  }
});

// Handle recording status
router.post('/recording-status', async (req, res) => {
  try {
    const recordingUrl = req.body.RecordingUrl;
    const callSid = req.body.CallSid;
    
    console.log(`📹 [${callSid}] Recording available: ${recordingUrl}`);
    
    // Update call record with recording URL
    await Call.findOneAndUpdate(
      { callSid: callSid },
      { recordingUrl: recordingUrl }
    );

    // Broadcast recording status to dashboard
    if (req.broadcastToDashboard) {
      req.broadcastToDashboard({
        type: 'recording_available',
        data: {
          callSid,
          recordingUrl,
          timestamp: new Date().toISOString()
        }
      });
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Error handling recording status:', error);
    res.sendStatus(500);
  }
});

// Store recently processed transcripts to prevent duplicates
const recentTranscripts = new Set();
const TRANSCRIPT_CACHE_TTL = 60000; // 1 minute

// Clean up old transcript cache entries periodically
setInterval(() => {
  recentTranscripts.clear();
}, TRANSCRIPT_CACHE_TTL);

// Transcription status callback endpoint (replaces Deepgram)
router.post('/transcription-status', async (req, res) => {
  try {
    const timestamp = new Date().toISOString();
    console.log(`\n📝 [${timestamp}] TWILIO TRANSCRIPTION CALLBACK`);
    console.log('Body:', JSON.stringify(req.body, null, 2));

    const { 
      TranscriptionSid,
      CallSid, 
      TranscriptionData,
      TranscriptionEvent,
      Final,
      Track
    } = req.body;

    console.log(`🎯 [${CallSid}] Transcription event: ${TranscriptionEvent}`);
    
    if (TranscriptionData && TranscriptionEvent === 'transcription-content') {
      // Parse the TranscriptionData JSON string
      let parsedData;
      try {
        parsedData = JSON.parse(TranscriptionData);
      } catch (parseError) {
        console.error(`❌ [${CallSid}] Failed to parse TranscriptionData:`, parseError);
        res.status(200).send('OK');
        return;
      }

      const { transcript, confidence } = parsedData;
      const isPartial = Final !== 'true';
      
      console.log(`📝 [${CallSid}] Track: ${Track}, Text: "${transcript}" (confidence: ${confidence}, final: ${Final})`);
      
      // Store transcript in database if it's final (not partial)
      if (Final === 'true') {
        try {
          // Create unique identifier for deduplication
          const transcriptId = `${CallSid}-${Track}-${transcript}-${timestamp}`;
          
          // Check if we've already processed this exact transcript
          if (recentTranscripts.has(transcriptId)) {
            console.log(`⚠️ [${CallSid}] Duplicate transcript detected, skipping broadcast: "${transcript}"`);
            res.status(200).send('OK');
            return;
          }
          
          // Add to recent transcripts cache
          recentTranscripts.add(transcriptId);

          const transcriptData = {
            type: 'transcript',
            data: {
              callSid: CallSid,
              text: transcript,
              isPartial: isPartial,
              track: Track,
              role: Track === 'inbound_track' ? 'agent' : 'customer',
              confidence: confidence,
              timestamp: timestamp
            }
          };
          
          req.broadcastToDashboard(transcriptData);
          console.log(`📡 [${CallSid}] Transcript broadcasted to dashboard`);


          const Call = require('../models/Call');
          await Call.findOneAndUpdate(
            { callSid: CallSid },
            { 
              $push: { 
                transcripts: {
                  text: transcript,
                  track: Track,
                  role: Track === 'inbound_track' ? 'agent' : 'customer',
                  timestamp: new Date(),
                  confidence: confidence || 1.0
                }
              }
            },
            { upsert: true }
          );
          console.log(`💾 [${CallSid}] Final transcript saved to database - Track: ${Track}, Text: "${transcript}"`);
        } catch (dbError) {
          console.error(`❌ [${CallSid}] Database save error:`, dbError.message);
        }
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ [TRANSCRIPTION] Error processing callback:', error);
    res.status(500).send('Error processing transcription callback');
  }
});

// WebSocket handler for Twilio media streams
router.ws('/media-stream', (ws, req) => {
  const connectionTime = new Date().toISOString();
  console.log(`\n🎵 [${connectionTime}] TWILIO MEDIA WEBSOCKET CONNECTED`);
  console.log('🚨 THIS IS THE MEDIA STREAM ENDPOINT BEING CALLED!');
  console.log('WebSocket Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Remote Address:', req.connection.remoteAddress);
  console.log('User-Agent:', req.headers['user-agent']);
  console.log('Origin:', req.headers.origin);
  
  let callSid = null;
  let deepgramConnection = null;
  let isStreamActive = false;
  let messageCount = 0;
  let audioPacketCount = 0;

  ws.on('message', async (message) => {
    messageCount++;
    const timestamp = new Date().toISOString();
    
    try {
      const msg = JSON.parse(message);
      // console.log(`📨 [${timestamp}] Media WS Message #${messageCount} - Event: ${msg.event}`);
      
      if (msg.event === 'connected') {
        console.log(`✅ [MEDIA-WS] Twilio media stream protocol connected`);
        console.log('Connected payload:', JSON.stringify(msg, null, 2));
        
      } else if (msg.event === 'start') {
        callSid = msg.start.callSid;
        isStreamActive = true;
        console.log(`\n🚀 [${callSid}] MEDIA STREAM STARTED`);
        console.log('Start payload:', JSON.stringify(msg.start, null, 2));
        
        // Broadcast stream start to dashboard
        if (req.broadcastToDashboard) {
          req.broadcastToDashboard({
            type: 'stream_started',
            data: {
              callSid,
              timestamp,
              streamDetails: msg.start
            }
          });
        }
        
        try {
          console.log(`🔧 [${callSid}] Initializing Deepgram connection...`);
          deepgramConnection = await transcriptionService.initializeStream(callSid, req.broadcastToDashboard);
          console.log(`✅ [${callSid}] Deepgram connection established successfully`);
        } catch (error) {
          console.error(`❌ [${callSid}] DEEPGRAM INITIALIZATION FAILED:`, error);
          console.error('Deepgram error stack:', error.stack);
          
          if (req.broadcastToDashboard) {
            req.broadcastToDashboard({
              type: 'transcription_error',
              data: {
                callSid,
                error: 'Failed to initialize Deepgram',
                details: error.message,
                timestamp
              }
            });
          }
        }
        
      } else if (msg.event === 'media') {
        audioPacketCount++;
        
        // Log every 50th audio packet to avoid spam
        if (audioPacketCount % 50 === 1) {
          console.log(`🎤 [${callSid}] Audio packet #${audioPacketCount} - Payload size: ${msg.media.payload ? msg.media.payload.length : 0} chars`);
        }
        
        // Forward audio data to Deepgram
        if (deepgramConnection && msg.media.payload && isStreamActive) {
          try {
            const audioBuffer = Buffer.from(msg.media.payload, 'base64');
            deepgramConnection.send(audioBuffer);
            
            // Log every 100th audio forward
            if (audioPacketCount % 100 === 1) {
              console.log(`📤 [${callSid}] Audio forwarded to Deepgram - Buffer size: ${audioBuffer.length} bytes`);
            }
          } catch (error) {
            console.error(`❌ [${callSid}] Error sending audio to Deepgram:`, error);
          }
        } else {
          if (audioPacketCount % 50 === 1) {
            console.log(`⚠️  [${callSid}] Audio not forwarded - DG: ${!!deepgramConnection}, Payload: ${!!msg.media.payload}, Active: ${isStreamActive}`);
          }
        }
        
      } else if (msg.event === 'stop') {
        console.log(`\n🛑 [${callSid}] MEDIA STREAM STOPPED`);
        console.log(`📊 [${callSid}] Stream stats - Messages: ${messageCount}, Audio packets: ${audioPacketCount}`);
        isStreamActive = false;
        
        // Broadcast stream stop to dashboard
        if (req.broadcastToDashboard) {
          req.broadcastToDashboard({
            type: 'stream_ended',
            data: {
              callSid,
              timestamp,
              stats: {
                totalMessages: messageCount,
                audioPackets: audioPacketCount
              }
            }
          });
        }
        
        if (deepgramConnection) {
          try {
            deepgramConnection.finish();
            console.log(`✅ [${callSid}] Deepgram connection finished gracefully`);
          } catch (error) {
            console.error(`❌ [${callSid}] Error finishing Deepgram connection:`, error);
          }
        }
      } else {
        console.log(`🔍 [${callSid}] Unknown media event: ${msg.event}`, msg);
      }
    } catch (error) {
      console.error(`❌ [${callSid}] Error processing media WebSocket message:`, error);
      console.error('Raw message:', message.toString());
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`\n🔌 [${callSid}] MEDIA WEBSOCKET CLOSED`);
    console.log(`   - Code: ${code}`);
    console.log(`   - Reason: ${reason}`);
    console.log(`   - Total messages: ${messageCount}`);
    console.log(`   - Audio packets: ${audioPacketCount}`);
    
    isStreamActive = false;
    if (deepgramConnection) {
      try {
        deepgramConnection.finish();
        console.log(`✅ [${callSid}] Deepgram connection cleaned up`);
      } catch (error) {
        console.error(`❌ [${callSid}] Error cleaning up Deepgram:`, error);
      }
    }
  });

  ws.on('error', (error) => {
    console.error(`\n❌ [${callSid}] MEDIA WEBSOCKET ERROR:`, error);
    console.error('WebSocket error stack:', error.stack);
    
    isStreamActive = false;
    if (deepgramConnection) {
      try {
        deepgramConnection.finish();
      } catch (finishError) {
        console.error(`❌ [${callSid}] Error finishing Deepgram on error:`, finishError);
      }
    }
  });
});

module.exports = router;