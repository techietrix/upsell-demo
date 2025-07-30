import React, { useState, useEffect, useRef } from 'react';
import moment from 'moment';
import './App.css';

// Individual components for each section
const TaskListSection = () => {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const response = await fetch('/api/twilio/task-list');
        if (!response.ok) {
          throw new Error('Failed to fetch tasks');
        }
        const data = await response.json();
        setTasks(data.tasksWithStatus || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchTasks();
    // Refresh tasks every 30 seconds
    const interval = setInterval(fetchTasks, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="section-container">
        <div className="section-header">
          <h2>Task List</h2>
        </div>
        <div className="loading">Loading tasks...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="section-container">
        <div className="section-header">
          <h2>Task List</h2>
        </div>
        <div className="error">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="section-container">
      <div className="section-header">
        <h2>Task List</h2>
        <span className="task-count">{tasks.length} tasks</span>
      </div>
      <div className="section-content">
        {tasks.length === 0 ? (
          <div className="empty-state">No tasks available</div>
        ) : (
          <div className="task-list">
            {tasks.map((taskItem, index) => (
              <div key={index} className={`task-item ${taskItem.status}`}>
                <div className="task-status">
                  <span className={`status-badge ${taskItem.status}`}>
                    {taskItem.status === 'completed' ? '✓' : '○'}
                  </span>
                </div>
                <div className="task-content">
                  {taskItem.task}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const TranscriptionSection = ({ finalTranscripts }) => {
  return (
    <div className="section-container">
      <div className="section-header">
        <h2>Live Transcription</h2>
        <span className="transcript-count">{finalTranscripts.length} messages</span>
      </div>
      <div className="section-content">
        {finalTranscripts.length === 0 ? (
          <div className="empty-state">
            <p>No transcriptions yet</p>
            <small>Waiting for call transcriptions...</small>
          </div>
        ) : (
          <div className="transcript-list">
            {finalTranscripts.map((transcript, index) => {
              const role = transcript.role || transcript.track || 'speaker';
              const roleClass = role.toLowerCase();
              
              return (
                <div key={index} className={`transcript-item ${roleClass}`}>
                  <div className="transcript-header">
                    <span className={`speaker role-${roleClass}`}>
                      {role.charAt(0).toUpperCase() + role.slice(1)}
                    </span>
                    <span className="timestamp">
                      {moment(transcript.timestamp).format('HH:mm:ss')}
                    </span>
                    <span className="confidence">
                      {Math.round((transcript.confidence || 0) * 100)}%
                    </span>
                  </div>
                  <div className="transcript-text">
                    {transcript.text}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

const RecommendationsSection = ({ aiRecommendations, backendRecommendations }) => {
  // Combine AI recommendations with backend ones, AI first
  const allRecommendations = [...aiRecommendations, ...backendRecommendations];

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return '#ff4757';
      case 'medium': return '#ffa502';
      case 'low': return '#2ed573';
      default: return '#747d8c';
    }
  };

  const getTypeIcon = (rec) => {
    // Check if it's a contextual AI recommendation
    if (rec.source === 'contextual_ai') {
      return '🧠'; // Brain icon for contextual AI
    }
    
    switch (rec.type) {
      case 'ai_suggestion': return '🤖';
      case 'suggestion': return '💡';
      case 'reminder': return '⏰';
      case 'tip': return '💭';
      case 'action': return '✅';
      default: return '📝';
    }
  };

  const isAIRecommendation = (rec) => {
    return rec.type === 'ai_suggestion' || rec.source === 'contextual_ai';
  };

  return (
    <div className="section-container">
      <div className="section-header">
        <h2>Recommendations</h2>
        <span className="recommendation-count">
          {allRecommendations.filter(rec => isAIRecommendation(rec)).length > 0 && (
            <span className="ai-count">🤖 {allRecommendations.filter(rec => isAIRecommendation(rec)).length} AI • </span>
          )}
          {allRecommendations.length} total
        </span>
      </div>
      <div className="section-content">
        {allRecommendations.length === 0 ? (
          <div className="empty-state">
            <p>No recommendations yet</p>
            <small>Contextual recommendations will appear here when you're on a call...</small>
          </div>
        ) : (
          <div className="recommendations-list">
            {allRecommendations.map((rec) => (
              <div key={rec.id} className={`recommendation-item ${isAIRecommendation(rec) ? 'ai-recommendation' : ''}`}>
                <div className="recommendation-header">
                  <span className="rec-icon">{getTypeIcon(rec)}</span>
                  <span className="rec-title">{rec.title}</span>
                  <span 
                    className="rec-priority" 
                    style={{ backgroundColor: getPriorityColor(rec.priority) }}
                  >
                    {rec.priority}
                  </span>
                  {rec.timestamp && (
                    <span className="rec-timestamp">
                      {moment(rec.timestamp).fromNow()}
                    </span>
                  )}
                </div>
                <div className="recommendation-description">
                  {rec.description}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

function App() {
  const [finalTranscripts, setFinalTranscripts] = useState([]);
  const [aiRecommendations, setAiRecommendations] = useState([]);
  const [backendRecommendations, setBackendRecommendations] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('Connecting...');
  const [lastError, setLastError] = useState(null);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;

  const connectWebSocket = () => {
    const timestamp = new Date().toISOString();
    console.log(`🔌 [${timestamp}] Initializing WebSocket connection...`);
    
    const wsUrl = process.env.NODE_ENV === 'production' 
      ? `wss://${window.location.host}/ws/dashboard`
      : 'ws://localhost:3001/ws/dashboard';
    
    console.log('WebSocket URL:', wsUrl);
    
    try {
      wsRef.current = new WebSocket(wsUrl);
      
      wsRef.current.onopen = () => {
        const connectTime = new Date().toISOString();
        console.log(`✅ [${connectTime}] DASHBOARD WEBSOCKET CONNECTED`);
        setIsConnected(true);
        setConnectionStatus('Connected');
        setLastError(null);
        reconnectAttemptsRef.current = 0;
      };
      
      wsRef.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          const receiveTime = new Date().toISOString();
          
          console.log(`📨 [${receiveTime}] WebSocket message received:`, message);
          
          switch (message.type) {
            case 'connection_confirmed':
              console.log(`✅ Connection confirmed:`, message.data);
              break;
              
            case 'recent_transcripts':
              console.log(`📊 [${receiveTime}] RECEIVED RECENT TRANSCRIPTS`);
              console.log('   - Count:', message.data.length);
              
              // Apply deduplication to recent transcripts as well
              setFinalTranscripts(prev => {
                const combined = [...prev];
                
                message.data.forEach(transcript => {
                  const transcriptId = `${transcript.callSid}-${transcript.track || transcript.role}-${transcript.text}-${transcript.timestamp}`;
                  
                  const isDuplicate = combined.some(existing => {
                    const existingId = `${existing.callSid}-${existing.track || existing.role}-${existing.text}-${existing.timestamp}`;
                    return existingId === transcriptId;
                  });
                  
                  if (!isDuplicate) {
                    combined.push(transcript);
                  }
                });
                
                // Keep only last 50 transcripts
                return combined.slice(-50);
              });
              break;
              
            case 'transcript':
              // Only show final transcripts (when final=true)
              if (!message.data.isPartial) {
                console.log(`🎤 [${receiveTime}] FINAL TRANSCRIPT RECEIVED:`, message.data);
                setFinalTranscripts(prev => {
                  // Create unique identifier for deduplication
                  const newTranscriptId = `${message.data.callSid}-${message.data.track || message.data.role}-${message.data.text}-${message.data.timestamp}`;
                  
                  // Check if this transcript already exists
                  const isDuplicate = prev.some(existing => {
                    const existingId = `${existing.callSid}-${existing.track || existing.role}-${existing.text}-${existing.timestamp}`;
                    return existingId === newTranscriptId;
                  });
                  
                  if (isDuplicate) {
                    console.log(`⚠️ [${receiveTime}] Duplicate transcript detected, skipping:`, message.data.text);
                    return prev; // Return unchanged array
                  }
                  
                  const updated = [...prev, message.data];
                  // Keep only last 50 final transcripts
                  return updated.slice(-50);
                });
              }
              break;
              
            case 'ai_recommendation':
              console.log(`🤖 [${receiveTime}] AI RECOMMENDATION RECEIVED:`, message.data);
              setAiRecommendations(prev => {
                const newRecommendation = {
                  id: Date.now(),
                  type: 'ai_suggestion',
                  title: 'AI Suggestion',
                  description: message.data.recommendation,
                  priority: 'high',
                  callSid: message.data.callSid,
                  timestamp: message.data.timestamp
                };
                
                // Keep only last 5 AI recommendations
                const updated = [...prev, newRecommendation];
                return updated.slice(-5);
              });
              break;
              
            case 'backend_recommendations':
              console.log(`📋 [${receiveTime}] BACKEND RECOMMENDATIONS RECEIVED:`, message.data.length, 'items');
              setBackendRecommendations(message.data);
              break;
              
            case 'transcription_error':
              console.error(`❌ Transcription error:`, message.data);
              setLastError(`Transcription error: ${message.data.error}`);
              break;
              
            case 'error':
              console.error(`❌ Server error:`, message.data);
              setLastError(message.data.message);
              break;
              
            default:
              console.log(`📝 Message type: ${message.type}`, message);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };
      
      wsRef.current.onclose = (event) => {
        const disconnectTime = new Date().toISOString();
        console.log(`❌ [${disconnectTime}] WEBSOCKET DISCONNECTED`);
        
        setIsConnected(false);
        setConnectionStatus('Disconnected');
        
        if (event.code !== 1000 && reconnectAttemptsRef.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 10000);
          reconnectAttemptsRef.current++;
          
          setConnectionStatus(`Reconnecting... (${reconnectAttemptsRef.current}/${maxReconnectAttempts})`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log(`🔄 Attempting to reconnect...`);
            connectWebSocket();
          }, delay);
        } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
          setConnectionStatus('Connection failed');
          setLastError('Failed to reconnect after multiple attempts');
        }
      };
      
      wsRef.current.onerror = (error) => {
        console.error(`❌ WEBSOCKET ERROR:`, error);
        setLastError('WebSocket connection error');
      };
      
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      setLastError('Failed to create WebSocket connection');
      setConnectionStatus('Connection failed');
    }
  };

  useEffect(() => {
    connectWebSocket();
    
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounting');
      }
    };
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Call Management Dashboard</h1>
        <div className="connection-status">
          <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
            ● {connectionStatus}
          </span>
          {lastError && (
            <div className="error-message">
              {lastError}
            </div>
          )}
        </div>
      </header>

      <main className="main-content">
        <div className="dashboard-grid">
          <TaskListSection />
          <TranscriptionSection finalTranscripts={finalTranscripts} />
          <RecommendationsSection 
            aiRecommendations={aiRecommendations} 
            backendRecommendations={backendRecommendations} 
          />
        </div>
      </main>
    </div>
  );
}

export default App; 