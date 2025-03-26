const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const mongoose = require('mongoose');

// Import the analysis module
const { analyzeTournamentPossibilities } = require('../tournament-possibilities-analyzer');

// @route   GET api/tournament/possibilities
// @desc    Get tournament possibility analysis (retrieves from database, never saves)
// @access  Public
router.get('/possibilities', async (req, res) => {
  try {
    // Check the database for recent analysis
    const TournamentAnalysis = require('../models/TournamentAnalysis');
    
    // Get the most recent analysis
    const dbAnalysis = await TournamentAnalysis.findOne()
      .sort({ timestamp: -1 })
      .limit(1);
    
    if (dbAnalysis) {
      console.log('Using database analysis from', dbAnalysis.timestamp);
      return res.json(dbAnalysis);
    }
    
    // Get current tournament to check if we're at Sweet 16 or beyond
    const TournamentResults = require('../models/TournamentResults');
    
    const tournament = await TournamentResults.findOne({
      year: new Date().getFullYear(),
    });
    
    if (!tournament) {
      return res.status(404).json({ 
        message: 'No tournament data found',
        error: true 
      });
    }
    
    // If no analysis exists in database, generate fresh analysis BUT DON'T SAVE to DB
    console.log('No analysis found in database. Generating fresh analysis (not saved)...');
    
    // Connect to database if not already connected
    let needToCloseConnection = false;
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(process.env.MONGO_URI);
      needToCloseConnection = true;
    }
    
    try {
      // Generate the analysis WITHOUT database saving
      const analysisData = await analyzeTournamentPossibilities(false);
      
      // If analysis returned an error (e.g., too many teams)
      if (analysisData.error) {
        return res.status(400).json({
          message: analysisData.message,
          activeTeamCount: analysisData.activeTeamCount,
          error: true
        });
      }
      
      return res.json(analysisData);
    } finally {
      // Close connection if we opened it
      if (needToCloseConnection) {
        await mongoose.connection.close();
      }
    }
  } catch (err) {
    console.error('Error retrieving tournament possibilities:', err);
    res.status(500).send('Server error');
  }
});

// @route   POST api/tournament/possibilities/generate
// @desc    Force generation of fresh tournament possibilities analysis and save to DB
// @access  Private (admin only)
router.post('/possibilities/generate', [auth, admin], async (req, res) => {
  try {
    console.log('Admin triggered fresh tournament possibilities analysis with database save');
    
    // Connect to database if not already connected
    let needToCloseConnection = false;
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(process.env.MONGO_URI);
      needToCloseConnection = true;
    }
    
    let analysisData;
    try {
      // Generate the analysis WITH database saving enabled
      analysisData = await analyzeTournamentPossibilities(true);
      
      // If analysis returned an error (e.g., too many teams)
      if (analysisData.error) {
        return res.status(400).json({
          success: false,
          message: analysisData.message,
          activeTeamCount: analysisData.activeTeamCount
        });
      }
      
      res.json({
        success: true,
        message: 'Tournament analysis generated and saved to database successfully',
        timestamp: analysisData.timestamp,
        stage: analysisData.stage,
        roundName: analysisData.roundName,
        totalBrackets: analysisData.totalBrackets,
        totalPossibleOutcomes: analysisData.totalPossibleOutcomes,
        roundProgress: analysisData.roundProgress
      });
    } finally {
      // Close connection if we opened it
      if (needToCloseConnection) {
        await mongoose.connection.close();
      }
    }
  } catch (err) {
    console.error('Error generating tournament possibilities:', err);
    res.status(500).json({
      success: false,
      message: 'Error generating tournament analysis',
      error: err.message
    });
  }
});

// @route   GET api/tournament/podium-contenders
// @desc    Get brackets with podium chances
// @access  Public
router.get('/podium-contenders', async (req, res) => {
  try {
    const TournamentAnalysis = require('../models/TournamentAnalysis');
    
    // Get the most recent analysis
    const analysis = await TournamentAnalysis.findOne()
      .sort({ timestamp: -1 })
      .limit(1);
    
    if (!analysis) {
      return res.status(404).json({ message: 'No analysis available' });
    }
    
    // Get sort field and direction from query parameters
    const sortField = req.query.sort || 'podium';
    const sortDirection = req.query.dir === 'asc' ? 1 : -1;
    
    // Create a sorted copy of the podium contenders
    let sortedContenders = [...analysis.podiumContenders];
    
    // Apply sorting
    if (sortField === 'name') {
      sortedContenders.sort((a, b) => {
        return sortDirection * a.participantName.localeCompare(b.participantName);
      });
    } else if (sortField === 'score') {
      sortedContenders.sort((a, b) => {
        return sortDirection * (a.currentScore - b.currentScore);
      });
    } else if (sortField === 'first') {
      sortedContenders.sort((a, b) => {
        return sortDirection * (a.placePercentages['1'] - b.placePercentages['1']);
      });
    } else if (sortField === 'second') {
      sortedContenders.sort((a, b) => {
        return sortDirection * (a.placePercentages['2'] - b.placePercentages['2']);
      });
    } else if (sortField === 'third') {
      sortedContenders.sort((a, b) => {
        return sortDirection * (a.placePercentages['3'] - b.placePercentages['3']);
      });
    } else {
      // Default: sort by podium chance
      sortedContenders.sort((a, b) => {
        return sortDirection * (a.placePercentages.podium - b.placePercentages.podium);
      });
    }
    
    res.json({
      timestamp: analysis.timestamp,
      stage: analysis.stage,
      roundName: analysis.roundName,
      roundProgress: analysis.roundProgress,
      podiumContenders: sortedContenders,
      playersWithNoPodiumChance: analysis.playersWithNoPodiumChance
    });
  } catch (err) {
    console.error('Error fetching podium contenders:', err);
    res.status(500).send('Server error');
  }
});

// @route   GET api/tournament/rare-picks
// @desc    Get rare correct picks
// @access  Public
router.get('/rare-picks', async (req, res) => {
  try {
    const TournamentAnalysis = require('../models/TournamentAnalysis');
    
    // Get the most recent analysis
    const analysis = await TournamentAnalysis.findOne()
      .sort({ timestamp: -1 })
      .limit(1);
    
    if (!analysis) {
      return res.status(404).json({ message: 'No analysis available' });
    }
    
    res.json({
      timestamp: analysis.timestamp,
      rareCorrectPicks: analysis.rareCorrectPicks || []
    });
  } catch (err) {
    console.error('Error fetching rare picks:', err);
    res.status(500).send('Server error');
  }
});

// @route   GET api/tournament/path-analysis
// @desc    Get path-specific analysis
// @access  Public
router.get('/path-analysis', async (req, res) => {
  try {
    const TournamentAnalysis = require('../models/TournamentAnalysis');
    
    // Get the most recent analysis
    const analysis = await TournamentAnalysis.findOne()
      .sort({ timestamp: -1 })
      .limit(1);
    
    if (!analysis) {
      return res.status(404).json({ message: 'No analysis available' });
    }
    
    res.json({
      timestamp: analysis.timestamp,
      stage: analysis.stage,
      roundName: analysis.roundName,
      pathAnalysis: analysis.pathAnalysis || {}
    });
  } catch (err) {
    console.error('Error fetching path analysis:', err);
    res.status(500).send('Server error');
  }
});

module.exports = router;