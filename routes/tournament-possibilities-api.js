const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const fs = require('fs').promises;
const path = require('path');

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
      
      // Check if analysis is recent enough (within last hour)
      if (dbAnalysis && dbAnalysis.timestamp > new Date(Date.now() - (60 * 60 * 1000))) {
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
          
          // Check if analysis is recent enough (within last hour)
          const fileTime = fileTimes[0].time;
          const oneHourAgo = Date.now() - (60 * 60 * 1000);
          
          if (fileTime > oneHourAgo) {
            // Use cached analysis
            const fileContent = await fs.readFile(path.join(analysisDir, mostRecentFile), 'utf8');
            analysisData = JSON.parse(fileContent);
            console.log('Using cached analysis from', new Date(fileTime).toISOString());
          }
        }
      } catch (cacheError) {
        console.error('Error checking cache:', cacheError);
        // Continue with fresh analysis if there's an error reading cache
      }
      
      // If no cached analysis or it's too old, generate fresh analysis
      if (!analysisData) {
        console.log('Generating fresh tournament possibilities analysis');
        
        // Generate the analysis
        analysisData = await analyzeTournamentPossibilities();
      }
      
      res.json(analysisData);
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
      
      // Generate the analysis
      const analysisData = await analyzeTournamentPossibilities();
      
      res.json({
        success: true,
        message: 'Tournament analysis generated successfully',
        timestamp: new Date(),
        analysisId: analysisData._id // Return the database ID
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

module.exports = router;