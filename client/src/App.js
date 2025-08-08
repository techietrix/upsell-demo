import React, { useState, useEffect, useRef, useCallback } from 'react';
import moment from 'moment';
import './App.css';

// Customer Number Input Component
const CustomerNumberSection = ({ customerNumber, setCustomerNumber, isLoading, error }) => {
  const [inputValue, setInputValue] = useState(customerNumber);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  useEffect(() => {
    setInputValue(customerNumber);
  }, [customerNumber]);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage('');
    
    try {
      const response = await fetch('/api/customer-number', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ customerNumber: inputValue }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        setCustomerNumber(inputValue);
        setSaveMessage('✓ Saved successfully');
        setTimeout(() => setSaveMessage(''), 3000);
      } else {
        setSaveMessage(`✗ Error: ${data.error}`);
      }
    } catch (error) {
      console.error('Error saving customer number:', error);
      setSaveMessage('✗ Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSave();
    }
  };

  return (
    <div className="customer-number-section">
      <div className="customer-number-container">
        <label htmlFor="customer-number" className="customer-number-label">
          Target Customer Number:
        </label>
        <div className="customer-number-input-group">
          <input
            id="customer-number"
            type="tel"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Enter customer phone number..."
            className="customer-number-input"
            disabled={isLoading || isSaving}
          />
          <button 
            onClick={handleSave}
            disabled={isLoading || isSaving || inputValue === customerNumber}
            className="customer-number-save-btn"
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
        {saveMessage && (
          <div className={`save-message ${saveMessage.includes('✓') ? 'success' : 'error'}`}>
            {saveMessage}
          </div>
        )}
        {error && (
          <div className="error-message">
            Error loading customer number: {error}
          </div>
        )}
      </div>
    </div>
  );
};

// Individual components for each section
const TaskListSection = ({ tasks, completedCount, totalCount }) => {
  return (
    <div className="section-container">
      <div className="section-header">
        <h2>Task List</h2>
        <span className="task-count">
          {completedCount}/{totalCount} completed
        </span>
      </div>
      <div className="section-content">
        {tasks.length === 0 ? (
          <div className="empty-state">
            <p>No tasks available</p>
            <small>Task completion will be tracked during calls...</small>
          </div>
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
  // Sort transcripts by timestamp in descending order (newest first)
  const sortedTranscripts = [...finalTranscripts].sort((a, b) => {
    // Handle cases where timestamp might be missing
    const timestampA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const timestampB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return timestampB - timestampA; // Descending order (newest first)
  });

  return (
    <div className="section-container">
      <div className="section-header">
        <h2>Live Transcription</h2>
        <span className="transcript-count">{finalTranscripts.length} messages</span>
      </div>
      <div className="section-content">
        {sortedTranscripts.length === 0 ? (
          <div className="empty-state">
            <p>No transcriptions yet</p>
            <small>Waiting for call transcriptions...</small>
          </div>
        ) : (
          <div className="transcript-list">
            {sortedTranscripts.map((transcript, index) => {
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
  // Combine AI recommendations with backend ones and sort by timestamp (newest first)
  const allRecommendations = [...aiRecommendations, ...backendRecommendations]
    .sort((a, b) => {
      // Handle cases where timestamp might be missing
      const timestampA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const timestampB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return timestampB - timestampA; // Descending order (newest first)
    });

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

const CallSummarySection = ({ summary }) => {
  return (
    <div className="section-container">
      <div className="section-header">
        <h2>Call Summary</h2>
      </div>
      <div className="section-content">
        {!summary ? (
          <div className="empty-state">
            <p>No summary available</p>
            <small>Summary will appear after the call ends...</small>
          </div>
        ) : (
          <div className="summary-text">
            {summary}
          </div>
        )}
      </div>
    </div>
  );
};

const CallAnalysisSection = ({ analysis }) => {
  let content = null;
  if (!analysis) {
    content = (
      <div className="empty-state">
        <p>No analysis available</p>
        <small>Analysis will appear after the call ends...</small>
      </div>
    );
  } else {
    // Parse analysis if it's a string
    let parsedAnalysis = analysis;
    if (typeof analysis === 'string') {
      try {
        parsedAnalysis = JSON.parse(analysis);
      } catch (e) {
        // If parsing fails, display as raw text
        content = (
          <div className="analysis-text">
            {analysis}
          </div>
        );
      }
    }

    // If we have a parsed object, format it nicely
    if (typeof parsedAnalysis === 'object' && parsedAnalysis !== null) {
      content = (
        <div className="analysis-formatted">
          {parsedAnalysis.task_improvements && (
            <div className="analysis-section">
              <h4>Task Improvements</h4>
              <ul>
                {parsedAnalysis.task_improvements.map((improvement, index) => (
                  <li key={index}>{improvement}</li>
                ))}
              </ul>
            </div>
          )}
          
          {parsedAnalysis.summary && (
            <div className="analysis-section">
              <h4>Summary</h4>
              <p>{parsedAnalysis.summary}</p>
            </div>
          )}
          
          {parsedAnalysis.next_steps && (
            <div className="analysis-section">
              <h4>Next Steps</h4>
              <ul>
                {parsedAnalysis.next_steps.map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ul>
            </div>
          )}
          
          {parsedAnalysis.timeline && (
            <div className="analysis-section">
              <h4>Timeline</h4>
              <p>{parsedAnalysis.timeline}</p>
            </div>
          )}
        </div>
      );
    }
  }
  
  return (
    <div className="section-container">
      <div className="section-header">
        <h2>Call Analysis</h2>
      </div>
      <div className="section-content">
        {content}
      </div>
    </div>
  );
};

function App() {
  const [finalTranscripts, setFinalTranscripts] = useState([]);
  const [aiRecommendations, setAiRecommendations] = useState([]);
  const [backendRecommendations, setBackendRecommendations] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [completedCount, setCompletedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('Connecting...');
  const [lastError, setLastError] = useState(null);
  const [customerNumber, setCustomerNumber] = useState('');
  const [isLoadingCustomerNumber, setIsLoadingCustomerNumber] = useState(true);
  const [customerNumberError, setCustomerNumberError] = useState(null);
  const [callSummary, setCallSummary] = useState('');
  const [callAnalysis, setCallAnalysis] = useState(null);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;

  // Function to load customer number from API
  const loadCustomerNumber = useCallback(async () => {
    try {
      setIsLoadingCustomerNumber(true);
      setCustomerNumberError(null);
      
      const response = await fetch('/api/customer-number');
      const data = await response.json();
      
      if (data.success) {
        setCustomerNumber(data.customerNumber || '');
      } else {
        setCustomerNumberError(data.error || 'Failed to load customer number');
      }
    } catch (error) {
      console.error('Error loading customer number:', error);
      setCustomerNumberError('Failed to load customer number');
    } finally {
      setIsLoadingCustomerNumber(false);
    }
  }, []);

  const connectWebSocket = useCallback(() => {
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
                
                // Check for duplicates based on description content
                const isDuplicate = prev.some(existing => 
                  existing.description === newRecommendation.description
                );
                
                if (isDuplicate) {
                  console.log(`⚠️ [${receiveTime}] Duplicate AI recommendation detected, skipping: "${newRecommendation.description}"`);
                  return prev;
                }
                
                // Keep only last 5 AI recommendations
                const updated = [...prev, newRecommendation];
                return updated.slice(-5);
              });
              break;
              
            case 'backend_recommendations':
              console.log(`📋 [${receiveTime}] BACKEND RECOMMENDATIONS RECEIVED:`, message.data.length, 'items');
              setBackendRecommendations(prev => {
                // Accumulate backend recommendations instead of replacing them
                const newRecommendations = Array.isArray(message.data) ? message.data : [message.data];
                
                // Deduplicate based on title and description to prevent duplicates
                const existingIds = new Set(prev.map(rec => `${rec.title}-${rec.description}`));
                const uniqueNewRecommendations = newRecommendations.filter(rec => {
                  const recId = `${rec.title}-${rec.description}`;
                  if (existingIds.has(recId)) {
                    console.log(`⚠️ [${receiveTime}] Duplicate recommendation detected, skipping: "${rec.title}"`);
                    return false;
                  }
                  existingIds.add(recId);
                  return true;
                });
                
                if (uniqueNewRecommendations.length === 0) {
                  console.log(`📝 [${receiveTime}] No new unique recommendations to add`);
                  return prev;
                }
                
                const updated = [...prev, ...uniqueNewRecommendations];
                // Keep only last 10 backend recommendations
                return updated.slice(-10);
              });
              break;

            case 'call_summary':
              console.log(`🧾 [${receiveTime}] CALL SUMMARY RECEIVED`);
              setCallSummary(message.data && message.data.summary ? message.data.summary : '');
              break;

            case 'call_analysis':
              console.log(`🔎 [${receiveTime}] CALL ANALYSIS RECEIVED`);
              // if analysis is JSON string, try to parse
              if (message.data && message.data.analysis) {
                const analysisPayload = message.data.analysis;
                try {
                  const parsed = typeof analysisPayload === 'string' ? JSON.parse(analysisPayload) : analysisPayload;
                  setCallAnalysis(parsed);
                } catch (e) {
                  setCallAnalysis(typeof analysisPayload === 'string' ? analysisPayload : JSON.stringify(analysisPayload));
                }
              }
              break;
              
            case 'task_list_update':
              console.log(`📋 [${receiveTime}] TASK LIST UPDATE RECEIVED:`, message.data);
              setTasks(message.data.tasksWithStatus || []);
              setCompletedCount(message.data.completedCount || 0);
              setTotalCount(message.data.totalCount || 0);
              break;
              
            case 'clear_transcripts':
              console.log(`🧹 [${receiveTime}] CLEAR TRANSCRIPTS RECEIVED:`, message.data);
              setFinalTranscripts([]);
              console.log(`✅ [${receiveTime}] Transcripts cleared for new call: ${message.data.callSid}`);
              break;
              
            case 'clear_recommendations':
              console.log(`💡 [${receiveTime}] CLEAR RECOMMENDATIONS RECEIVED:`, message.data);
              setAiRecommendations([]);
              setBackendRecommendations([]);
              console.log(`✅ [${receiveTime}] Recommendations cleared for new call: ${message.data.callSid}`);
              break;

            case 'clear_call_insights':
              console.log(`🧹 [${receiveTime}] CLEAR CALL INSIGHTS RECEIVED`);
              setCallSummary('');
              setCallAnalysis(null);
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
  }, []);

  useEffect(() => {
    connectWebSocket();
    loadCustomerNumber();
    
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounting');
      }
    };
  }, [connectWebSocket, loadCustomerNumber]);

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

      <CustomerNumberSection
        customerNumber={customerNumber}
        setCustomerNumber={setCustomerNumber}
        isLoading={isLoadingCustomerNumber}
        error={customerNumberError}
      />

      <main className="main-content">
        <div className="dashboard-grid">
          <div className="task-section">
            <TaskListSection 
              tasks={tasks}
              completedCount={completedCount}
              totalCount={totalCount}
            />
          </div>
          <div className="recommendations-section">
            <RecommendationsSection 
              aiRecommendations={aiRecommendations} 
              backendRecommendations={backendRecommendations} 
            />
          </div>
          <div className="insights-column">
            <div className="insight half">
              <CallSummarySection summary={callSummary} />
            </div>
            <div className="insight half">
              <CallAnalysisSection analysis={callAnalysis} />
            </div>
          </div>
          {/* <div className="transcription-section">
            <TranscriptionSection finalTranscripts={finalTranscripts} />
          </div> */}
        </div>
      </main>
    </div>
  );
}

export default App; 