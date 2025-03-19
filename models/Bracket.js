const mongoose = require('mongoose');

const BracketSchema = new mongoose.Schema({
  userEmail: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  participantName: {
    type: String,
    required: true,
    trim: true
  },
  contact: {
    type: String,
    required: false,
    trim: true
  },
  editToken: {
    type: String,
    required: true,
    unique: true
  },
  entryNumber: {
    type: Number,
    default: 1
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  isLocked: {
    type: Boolean,
    default: false
  },
  picks: {
    type: Object,
    required: true
  },
  score: {
    type: Number,
    default: 0
  }
});

module.exports = mongoose.model('Bracket', BracketSchema);