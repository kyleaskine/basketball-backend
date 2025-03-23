// models/NcaaUpdateLog.js
const mongoose = require('mongoose');

const NcaaUpdateLogSchema = new mongoose.Schema({
  runDate: {
    type: Date,
    default: Date.now,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'success', 'error', 'no_updates', 'complete_for_day'],
    required: true
  },
  trackedGames: [{
    gameId: String,
    matchupId: Number,
    homeTeam: String,
    awayTeam: String,
    region: String,
    round: String,
    completed: {
      type: Boolean,
      default: false
    },
    score: {
      homeScore: Number,
      awayScore: Number
    },
    updatedInDb: {
      type: Boolean,
      default: false
    }
  }],
  completedGames: {
    type: Number,
    default: 0
  },
  totalTrackedGames: {
    type: Number,
    default: 0
  },
  updatedCount: {
    type: Number,
    default: 0
  },
  allGamesComplete: {
    type: Boolean,
    default: false
  },
  errors: [{
    message: String,
    stack: String,
    gameId: String
  }],
  logs: [String]
});

// Add method to add a log entry
NcaaUpdateLogSchema.methods.addLog = function(message) {
  const timestamp = new Date().toISOString();
  this.logs.push(`[${timestamp}] ${message}`);
};

// Add method to update a tracked game
NcaaUpdateLogSchema.methods.updateTrackedGame = function(gameId, updates) {
  const gameIndex = this.trackedGames.findIndex(g => g.gameId === gameId);
  if (gameIndex !== -1) {
    for (const [key, value] of Object.entries(updates)) {
      this.trackedGames[gameIndex][key] = value;
    }
    
    // Count completed games
    this.completedGames = this.trackedGames.filter(g => g.completed).length;
    
    // Check if all games are complete
    this.allGamesComplete = this.completedGames === this.totalTrackedGames;
    
    return true;
  }
  return false;
};

module.exports = mongoose.model('NcaaUpdateLog', NcaaUpdateLogSchema);