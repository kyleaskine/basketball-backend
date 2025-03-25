const mongoose = require('mongoose');

const TournamentAnalysisSchema = new mongoose.Schema({
  timestamp: {
    type: Date,
    default: Date.now,
    required: true
  },
  stage: {
    type: String,
    enum: ['sweet16', 'elite8', 'final4', 'championship'],
    required: true
  },
  totalBrackets: {
    type: Number,
    required: true
  },
  totalPossibleOutcomes: {
    type: Number,
    required: true
  },
  roundName: {
    type: String,
    required: true
  },
  currentRound: {
    type: Number,
    required: true
  },
  // Store the top contenders
  topContenders: [{
    id: String,
    participantName: String,
    entryNumber: Number,
    currentScore: Number,
    winPercentage: Number,
    maxScore: Number
  }],
  // Store podium contenders
  podiumContenders: [{
    id: String,
    participantName: String,
    entryNumber: Number,
    currentScore: Number,
    placePercentages: {
      1: Number,
      2: Number,
      3: Number,
      podium: Number
    }
  }],
  // Store brackets with highest ceilings
  highestCeilings: [{
    id: String,
    participantName: String,
    entryNumber: Number,
    currentScore: Number,
    maxScore: Number
  }],
  // Store most volatile brackets
  mostVolatile: [{
    id: String,
    participantName: String,
    entryNumber: Number,
    currentScore: Number,
    minScore: Number,
    maxScore: Number
  }],
  // Store Cinderella teams
  cinderellaTeams: [{
    name: String,
    seed: Number
  }],
  // Store championship picks
  championshipPicks: [{
    team: String,
    count: Number,
    percentage: Number
  }],
  // Store bracket outcomes
  bracketOutcomes: {
    sweet16: [{
      key: String,
      count: Number,
      percentage: Number
    }],
    finalFour: [{
      key: String,
      count: Number,
      percentage: Number
    }],
    championship: [{
      key: String,
      count: Number,
      percentage: Number
    }]
  },
  // Store complete results for all brackets
  bracketResults: {
    type: Object,
    select: false // Don't return this by default as it could be large
  }
});

// Create indexes for efficient querying
TournamentAnalysisSchema.index({ stage: 1, timestamp: -1 });

module.exports = mongoose.model('TournamentAnalysis', TournamentAnalysisSchema);