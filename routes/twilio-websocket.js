const express = require('express');
const expressWs = require('express-ws');
const twilio = require('twilio');
const Call = require('../models/Call');
const redisClient = require('../config/redis');
const OpenAI = require('openai');

const router = express.Router();

// Add WebSocket support to this router
expressWs(router);
const VoiceResponse = twilio.twiml.VoiceResponse;

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Global task management
const TASKS = [
  'Confirm customer name.',
  "Confirm customer's phone number.", 
  'Ask how they heard about us.',
  'Ask what type of car customer is interested in.',
  'Propose a test drive.'
];

let completedTasks = [];

// Reset completed tasks for new calls
const resetTasksForCall = (callSid) => {
  completedTasks = [];
 // console.log(`🔄 [${callSid}] Tasks reset for new call`);
};

// Method to check task completion using OpenAI
async function checkTaskCompletion(callSid, broadcastToDashboard) {
  try {
   // console.log(`📋 [${callSid}] Checking task completion...`);

    // Get transcript data from Redis
    let transcripts = [];
    try {
      const redisData = await redisClient.lRange(callSid, 0, -1);
      transcripts = redisData.map(item => JSON.parse(item));
     // console.log(`📝 [${callSid}] Retrieved ${transcripts.length} transcripts for task analysis`);
    } catch (redisError) {
      console.error(`❌ [${callSid}] Redis retrieval error:`, redisError.message);
      return;
    }
    const transcriptText = await buildTranscriptText(callSid);
    if (transcripts.length === 0) {
     // console.log(`⚠️ [${callSid}] No conversation data found for task checking`);
      return;
    }

    // Format conversation for OpenAI
    const conversationHistory = transcripts.map(transcript => {
      return `${transcript.role === 'agent' ? 'Agent' : 'Customer'}: ${transcript.text}`;
    }).join('\n');

    // Create prompt to check task completion
    const tasksToCheck = TASKS.filter(task => !completedTasks.includes(task));
    
    if (tasksToCheck.length === 0) {
     // console.log(`✅ [${callSid}] All tasks already completed`);
      return;
    }

    const prompt = `You are an AI assistant analyzing transcript of a phone conversation to determine if specific tasks in the TASKS LIST have been completed by the SDR/Agent.
Based on the CONVERSATION HISTORY below, determine which of these tasks have been completed:
**TASKS LIST**:
${tasksToCheck.map((task, index) => `${index + 1}. ${task}`).join('\n')}
**CONVERSATION HISTORY**:
${transcriptText}
Return ONLY a JSON array of task numbers (1, 2, 3, etc.) that have been CLEARLY completed in the conversation. If a task is not completed or only partially addressed, do not include it.
Example response: [1, 3] (if tasks 1 and 3 are completed)
Response:`

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a precise AI assistant that analyzes conversations to determine task completion. Only return completed task numbers in JSON array format."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 100,
        temperature: 0.1,
      });

      const aiResponse = completion.choices[0].message.content.trim();
     console.log(`\n\n\n\n\n\n🤖 [${callSid}] Task completion AI response: ${aiResponse}`);

      // Parse AI response
      try {
        // Extract JSON array from response
        const jsonMatch = aiResponse.match(/\[([\d,\s]*)\]/);
        if (jsonMatch) {
          const completedTaskNumbers = JSON.parse(jsonMatch[0]);
          
          // Convert task numbers to actual task names
          const newlyCompletedTasks = completedTaskNumbers.map(num => tasksToCheck[num - 1]).filter(Boolean);
          
          if (newlyCompletedTasks.length > 0) {
            // Update global completed tasks
            completedTasks = [...new Set([...completedTasks, ...newlyCompletedTasks])];
          console.log(`*******Prompts*****`, prompt);
           console.log(`✅ [${callSid}] Newly completed tasks:`, newlyCompletedTasks);
           console.log(`📊 [${callSid}] Total completed tasks:`, completedTasks);

            // Broadcast updated task list
            broadcastTaskList(callSid, broadcastToDashboard);
          } else {
           // console.log(`📝 [${callSid}] No new tasks completed`);
          }
        }
      } catch (parseError) {
        console.error(`❌ [${callSid}] Failed to parse task completion response:`, parseError);
      }

    } catch (openaiError) {
      console.error(`❌ [${callSid}] OpenAI API error for task checking:`, openaiError.message);
    }

  } catch (error) {
    console.error(`❌ [${callSid}] Task completion check error:`, error);
  }
}

// Broadcast current task list status
function broadcastTaskList(callSid, broadcastToDashboard) {
  try {
    const tasksWithStatus = TASKS.map(task => {
      const status = completedTasks.includes(task) ? 'completed' : 'pending';
      return { task, status };
    });

    if (broadcastToDashboard) {
      broadcastToDashboard({
        type: 'task_list_update',
        data: {
          callSid,
          tasksWithStatus,
          completedCount: completedTasks.length,
          totalCount: TASKS.length,
          timestamp: new Date().toISOString()
        }
      });
     // console.log(`📡 [${callSid}] Task list broadcasted - ${completedTasks.length}/${TASKS.length} completed`);
    }
  } catch (error) {
    console.error(`❌ [${callSid}] Error broadcasting task list:`, error);
  }
}

// Build call plan text
function buildCallPlanText() {
  return TASKS.map((task, idx) => `${idx + 1}. ${task}`).join('\n');
}

// Build conversation transcript text from Redis
async function buildTranscriptText(callSid) {
  try {
    const redisData = await redisClient.lRange(callSid, 0, -1);
    const transcripts = redisData.map(item => JSON.parse(item));
    return transcripts
      .map(t => `${(t.role || '').toLowerCase() === 'agent' ? 'SDR' : 'Customer'}: ${t.text}`)
      .join('\n');
  } catch (e) {
    console.error(`❌ [${callSid}] Failed to build transcript text:`, e.message);
    return '';
  }
}

// Generate Call Summary
async function generateCallSummary(callSid) {
  try {
    const callPlan = buildCallPlanText();
    const transcriptText = await buildTranscriptText(callSid);
    if (!transcriptText) return '';

    const userPrompt = `You are an SDR and writing a call summary after a call you had with a customer. The CALL TRANSCRIPT is provided to you. Also the CALL PLAN is provided to you. Summarize the transcript, clearly outlining Next Steps and timelines (if any). If any information required by the CALL PLAN is missing, then state that too.

**CALL PLAN**
${callPlan}
 
**CALL TRANSCRIPT**
${transcriptText}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a concise assistant. Provide a crisp but comprehensive summary. Keep it under 180 words.' },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 300
    });
    return (completion.choices?.[0]?.message?.content || '').trim();
  } catch (e) {
    console.error(`❌ [${callSid}] Error generating call summary:`, e.message);
    return '';
  }
}

// Generate Call Analysis (JSON preferred)
async function generateCallAnalysis(callSid) {
  try {
    const callPlan = buildCallPlanText();
    const transcriptText = await buildTranscriptText(callSid);
    if (!transcriptText) return '';

    const userPrompt = `You are a Sales Coach and revieweing the TRANSCRIPT of an exchange between the SDR and a customer. To perform the analysis, you are provided a CALL PLAN and SALES PLAYBOOK ADDITIONAL INFORMATION. First, you evaluate the transcript against the CALL PLAN,to ensure that each step in the CALL PLAN was completed. If the SDR missed any of the step, then you make a note of it. Then you review the transcript in light of CALL PLAN and SALES PLAYBOOK ADDITIONAL INFORMATION to provide additional guidance to the SDR. Your output contains the following sections: Summary, Missed Actions, Feedback. If no action was missed then you state the fact that no action was missed.    
 
**CALL PLAN**
${callPlan}
 
**TRANSCRIPT**:
${transcriptText}
 
**SALES PLAYBOOK ADDITIONAL INFORMATION**:
    Dealership Product/Service Information:
    Shop happy With our happiness guarantee, you've got 7 days (up to 250 mi) to fall in love with your dream ride or we want it back.
    Instant cash offer on your old car & walk away with a check. Better yet—use your trade-in to lower your payment on a new ride.
    Get financing Once you've found your dream ride, we can help you save time at the store by getting approved for a loan online.
    All of our cars come with our Happiness Guarantee: Love it or we want it back. If you change your mind about your car purchase within 7 days or 250 miles (whichever comes first), simply return the car in the same condition for a refund of the purchase price.
    Open 7 days a week from 8am to 7pm
    Objection Handling examples:
    Objection 1: “what if I change my mind”
    Response 1: All of our cars come with our Happiness Guarantee: Love it or we want it back.
    Objection 2: “why are your prices so low?”
    Response 2: we've built our reputation on honesty and fair pricing guarantee.
    Objection 3: “how does your trade-in process work?”
    Response 3: You can get an instant offer online or bring your car and get an appraisal that's good for 7 days or 500 miles, whichever comes first. You can choose to apply your offer towards a new car or well cut you a check—your choice!
    Objection 4: “how do I know I'm getting a good offer on my trade in?”
    Response 4: We don't just look at the local market to give you an online offer. We compare pricing across the country, allowing us the opportunity to give you a great offer for your trade.
    Objection 5: “can I test-drive before I buy?”
    Response 5: We always encourage guests to check out their car before they buy. You also get 7 days or 250 miles (whichever comes first) to make sure you love your car. Try it out on your commute or see if the kids' car seats fit . . . make sure it's right for you. If not, we'll take it back and refund the purchase price.
    Objection 6: “what if I need a loan to buy?”
    Response 6: We have a nationwide network of lenders, and our team will work to help you secure financing. If you don't automatically get qualified online, one of our Finance Team can help you secure alternative finance options.
    Sales Call Discovery question examples:
    May I ask what sparked you into considering buying a car?
    Are you replacing your vehicle?
    Are there any specific makes or models you are interested in?
    What features are you looking for in your next vehicle?
    Is there anything you dislike about your current vehicle?
    Do you typically drive with kids or pets in the car?
    Do you need space for hauling items or carrying hobby or work equipment?
    What are the top 3 things you'd love to see in your new vehicle?
    How soon do you need a new vehicle?
    Are you interested in trading in your current vehicle? Would you be interested in looking at pre-owned vehicles?
    Who will be driving the vehicle most?
    Have you been to other dealerships?
    Do you have a specific price range you wish to stay in?
    May I ask what kept you from purchasing a car there?
    How are you enjoying your car?
    Is there anything about your vehicle experience that you wish was better?
    How many miles have you driven so far?
    How are you finding the space and comfort?
    Have you noticed anything that you would like us to investigate?
    Have you considered the extended warranty?`
    
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Return only valid JSON. No markdown. No surrounding text.' },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.2,
      max_tokens: 600
    });
    const content = (completion.choices?.[0]?.message?.content || '').trim();
    return content;
  } catch (e) {
    console.error(`❌ [${callSid}] Error generating call analysis:`, e.message);
    return '';
  }
}

// Handle incoming calls
router.post('/voice', async (req, res) => {
  const timestamp = new Date().toISOString();
  
  try {
    const twiml = new VoiceResponse();
    const callSid = req.body.CallSid || `test-${Date.now()}`;
    const callerNumber = req.body.From || 'Unknown';
    // const targetNumber = process.env.TARGET_PHONE_NUMBER;`
    const targetNumber = await redisClient.get('TARGET_PHONE_NUMBER');

    
    // Reset tasks for new call
    resetTasksForCall(callSid);
    
    // Broadcast reset task list for new call
    broadcastTaskList(callSid, req.broadcastToDashboard);
    
    // Broadcast message to clear transcripts for new call
    if (req.broadcastToDashboard) {
      req.broadcastToDashboard({
        type: 'clear_transcripts',
        data: {
          callSid: callSid,
          message: 'New call initiated - clearing previous transcripts',
          timestamp: timestamp
        }
      });
     // console.log(`🧹 [${callSid}] Broadcast clear transcripts message sent to dashboard`);
      
      // Broadcast message to clear recommendations for new call
      req.broadcastToDashboard({
        type: 'clear_recommendations',
        data: {
          callSid: callSid,
          message: 'New call initiated - clearing previous recommendations',
          timestamp: timestamp
        }
      });
     // console.log(`💡 [${callSid}] Broadcast clear recommendations message sent to dashboard`);

      // Broadcast message to clear previous call insights
      req.broadcastToDashboard({
        type: 'clear_call_insights',
        data: {
          callSid: callSid,
          message: 'New call initiated - clearing previous call insights',
          timestamp: timestamp
        }
      });
     // console.log(`🧼 [${callSid}] Broadcast clear call insights message sent to dashboard`);
    }

    // Create call record in database (only if MongoDB is available)
    try {
      const call = new Call({
        callSid: callSid,
        callerNumber: callerNumber,
        targetNumber: targetNumber,
        status: 'initiated'
      });
      await call.save();
    } catch (dbError) {
     console.log(`⚠️  [${callSid}] MongoDB save failed:`, dbError.message);
    }

    // Start real-time transcription stream FIRST (before dial)
    const protocol = req.secure ? 'wss' : 'wss'; // Force wss for ngrok
    const host = req.get('host');
    const streamUrl = `${protocol}://${host}/api/twilio/media-stream`;
    
    // Debug: Check if this is a real Twilio call
    const isRealTwilioCall = req.headers['user-agent'] && req.headers['user-agent'].includes('TwilioProxy');
    
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

    res.type('text/xml');
    res.send(twimlResponse);
  } catch (error) {
    console.error(`❌ [WEBHOOK] Error processing voice webhook:`, error);
    console.error('Error stack:', error.stack);
    res.status(500).send('Error processing call');
  }
});





// Helper method to generate contextual recommendations based on conversation
async function generateRecommendation(callSid, broadcastToDashboard) {
  try {

    // Get transcript data from Redis
    let transcripts = [];
    try {
      const redisData = await redisClient.lRange(callSid, 0, -1);
      transcripts = redisData.map(item => JSON.parse(item));
    } catch (redisError) {
      console.error(`❌ [${callSid}] Redis retrieval error:`, redisError.message);
      return;
    }

    //get recommendations from redis
    let previousRecommendations = [];
    try {
      const redisData = await redisClient.lRange(`${callSid}_recommendations`, 0, -1);
      previousRecommendations = redisData.map(item => JSON.parse(item));
     // console.log(`📋 [${callSid}] Retrieved ${previousRecommendations.length} recommendation batches from Redis`);
    } catch (redisError) {
      console.error(`❌ [${callSid}] Redis retrieval error:`, redisError.message);
      // return;
    }

    // Build a set of existing recommendation titles (case-insensitive, trimmed)
    const existingTitles = new Set();
    try {
      previousRecommendations.forEach(batch => {
        const arr = Array.isArray(batch) ? batch : [batch];
        arr.forEach(rec => {
          if (rec && rec.title) {
            existingTitles.add(String(rec.title).trim().toLowerCase());
          }
        });
      });
    } catch (titleSetError) {
      console.warn(`⚠️ [${callSid}] Could not build existing titles set:`, titleSetError.message);
    }

    if (transcripts.length === 0) {
      return;
    }

    // Format conversation for OpenAI
    const conversationHistory = transcripts.map(transcript => {
      return `${transcript.role === 'agent' ? 'Agent' : 'Customer'}: ${transcript.text}`;
    }).join('\n');


    // Create OpenAI prompt for multiple contextual recommendations
    const prompt = `You are an AI assistant helping a customer service agent during a real-time phone conversation.
 
Based on the TASKS LIST, CONVERSATION HISTORY, PREVIOUS RECOMMENDATIONS and using SALES PLAYBOOK ADDITIONAL INFORMATION where applicable, provide specific, actionable recommendations for the agent. Each recommendation should be:
    - Professional and empathetic
    - Relevant to both the current conversation context and the goals of the Call Template
    - Focused on helping resolve the customer's needs and the goals of the Call Template
    - Clear, concise, and actionable
    - Max of 1-2 sentences each
 
**TASKS LIST**:
${JSON.stringify(TASKS)}
 
**PREVIOUS RECOMMENDATIONS**
${JSON.stringify(previousRecommendations)}
 
You do not need to provide recommendation every time. If in your professional judgement, you have already provided the recommendation for the discussion so far or you don’t feel the need for additional recommendation as the agent is doing fine, just provide an empty Array response [].
     
**SALES PLAYBOOK ADDITIONAL INFORMATION**:
    Dealership Product/Service Information:
    Shop happy With our happiness guarantee, you've got 7 days (up to 250 mi) to fall in love with your dream ride or we want it back.
    Instant cash offer on your old car & walk away with a check. Better yet—use your trade-in to lower your payment on a new ride.
    Get financing Once you've found your dream ride, we can help you save time at the store by getting approved for a loan online.
    All of our cars come with our Happiness Guarantee: Love it or we want it back. If you change your mind about your car purchase within 7 days or 250 miles (whichever comes first), simply return the car in the same condition for a refund of the purchase price.
    Open 7 days a week from 8am to 7pm
    Objection Handling examples:
    Objection 1: “what if I change my mind”
    Response 1: All of our cars come with our Happiness Guarantee: Love it or we want it back.
    Objection 2: “why are your prices so low?”
    Response 2: we've built our reputation on honesty and fair pricing guarantee.
    Objection 3: “how does your trade-in process work?”
    Response 3: You can get an instant offer online or bring your car and get an appraisal that's good for 7 days or 500 miles, whichever comes first. You can choose to apply your offer towards a new car or well cut you a check—your choice!
    Objection 4: “how do I know I'm getting a good offer on my trade in?”
    Response 4: We don't just look at the local market to give you an online offer. We compare pricing across the country, allowing us the opportunity to give you a great offer for your trade.
    Objection 5: “can I test-drive before I buy?”
    Response 5: We always encourage guests to check out their car before they buy. You also get 7 days or 250 miles (whichever comes first) to make sure you love your car. Try it out on your commute or see if the kids' car seats fit . . . make sure it's right for you. If not, we'll take it back and refund the purchase price.
    Objection 6: “what if I need a loan to buy?”
    Response 6: We have a nationwide network of lenders, and our team will work to help you secure financing. If you don't automatically get qualified online, one of our Finance Team can help you secure alternative finance options.
    Sales Call Discovery question examples:
    May I ask what sparked you into considering buying a car?
    Are you replacing your vehicle?
    Are there any specific makes or models you are interested in?
    What features are you looking for in your next vehicle?
    Is there anything you dislike about your current vehicle?
    Do you typically drive with kids or pets in the car?
    Do you need space for hauling items or carrying hobby or work equipment?
    What are the top 3 things you'd love to see in your new vehicle?
    How soon do you need a new vehicle?
    Are you interested in trading in your current vehicle? Would you be interested in looking at pre-owned vehicles?
    Who will be driving the vehicle most?
    Have you been to other dealerships?
    Do you have a specific price range you wish to stay in?
    May I ask what kept you from purchasing a car there?
    How are you enjoying your car?
    Is there anything about your vehicle experience that you wish was better?
    How many miles have you driven so far?
    How are you finding the space and comfort?
    Have you noticed anything that you would like us to investigate?
    Have you considered the extended warranty?
     Any recommendation based on TASK LIST has a high priority. Any recommendation based on SALES PLAYBOOK ADDITIONAL INFORMATION is medium priority. Any other recommendation is Low priority. 
 
    Return the recommendations in this exact JSON format:
    [
     {
       "title": "Specific Action Title",
       "description": "Clear description of what to do",
       "priority": "high/medium/low",
       "type": "suggestion/reminder/tip/action"
     }
    ]
     ***note: as you are providing realtime suggestions, so you should suggest only one recommendation at a time.***
     
    **CONVERSATION HISTORY**:
    ${conversationHistory}`;

    // Call OpenAI API
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a helpful AI assistant providing real-time suggestions to customer service agents during phone conversations. Always respond with valid JSON."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 500,
        temperature: 0.7,
      });

      const aiResponse = completion.choices[0].message.content.trim();
      
      // Parse AI response
      let recommendations = [];
      try {
        // Extract JSON from response (handle cases where AI adds extra text)
        const jsonStart = aiResponse.indexOf('[');
        const jsonEnd = aiResponse.lastIndexOf(']') + 1;
        if (jsonStart !== -1 && jsonEnd !== -1) {
          const jsonStr = aiResponse.substring(jsonStart, jsonEnd);
          const parsedRecommendations = JSON.parse(jsonStr);
          
          // Format recommendations for frontend
          recommendations = parsedRecommendations.map((rec, index) => ({
            id: Date.now() + index,
            type: rec.type || 'suggestion',
            title: rec.title,
            description: rec.description,
            priority: rec.priority || 'medium',
            timestamp: new Date().toISOString(),
            callSid: callSid,
            source: 'contextual_ai'
          }));
        }
      } catch (parseError) {
        console.error(`❌ [${callSid}] Failed to parse AI recommendations:`, parseError);
        // Fallback: create single recommendation from raw response
        recommendations = [{
          id: Date.now(),
          type: 'suggestion',
          title: 'AI Suggestion',
          description: aiResponse.length > 200 ? aiResponse.substring(0, 200) + '...' : aiResponse,
          priority: 'high',
          timestamp: new Date().toISOString(),
          callSid: callSid,
          source: 'contextual_ai'
        }];
      }

      // Deduplicate by title against existing Redis titles and within current batch
      const seenTitles = new Set();
      const filteredRecommendations = recommendations.filter(rec => {
        const titleKey = String(rec.title || '').trim().toLowerCase();
        if (!titleKey) return false;
        if (existingTitles.has(titleKey)) return false;
        if (seenTitles.has(titleKey)) return false;
        seenTitles.add(titleKey);
        return true;
      });

      if (filteredRecommendations.length > 0) {
       // console.log(`✅ [${callSid}] Generated ${filteredRecommendations.length} new, unique contextual recommendations`);
        // Store recommendations in Redis
        try {
          await redisClient.rPush(`${callSid}_recommendations`, JSON.stringify(filteredRecommendations));
         // console.log(`🗄️ [${callSid}] Unique recommendations stored in Redis`);
        } catch (redisError) {
          console.error(`❌ [${callSid}] Redis storage error:`, redisError.message);
        }

        // Broadcast contextual recommendations to dashboard
        if (broadcastToDashboard) {
          broadcastToDashboard({
            type: 'backend_recommendations',
            data: filteredRecommendations
          });
        }
      } else {
        //// console.log(`⚠️ [${callSid}] All generated recommendations are duplicates by title; skipping store and broadcast`);
      }

    } catch (openaiError) {
      console.error(`❌ [${callSid}] OpenAI API error:`, openaiError.message);
    }

  } catch (error) {
    console.error(`❌ [${callSid}] Recommendation generation error:`, error);
  }
}

// Handle call status updates
router.post('/call-status', async (req, res) => {
  try {
    const callSid = req.body.ParentCallSid;
    const callStatus = req.body.CallStatus;
    const duration = req.body.CallDuration;


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

    // If call completed, generate and broadcast summary & analysis
    if (callStatus === 'completed' && req.broadcastToDashboard) {
      try {
        const [summaryText, analysisJson] = await Promise.all([
          generateCallSummary(callSid),
          generateCallAnalysis(callSid)
        ]);

        if (summaryText) {
          req.broadcastToDashboard({
            type: 'call_summary',
            data: {
              callSid,
              summary: summaryText,
              timestamp: new Date().toISOString()
            }
          });
         // console.log(`🧾 [${callSid}] Call summary broadcasted`);
        }

        if (analysisJson) {
          req.broadcastToDashboard({
            type: 'call_analysis',
            data: {
              callSid,
              analysis: analysisJson,
              timestamp: new Date().toISOString()
            }
          });
         // console.log(`🔎 [${callSid}] Call analysis broadcasted`);
        }
      } catch (e) {
        console.error(`❌ [${callSid}] Failed to generate/broadcast call insights:`, e.message);
      }
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
    
   // console.log(`📹 [${callSid}] Recording available: ${recordingUrl}`);
    
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

    const { 
      TranscriptionSid,
      CallSid, 
      TranscriptionData,
      TranscriptionEvent,
      Final,
      Track
    } = req.body;

    
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
      
     // console.log(`📝 [${CallSid}] Track: ${Track}, Text: "${transcript}" (confidence: ${confidence}, final: ${Final})`);
      
      // Store transcript in database if it's final (not partial)
      if (Final === 'true') {
        try {
          // Create unique identifier for deduplication
          const transcriptId = `${CallSid}-${Track}-${transcript}-${timestamp}`;
          
          // Check if we've already processed this exact transcript
          if (recentTranscripts.has(transcriptId)) {
           // console.log(`⚠️ [${CallSid}] Duplicate transcript detected, skipping broadcast: "${transcript}"`);
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
          const storeInRedis = {
            text: transcript,
            role: Track === 'inbound_track' ? 'agent' : 'customer',
            timestamp: timestamp
          }

          // Store transcript in Redis using RPUSH with CallSid as key
          try {
            await redisClient.rPush(CallSid, JSON.stringify(storeInRedis));
           // console.log(`🗄️ [${CallSid}] Transcript stored in Redis - Role: ${storeInRedis.role}, Text: "${transcript}"`);
          } catch (redisError) {
            console.error(`❌ [${CallSid}] Redis RPUSH error:`, redisError.message);
          }

          req.broadcastToDashboard(transcriptData);
         // console.log(`📡 [${CallSid}] Transcript broadcasted to dashboard`);


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
         // console.log(`💾 [${CallSid}] Final transcript saved to database - Track: ${Track}, Text: "${transcript}"`);
          
          // Generate AI recommendation and check task completion when customer finishes speaking
          if (Track === 'outbound_track') {
           // console.log(`🎯 [${CallSid}] Customer finished speaking, generating AI recommendation and checking tasks...`);
            
            // Call recommendation method asynchronously (don't wait for it)
            generateRecommendation(CallSid, req.broadcastToDashboard).catch(error => {
              console.error(`❌ [${CallSid}] Failed to generate recommendation:`, error);
            });
          }

          if(Track === 'inbound_track') {
            // Check task completion asynchronously (don't wait for it)
            checkTaskCompletion(CallSid, req.broadcastToDashboard).catch(error => {
              console.error(`❌ [${CallSid}] Failed to check task completion:`, error);
            });
          }
          
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
      
      if (msg.event === 'connected') {
      } else if (msg.event === 'start') {
        callSid = msg.start.callSid;
        isStreamActive = true;
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
         // console.log(`🔧 [${callSid}] Initializing Deepgram connection...`);
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
         // console.log(`🎤 [${callSid}] Audio packet #${audioPacketCount} - Payload size: ${msg.media.payload ? msg.media.payload.length : 0} chars`);
        }
        
        // Forward audio data to Deepgram
        if (deepgramConnection && msg.media.payload && isStreamActive) {
          try {
            const audioBuffer = Buffer.from(msg.media.payload, 'base64');
            deepgramConnection.send(audioBuffer);
            
            // Log every 100th audio forward
            if (audioPacketCount % 100 === 1) {
             // console.log(`📤 [${callSid}] Audio forwarded to Deepgram - Buffer size: ${audioBuffer.length} bytes`);
            }
          } catch (error) {
            console.error(`❌ [${callSid}] Error sending audio to Deepgram:`, error);
          }
        } else {
          if (audioPacketCount % 50 === 1) {
           // console.log(`⚠️  [${callSid}] Audio not forwarded - DG: ${!!deepgramConnection}, Payload: ${!!msg.media.payload}, Active: ${isStreamActive}`);
          }
        }
        
      } else if (msg.event === 'stop') {
       // console.log(`\n🛑 [${callSid}] MEDIA STREAM STOPPED`);
       // console.log(`📊 [${callSid}] Stream stats - Messages: ${messageCount}, Audio packets: ${audioPacketCount}`);
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
        
        // Generate and broadcast call summary & analysis when media stream stops
        if (req.broadcastToDashboard && callSid) {
         // console.log(`🧾 [${callSid}] Generating call summary and analysis after media stream stop...`);
          try {
            const [summaryText, analysisJson] = await Promise.all([
              generateCallSummary(callSid),
              generateCallAnalysis(callSid)
            ]);

            if (summaryText) {
              req.broadcastToDashboard({
                type: 'call_summary',
                data: {
                  callSid,
                  summary: summaryText,
                  timestamp: new Date().toISOString()
                }
              });
             // console.log(`🧾 [${callSid}] Call summary broadcasted from media stream stop`);
            }

            if (analysisJson) {
              req.broadcastToDashboard({
                type: 'call_analysis',
                data: {
                  callSid,
                  analysis: analysisJson,
                  timestamp: new Date().toISOString()
                }
              });
             // console.log(`🔎 [${callSid}] Call analysis broadcasted from media stream stop`);
            }
          } catch (e) {
            console.error(`❌ [${callSid}] Failed to generate/broadcast call insights from media stream stop:`, e.message);
          }
        }
        
        if (deepgramConnection) {
          try {
            deepgramConnection.finish();
           // console.log(`✅ [${callSid}] Deepgram connection finished gracefully`);
          } catch (error) {
            console.error(`❌ [${callSid}] Error finishing Deepgram connection:`, error);
          }
        }
      } else {
       // console.log(`🔍 [${callSid}] Unknown media event: ${msg.event}`, msg);
      }
    } catch (error) {
      console.error(`❌ [${callSid}] Error processing media WebSocket message:`, error);
      console.error('Raw message:', message.toString());
    }
  });

  ws.on('close', async (code, reason) => {
   // console.log(`\n🔌 [${callSid}] MEDIA WEBSOCKET CLOSED`);
   // console.log(`   - Code: ${code}`);
   // console.log(`   - Reason: ${reason}`);
   // console.log(`   - Total messages: ${messageCount}`);
   // console.log(`   - Audio packets: ${audioPacketCount}`);
    
    isStreamActive = false;
    
    // Generate and broadcast call summary & analysis when WebSocket closes (fallback)
    if (req.broadcastToDashboard && callSid && audioPacketCount > 0) {
     // console.log(`🧾 [${callSid}] Generating call summary and analysis after WebSocket close...`);
      try {
        const [summaryText, analysisJson] = await Promise.all([
          generateCallSummary(callSid),
          generateCallAnalysis(callSid)
        ]);

        if (summaryText) {
          req.broadcastToDashboard({
            type: 'call_summary',
            data: {
              callSid,
              summary: summaryText,
              timestamp: new Date().toISOString()
            }
          });
         // console.log(`🧾 [${callSid}] Call summary broadcasted from WebSocket close`);
        }

        if (analysisJson) {
          req.broadcastToDashboard({
            type: 'call_analysis',
            data: {
              callSid,
              analysis: analysisJson,
              timestamp: new Date().toISOString()
            }
          });
         // console.log(`🔎 [${callSid}] Call analysis broadcasted from WebSocket close`);
        }
      } catch (e) {
        console.error(`❌ [${callSid}] Failed to generate/broadcast call insights from WebSocket close:`, e.message);
      }
    }
    
    if (deepgramConnection) {
      try {
        deepgramConnection.finish();
       // console.log(`✅ [${callSid}] Deepgram connection cleaned up`);
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

// Test endpoint to manually trigger summary and analysis
router.post('/test-summary/:callSid', async (req, res) => {
  const { callSid } = req.params;
 // console.log(`🧪 [${callSid}] Manual test trigger for summary and analysis`);
  
  try {
    const [summaryText, analysisJson] = await Promise.all([
      generateCallSummary(callSid),
      generateCallAnalysis(callSid)
    ]);

    if (req.broadcastToDashboard) {
      if (summaryText) {
        req.broadcastToDashboard({
          type: 'call_summary',
          data: {
            callSid,
            summary: summaryText,
            timestamp: new Date().toISOString()
          }
        });
       // console.log(`🧾 [${callSid}] Test call summary broadcasted`);
      }

      if (analysisJson) {
        req.broadcastToDashboard({
          type: 'call_analysis',
          data: {
            callSid,
            analysis: analysisJson,
            timestamp: new Date().toISOString()
          }
        });
       // console.log(`🔎 [${callSid}] Test call analysis broadcasted`);
      }
    }

    res.json({
      success: true,
      summary: summaryText,
      analysis: analysisJson
    });
  } catch (error) {
    console.error(`❌ [${callSid}] Test summary/analysis failed:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;