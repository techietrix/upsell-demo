const mongoose = require('mongoose');

const transcriptSchema = new mongoose.Schema({
  number: {
    type: String,
    required: true
  },
  text: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  track: {
    type: String,
    required: true
  },
  role: {
    type: String,
    required: true
  }
});

const callSchema = new mongoose.Schema({
  callSid: {
    type: String,
    required: true,
    unique: true
  },
  callerNumber: {
    type: String,
    required: true
  },
  targetNumber: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['initiated', 'in-progress', 'completed', 'failed'],
    default: 'initiated'
  },
  transcripts: [transcriptSchema],
  startTime: {
    type: Date,
    default: Date.now
  },
  endTime: {
    type: Date
  },
  duration: {
    type: Number // in seconds
  },
  recordingUrl: {
    type: String
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Call', callSchema); 