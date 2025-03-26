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
  // Store all podium contenders
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
    },
    minPlace: Number,
    maxPlace: Number
  }],
  // New fields
  playersWithNoPodiumChance: {
    type: Number,
    default: 0
  },
  playersWithWinChance: {
    type: Number,
    default: 0
  },
  // Store championship picks
  championshipPicks: [{
    team: String,
    count: Number,
    percentage: Number
  }],
  // Store rare correct picks
  rareCorrectPicks: [{
    matchupId: Number,
    round: Number,
    winner: {
      name: String,
      seed: Number
    },
    correctPicks: Number,
    totalPicks: Number,
    percentage: Number,
    region: String,
    teams: {
      teamA: {
        name: String,
        seed: Number
      },
      teamB: {
        name: String,
        seed: Number
      }
    },
    // Add this new field to store who made the rare picks
    correctPicksByUsers: [{
      bracketId: String,
      participantName: String,
      entryNumber: Number,
      userEmail: String
    }]
  }],
  // Store path-specific analysis
  pathAnalysis: {
    teamPaths: {
      type: Object,
      default: {}
    },
    championshipScenarios: [{
      matchup: {
        teamA: {
          name: String,
          seed: Number
        },
        teamB: {
          name: String,
          seed: Number
        }
      },
      outcomes: [{
        winner: {
          name: String,
          seed: Number
        },
        bracketImpacts: [{
          bracketId: String,
          participantName: String,
          entryNumber: Number,
          currentScore: Number,
          normalPodiumChance: Number,
          affectedPodiumChance: Number
        }]
      }]
    }]
  },
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