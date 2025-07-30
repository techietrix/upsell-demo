const express = require('express');
const expressWs = require('express-ws');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Import custom modules
const redisClient = require('./config/redis');
const connectDB = require('./config/database');

const app = express();

// Setup express-ws for all WebSocket functionality
const wsInstance = expressWs(app);

// Connect to databases
connectDB().catch(err => {
  console.error('Database connection failed:', err.message);
  console.log('Server starting anyway...');
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Store connected dashboard clients
const dashboardClients = new Set();

// Dashboard WebSocket endpoint
app.ws('/ws/dashboard', (ws, req) => {
  const connectionTime = new Date().toISOString();
  const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  console.log(`\n📱 [${connectionTime}] DASHBOARD CLIENT CONNECTED`);
  console.log(`   - Client ID: ${clientId}`);
  console.log(`   - Client IP: ${req.connection.remoteAddress}`);
  console.log(`   - Total clients: ${dashboardClients.size + 1}`);
  
  // Add client to active connections
  dashboardClients.add({ ws, clientId, connectedAt: connectionTime });
  
  // Send connection confirmation
  ws.send(JSON.stringify({
    type: 'connection_confirmed',
    data: {
      clientId: clientId,
      timestamp: connectionTime,
      message: 'Dashboard connected successfully'
    }
  }));
  
  // Send recent transcripts on connection
  const sendRecentTranscripts = async () => {
    try {
      console.log(`📊 [${clientId}] Fetching recent transcripts from Redis...`);
      const recentTranscripts = await redisClient.lRange('callused', -50, -1);
      const parsedTranscripts = recentTranscripts.map(transcript => JSON.parse(transcript));
      
      console.log(`📤 [${clientId}] Sending ${parsedTranscripts.length} recent transcripts`);
      
      ws.send(JSON.stringify({
        type: 'recent_transcripts',
        data: parsedTranscripts
      }));
      
      console.log(`✅ [${clientId}] Recent transcripts sent successfully`);
    } catch (error) {
      console.error(`❌ [${clientId}] Error fetching recent transcripts:`, error);
      
      ws.send(JSON.stringify({
        type: 'error',
        data: {
          message: 'Failed to fetch recent transcripts',
          error: error.message
        }
      }));
    }
  };
  
  sendRecentTranscripts();
  
  // Send initial task list on connection
  const sendInitialTaskList = () => {
    try {
      console.log(`📋 [${clientId}] Sending initial task list...`);
      
      ws.send(JSON.stringify({
        type: 'task_list_update',
        data: {
          callSid: null,
          tasksWithStatus: [
            { task: 'Should ask for the name of the customer', status: 'pending' },
            { task: 'Should ask for the phone number of the customer', status: 'pending' },
            { task: 'Should ask customer requirements', status: 'pending' }
          ],
          completedCount: 0,
          totalCount: 3,
          timestamp: new Date().toISOString()
        }
      }));
      
      console.log(`✅ [${clientId}] Initial task list sent successfully`);
    } catch (error) {
      console.error(`❌ [${clientId}] Error sending initial task list:`, error);
    }
  };
  
  sendInitialTaskList();
  
  // Handle incoming messages from dashboard
  ws.on('message', (message) => {
    try {
      const parsed = JSON.parse(message);
      console.log(`📨 [${clientId}] Received message:`, parsed);
      
      switch (parsed.type) {
        case 'ping':
          ws.send(JSON.stringify({
            type: 'pong',
            data: { timestamp: new Date().toISOString() }
          }));
          break;
          
        case 'debug_test':
          console.log(`🧪 [${clientId}] Debug test received:`, parsed.data);
          ws.send(JSON.stringify({
            type: 'debug_response',
            data: {
              message: 'Debug response from server',
              timestamp: new Date().toISOString(),
              clientId: clientId,
              originalData: parsed.data
            }
          }));
          break;
          
        default:
          console.log(`❓ [${clientId}] Unknown message type: ${parsed.type}`);
      }
    } catch (error) {
      console.error(`❌ [${clientId}] Error processing message:`, error);
    }
  });
  
  ws.on('close', (code, reason) => {
    console.log(`\n👋 [${clientId}] DASHBOARD CLIENT DISCONNECTED`);
    console.log(`   - Code: ${code}`);
    console.log(`   - Reason: ${reason}`);
    console.log(`   - Remaining clients: ${dashboardClients.size - 1}`);
    
    // Remove client from active connections
    dashboardClients.forEach(client => {
      if (client.clientId === clientId) {
        dashboardClients.delete(client);
      }
    });
  });
  
  ws.on('error', (error) => {
    console.error(`❌ [${clientId}] Dashboard WebSocket error:`, error);
    
    // Remove client from active connections on error
    dashboardClients.forEach(client => {
      if (client.clientId === clientId) {
        dashboardClients.delete(client);
      }
    });
  });
});

// Function to broadcast messages to all dashboard clients
const broadcastToDashboard = (message) => {
  const messageStr = JSON.stringify(message);
  let successCount = 0;
  let errorCount = 0;
  
  dashboardClients.forEach(client => {
    try {
      if (client.ws.readyState === client.ws.OPEN) {
        client.ws.send(messageStr);
        successCount++;
      } else {
        // Remove closed connections
        dashboardClients.delete(client);
        errorCount++;
      }
    } catch (error) {
      console.error(`❌ Error broadcasting to client ${client.clientId}:`, error);
      dashboardClients.delete(client);
      errorCount++;
    }
  });
  
  console.log(`📡 Broadcast sent to ${successCount} clients (${errorCount} failed)`);
};



// Make broadcast function available to routes
app.use((req, res, next) => {
  req.broadcastToDashboard = broadcastToDashboard;
  next();
});

// Import and use Twilio routes
const twilioRoutes = require('./routes/twilio-websocket');
app.use('/api/twilio', twilioRoutes);

// Serve static files from the React app build directory
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'client/build')));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'client/build', 'index.html'));
  });
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    dashboardClients: dashboardClients.size,
    uptime: process.uptime()
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Global error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Dashboard WebSocket: ws://localhost:${PORT}/ws/dashboard`);
  console.log(`🎵 Twilio Media WebSocket: ws://localhost:${PORT}/api/twilio/media-stream`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
}); 