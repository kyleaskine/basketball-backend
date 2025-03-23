const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const NcaaUpdateLog = require('../models/NcaaUpdateLog');
const { updateTournamentResults, areAllGamesCompleteForToday } = require('../ncaa-tournament-updater');

// @route   GET /api/admin/tournament-today
// @desc    Get today's tournament games status
// @access  Private (admin only)
router.get('/tournament-today', [auth, admin], async (req, res) => {
  try {
    // Get today's date range
    const today = new Date();
    const dayStart = new Date(today.setHours(0, 0, 0, 0));
    const dayEnd = new Date(today.setHours(23, 59, 59, 999));
    
    // Get the most recent log that contains tracked games
    const logs = await NcaaUpdateLog.find({
      runDate: { $gte: dayStart, $lte: dayEnd }
    }).sort({ runDate: -1 });
    
    // Get the latest log with tracked games
    const latestWithGames = logs.find(log => log.trackedGames && log.trackedGames.length > 0);
    
    if (!latestWithGames) {
      return res.json({
        success: true,
        message: 'No tracked games found for today',
        hasGames: false,
        totalGames: 0,
        completedGames: 0,
        pendingGames: 0,
        allComplete: false
      });
    }
    
    // Categorize games
    const completed = latestWithGames.trackedGames.filter(g => g.completed);
    const pending = latestWithGames.trackedGames.filter(g => !g.completed);
    
    res.json({
      success: true,
      hasGames: true,
      allComplete: latestWithGames.allGamesComplete,
      totalGames: latestWithGames.totalTrackedGames,
      completedGames: completed.length,
      pendingGames: pending.length,
      lastUpdateTime: latestWithGames.runDate,
      completed,
      pending
    });
  } catch (error) {
    console.error('Error fetching today\'s games:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching today\'s games',
      error: error.message
    });
  }
});

// @route   GET /api/admin/tournament-logs
// @desc    Get NCAA update logs
// @access  Private (admin only)
router.get('/tournament-logs', [auth, admin], async (req, res) => {
  try {
    // Get the limit from query params or default to 10
    const limit = req.query.limit ? parseInt(req.query.limit) : 10;
    
    // Get the logs sorted by run date (newest first)
    const logs = await NcaaUpdateLog.find()
      .sort({ runDate: -1 })
      .limit(limit);
    
    res.json(logs);
  } catch (error) {
    console.error('Error fetching update logs:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching update logs',
      error: error.message
    });
  }
});

// @route   POST /api/admin/update-tournament
// @desc    Trigger manual NCAA update
// @access  Private (admin only)
router.post('/update-tournament', [auth, admin], async (req, res) => {
  try {
    // Check if all games are already complete for today
    const allComplete = await areAllGamesCompleteForToday();
    
    if (allComplete) {
      return res.json({
        success: true,
        message: 'All games for today are already complete',
        result: {
          status: 'complete_for_day'
        }
      });
    }
    
    // Run the update
    const result = await updateTournamentResults();
    
    res.json({
      success: true,
      message: 'Tournament update triggered successfully',
      result
    });
  } catch (error) {
    console.error('Error triggering tournament update:', error);
    res.status(500).json({
      success: false,
      message: 'Error triggering tournament update',
      error: error.message
    });
  }
});

module.exports = router;