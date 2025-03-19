const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const TournamentResults = require('../models/TournamentResults');
const Bracket = require('../models/Bracket');

// @route   GET api/tournament/results
// @desc    Get tournament results
// @access  Public
router.get('/results', async (req, res) => {
  try {
    // Get the current year's tournament results, or create if it doesn't exist
    let results = await TournamentResults.findOne({ 
      year: new Date().getFullYear() 
    });
    
    if (!results) {
      // Return empty results if none exist yet
      return res.json({
        results: null,
        completedRounds: [],
        games: []
      });
    }
    
    res.json(results);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   GET api/tournament/standings
// @desc    Get bracket standings
// @access  Public
router.get('/standings', async (req, res) => {
  try {
    // Get tournament results to check if it exists
    const tournament = await TournamentResults.findOne({ 
      year: new Date().getFullYear() 
    });
    
    if (!tournament || tournament.completedRounds.length === 0) {
      return res.status(400).json({ 
        msg: 'No tournament results available yet' 
      });
    }
    
    // Get all brackets with scores
    const brackets = await Bracket.find()
      .sort({ score: -1, participantName: 1 });
    
    // Format standings data
    const standings = brackets.map((bracket, index) => {
      return {
        position: index + 1,
        participantName: bracket.participantName,
        entryNumber: bracket.entryNumber || 1,
        score: bracket.score,
        userEmail: bracket.userEmail,
        id: bracket._id
      };
    });
    
    // Get some stats
    const stats = {
      totalBrackets: brackets.length,
      averageScore: brackets.reduce((acc, bracket) => acc + bracket.score, 0) / brackets.length,
      highestScore: brackets.length > 0 ? brackets[0].score : 0,
      completedRounds: tournament.completedRounds
    };
    
    res.json({
      standings,
      stats
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// ADMIN ROUTES

// @route   POST api/tournament/results
// @desc    Create or update tournament results
// @access  Private (admin only)
router.post('/results', [auth, admin], async (req, res) => {
  const { results, completedRounds, games, scoringConfig } = req.body;
  
  try {
    // Find existing tournament results for the current year
    let tournament = await TournamentResults.findOne({ 
      year: new Date().getFullYear() 
    });
    
    if (tournament) {
      // Update existing tournament
      if (results) tournament.results = results;
      if (completedRounds) tournament.completedRounds = completedRounds;
      if (games) tournament.games = games;
      if (scoringConfig) tournament.scoringConfig = scoringConfig;
      
      tournament.lastUpdated = Date.now();
      
      await tournament.save();
    } else {
      // Create new tournament results
      tournament = new TournamentResults({
        results,
        completedRounds: completedRounds || [],
        games: games || [],
        scoringConfig: scoringConfig || undefined
      });
      
      await tournament.save();
    }
    
    res.json(tournament);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   POST api/tournament/calculate-scores
// @desc    Calculate scores for all brackets based on tournament results
// @access  Private (admin only)
router.post('/calculate-scores', [auth, admin], async (req, res) => {
  try {
    // Get tournament results
    const tournament = await TournamentResults.findOne({ 
      year: new Date().getFullYear() 
    });
    
    if (!tournament || !tournament.results) {
      return res.status(400).json({ 
        msg: 'No tournament results available for scoring' 
      });
    }
    
    // Get all brackets
    const brackets = await Bracket.find();
    
    // Results counter
    let updated = 0;
    let errors = 0;
    
    // Loop through each bracket and calculate score
    for (const bracket of brackets) {
      try {
        // Initialize score
        let score = 0;
        
        // Go through each completed round
        for (const round of tournament.completedRounds) {
          // Get matchups for this round from tournament results
          const tournamentMatchups = tournament.results[round];
          
          // Get matchups for this round from bracket
          const bracketMatchups = bracket.picks[round];
          
          if (!tournamentMatchups || !bracketMatchups) continue;
          
          // Check each matchup in the round
          for (const tournamentMatchup of tournamentMatchups) {
            // Find corresponding bracket matchup
            const bracketMatchup = bracketMatchups.find(
              m => m.id === tournamentMatchup.id
            );
            
            if (!bracketMatchup || !bracketMatchup.winner || !tournamentMatchup.winner) {
              continue;
            }
            
            // Check if the winner matches
            if (
              bracketMatchup.winner.name === tournamentMatchup.winner.name &&
              bracketMatchup.winner.seed === tournamentMatchup.winner.seed
            ) {
              // Add points based on the round
              score += tournament.scoringConfig[round];
            }
          }
        }
        
        // Update bracket score
        bracket.score = score;
        await bracket.save();
        updated++;
      } catch (err) {
        console.error(`Error calculating score for bracket ${bracket._id}:`, err);
        errors++;
      }
    }
    
    res.json({
      msg: `Scores calculated: ${updated} brackets updated, ${errors} errors`,
      success: true,
      updated,
      errors
    });
  } catch (err) {
    console.error('Error calculating scores:', err.message);
    res.status(500).send('Server error');
  }
});

// @route   PUT api/tournament/lock-brackets
// @desc    Lock all brackets (when tournament starts)
// @access  Private (admin only)
router.put('/lock-brackets', [auth, admin], async (req, res) => {
  try {
    const result = await Bracket.updateMany({}, { isLocked: true });
    
    res.json({
      msg: `Locked ${result.nModified} brackets`,
      success: true,
      count: result.nModified
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   PUT api/tournament/unlock-brackets
// @desc    Unlock all brackets (for testing purposes)
// @access  Private (admin only)
router.put('/unlock-brackets', [auth, admin], async (req, res) => {
    try {
      const result = await Bracket.updateMany({}, { isLocked: false });
      
      res.json({
        msg: `Unlocked ${result.nModified} brackets`,
        success: true,
        count: result.nModified
      });
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Server error');
    }
  });

// @route   PUT api/tournament/games/:id
// @desc    Update a specific game result
// @access  Private (admin only)
router.put('/games/:id', [auth, admin], async (req, res) => {
  const { winner, score, completed } = req.body;
  const matchupId = parseInt(req.params.id);
  
  if (!matchupId) {
    return res.status(400).json({ msg: 'Valid matchup ID is required' });
  }
  
  try {
    // Get tournament results
    let tournament = await TournamentResults.findOne({ 
      year: new Date().getFullYear() 
    });
    
    if (!tournament) {
      return res.status(404).json({ msg: 'Tournament results not found' });
    }
    
    // Find the game in the tournament results
    const gameIndex = tournament.games.findIndex(g => g.matchupId === matchupId);
    
    if (gameIndex === -1) {
      return res.status(404).json({ msg: 'Game not found' });
    }
    
    // Update the game
    if (winner) tournament.games[gameIndex].winner = winner;
    if (score) tournament.games[gameIndex].score = score;
    if (completed !== undefined) tournament.games[gameIndex].completed = completed;
    
    // If marking as completed, set playedAt date
    if (completed) {
      tournament.games[gameIndex].playedAt = Date.now();
    }
    
    // Also update the main results object
    for (const round in tournament.results) {
      const matchupIndex = tournament.results[round].findIndex(
        m => m.id === matchupId
      );
      
      if (matchupIndex !== -1) {
        if (winner) tournament.results[round][matchupIndex].winner = winner;
        break;
      }
    }
    
    // Update lastUpdated timestamp
    tournament.lastUpdated = Date.now();
    
    await tournament.save();
    
    res.json(tournament);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

module.exports = router;