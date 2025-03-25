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
    // First check if we have cached analysis results and they're recent
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
      
      // Cache the results
      try {
        const timestamp = new Date().toISOString().replace(/:/g, '-');
        const filename = `tournament-analysis-${timestamp}.json`;
        await fs.writeFile(
          path.join(analysisDir, filename),
          JSON.stringify(analysisData)
        );
        console.log('Analysis cached to', filename);
        
        // Cleanup old files (keep last 5)
        const files = await fs.readdir(analysisDir);
        const analysisFiles = files
          .filter(f => f.startsWith('tournament-analysis-') && f.endsWith('.json'))
          .sort()
          .reverse();
        
        if (analysisFiles.length > 5) {
          for (let i = 5; i < analysisFiles.length; i++) {
            await fs.unlink(path.join(analysisDir, analysisFiles[i]));
          }
        }
      } catch (writeError) {
        console.error('Error caching analysis:', writeError);
        // Continue even if caching fails
      }
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
    
    // Cache the results
    try {
      const analysisDir = path.join(__dirname, '..', 'analysis-cache');
      await fs.mkdir(analysisDir, { recursive: true });
      
      const timestamp = new Date().toISOString().replace(/:/g, '-');
      const filename = `tournament-analysis-${timestamp}.json`;
      await fs.writeFile(
        path.join(analysisDir, filename),
        JSON.stringify(analysisData)
      );
      console.log('Analysis cached to', filename);
    } catch (writeError) {
      console.error('Error caching analysis:', writeError);
      // Continue even if caching fails
    }
    
    res.json({
      success: true,
      message: 'Tournament analysis generated successfully',
      timestamp: new Date(),
      analysisData
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