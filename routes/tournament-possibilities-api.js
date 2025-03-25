const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const fs = require('fs').promises;
const path = require('path');
const mongoose = require('mongoose');

// Import the analysis module
const { analyzeTournamentPossibilities } = require('../tournament-possibilities-analyzer');

// @route   GET api/tournament/possibilities
// @desc    Get tournament possibility analysis
// @access  Public
router.get('/possibilities', async (req, res) => {
  try {
    // First check the database for recent analysis
    const TournamentAnalysis = require('../models/TournamentAnalysis');
    
    // Get the most recent analysis
    const dbAnalysis = await TournamentAnalysis.findOne()
      .sort({ timestamp: -1 })
      .limit(1);
    
    // Check if analysis is recent enough (within last 30 minutes)
    if (dbAnalysis && dbAnalysis.timestamp > new Date(Date.now() - (30 * 60 * 1000))) {
      console.log('Using database analysis from', dbAnalysis.timestamp);
      return res.json(dbAnalysis);
    }
    
    // If no recent analysis in database, check cache files
    const analysisDir = path.join(__dirname, '..', 'analysis-cache');
    let analysisData = null;
    
    try {
      // Create directory if it doesn't exist
      await fs.mkdir(analysisDir, { recursive: true });
      
      // Find the most recent analysis file
      const files = await fs.readdir(analysisDir);
      const analysisFiles = files.filter(f => f.startsWith('tournament-analysis-') && f.endsWith('.json'));
      
      if (analysisFiles.length > 0) {
        // Sort by creation time (most recent first)
        const fileTimes = await Promise.all(
          analysisFiles.map(async file => {
            const stats = await fs.stat(path.join(analysisDir, file));
            return { file, time: stats.mtime.getTime() };
          })
        );
        
        fileTimes.sort((a, b) => b.time - a.time);
        const mostRecentFile = fileTimes[0].file;
        
        // Check if analysis is recent enough (within last 30 minutes)
        const fileTime = fileTimes[0].time;
        const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);
        
        if (fileTime > thirtyMinutesAgo) {
          // Use cached analysis
          const fileContent = await fs.readFile(path.join(analysisDir, mostRecentFile), 'utf8');
          analysisData = JSON.parse(fileContent);
          console.log('Using cached analysis from', new Date(fileTime).toISOString());
          
          // Save to database to ensure it's available there too
          if (!dbAnalysis || dbAnalysis.timestamp < new Date(fileTime)) {
            // Create a new analysis document
            const newAnalysis = new TournamentAnalysis({
              timestamp: analysisData.timestamp || new Date(),
              stage: analysisData.stage,
              totalBrackets: analysisData.totalBrackets,
              totalPossibleOutcomes: analysisData.totalPossibleOutcomes,
              roundName: analysisData.roundName,
              currentRound: analysisData.currentRound,
              roundProgress: analysisData.roundProgress,
              podiumContenders: analysisData.podiumContenders,
              playersWithNoPodiumChance: analysisData.playersWithNoPodiumChance,
              playersWithWinChance: analysisData.playersWithWinChance,
              championshipPicks: analysisData.championshipPicks,
              bracketOutcomes: analysisData.bracketOutcomes,
              rareCorrectPicks: analysisData.rareCorrectPicks,
              pathAnalysis: analysisData.pathAnalysis,
              bracketResults: analysisData.bracketResults
            });
            
            try {
              await newAnalysis.save();
              console.log('Cached analysis saved to database');
            } catch (dbError) {
              console.error('Error saving cached analysis to database:', dbError);
              // Continue without failing - we still have the file data
            }
          }
        }
      }
    } catch (cacheError) {
      console.error('Error checking cache:', cacheError);
      // Continue with fresh analysis if there's an error reading cache
    }
    
    // If no cached analysis or it's too old, generate fresh analysis
    if (!analysisData) {
      console.log('Generating fresh tournament possibilities analysis');
      
      // Connect to database if not already connected
      let needToCloseConnection = false;
      if (mongoose.connection.readyState !== 1) {
        await mongoose.connect(process.env.MONGO_URI);
        needToCloseConnection = true;
      }
      
      try {
        // Generate the analysis with database saving enabled
        analysisData = await analyzeTournamentPossibilities(true);
      } finally {
        // Close connection if we opened it
        if (needToCloseConnection) {
          await mongoose.connection.close();
        }
      }
    }
    
    return res.json(analysisData);
  } catch (err) {
    console.error('Error generating tournament possibilities:', err);
    res.status(500).send('Server error');
  }
});

// @route   POST api/tournament/possibilities/generate
// @desc    Force generation of fresh tournament possibilities analysis
// @access  Private (admin only)
router.post('/possibilities/generate', [auth, admin], async (req, res) => {
  try {
    console.log('Admin triggered fresh tournament possibilities analysis');
    
    // Connect to database if not already connected
    let needToCloseConnection = false;
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(process.env.MONGO_URI);
      needToCloseConnection = true;
    }
    
    let analysisData;
    try {
      // Generate the analysis with database saving enabled
      analysisData = await analyzeTournamentPossibilities(true);
    } finally {
      // Close connection if we opened it
      if (needToCloseConnection) {
        await mongoose.connection.close();
      }
    }
    
    res.json({
      success: true,
      message: 'Tournament analysis generated successfully',
      timestamp: analysisData.timestamp,
      stage: analysisData.stage,
      roundName: analysisData.roundName,
      totalBrackets: analysisData.totalBrackets,
      totalPossibleOutcomes: analysisData.totalPossibleOutcomes,
      roundProgress: analysisData.roundProgress
    });
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