const mongoose = require('mongoose');

const TournamentResultsSchema = new mongoose.Schema({
  year: {
    type: Number,
    required: true,
    default: new Date().getFullYear()
  },
  // We'll store the full bracket data, similar to how we store user picks
  results: {
    type: Object,
    required: true
  },
  // Track which rounds have been completed
  completedRounds: {
    type: [Number],
    default: []
  },
  // Individual game results
  games: [{
    matchupId: Number,
    round: Number,
    teamA: {
      seed: Number,
      name: String
    },
    teamB: {
      seed: Number,
      name: String
    },
    winner: {
      seed: Number,
      name: String
    },
    score: {
      teamA: Number,
      teamB: Number
    },
    completed: {
      type: Boolean,
      default: false
    },
    playedAt: Date
  }],
  teams: {
    type: Object,
    default: {}
    // Structure will be:
    // { 
    //   "TeamName": {
    //     seed: Number,
    //     eliminated: Boolean,
    //     eliminationRound: Number,
    //     eliminationMatchupId: Number
    //   }
    // }
  },
  // Config for scoring points by round
  scoringConfig: {
    type: Object,
    default: {
      1: 1,  // First round: 1 point
      2: 2,  // Second round: 2 points
      3: 4,  // Sweet 16: 4 points
      4: 8,  // Elite 8: 8 points
      5: 16, // Final Four: 16 points
      6: 32  // Championship: 32 points
    }
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('TournamentResults', TournamentResultsSchema);