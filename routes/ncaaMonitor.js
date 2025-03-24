const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const NcaaUpdateLog = require('../models/NcaaUpdateLog');
const SchedulerSettings = require('../models/SchedulerSettings');
const { 
  updateTournamentResults, 
  areAllGamesCompleteForToday,
  markYesterdayAsComplete
} = require('../ncaa-tournament-updater');

// @route   GET /api/admin/tournament-today
// @desc    Get today's tournament games status
// @access  Private (admin only)
router.get('/tournament-today', [auth, admin], async (req, res) => {
  try {
    // Check if we want yesterday's games instead (for late night checks)
    const showYesterday = req.query.yesterday === 'true';
    
    // Get date range
    const date = new Date();
    if (showYesterday) {
      date.setDate(date.getDate() - 1);
    }
    
    const dayStart = new Date(date.setHours(0, 0, 0, 0));
    const dayEnd = new Date(date.setHours(23, 59, 59, 999));
    
    // Get the most recent log that contains tracked games
    const logs = await NcaaUpdateLog.find({
      runDate: { $gte: dayStart, $lte: dayEnd }
    }).sort({ runDate: -1 });
    
    // Get the latest log with tracked games
    const latestWithGames = logs.find(log => log.trackedGames && log.trackedGames.length > 0);
    
    if (!latestWithGames) {
      return res.json({
        success: true,
        message: `No tracked games found for ${showYesterday ? 'yesterday' : 'today'}`,
        hasGames: false,
        totalGames: 0,
        completedGames: 0,
        pendingGames: 0,
        allComplete: false,
        dayDate: dayStart.toISOString().split('T')[0]
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
      dayDate: dayStart.toISOString().split('T')[0],
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
    // Get option to force using yesterday's date for API calls
    const forceYesterday = req.query.forceYesterday === 'true';
    
    // Check if all games are already complete
    const allComplete = await areAllGamesCompleteForToday(forceYesterday);
    
    if (allComplete && !req.query.force) {
      return res.json({
        success: true,
        message: `All games for ${forceYesterday ? 'yesterday' : 'today'} are already complete`,
        result: {
          status: 'complete_for_day'
        }
      });
    }
    
    // Run the update
    const result = await updateTournamentResults(forceYesterday);
    
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

// @route   POST /api/admin/mark-yesterday-complete
// @desc    Manually mark yesterday's games as complete
// @access  Private (admin only)
router.post('/mark-yesterday-complete', [auth, admin], async (req, res) => {
  try {
    const result = await markYesterdayAsComplete();
    
    res.json({
      success: true,
      message: 'Yesterday marked as complete',
      result
    });
  } catch (error) {
    console.error('Error marking yesterday complete:', error);
    res.status(500).json({
      success: false,
      message: 'Error marking yesterday complete',
      error: error.message
    });
  }
});

// @route   GET /api/admin/scheduler-status
// @desc    Get scheduler status
// @access  Private (admin only)
router.get('/scheduler-status', [auth, admin], async (req, res) => {
  try {
    // Get or create settings
    let settings = await SchedulerSettings.findOne({});
    
    if (!settings) {
      settings = new SchedulerSettings({
        enabled: true,
        nextRunTime: null,
        autoDisabled: false,
        disabledReason: null
      });
      await settings.save();
    }
    
    res.json(settings);
  } catch (error) {
    console.error('Error fetching scheduler status:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching scheduler status',
      error: error.message
    });
  }
});

// @route   POST /api/admin/toggle-scheduler
// @desc    Toggle scheduler on/off
// @access  Private (admin only)
router.post('/toggle-scheduler', [auth, admin], async (req, res) => {
  try {
    const { enabled } = req.body;
    
    if (enabled === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Enabled status is required'
      });
    }
    
    // Get or create settings
    let settings = await SchedulerSettings.findOne({});
    
    if (!settings) {
      settings = new SchedulerSettings({});
    }
    
    // Update settings
    settings.enabled = enabled;
    settings.autoDisabled = false; // Reset auto-disabled when manually toggled
    settings.disabledReason = enabled ? null : 'Manually disabled by administrator';
    settings.lastUpdated = new Date();
    
    await settings.save();
    
    res.json(settings);
  } catch (error) {
    console.error('Error toggling scheduler:', error);
    res.status(500).json({
      success: false,
      message: 'Error toggling scheduler',
      error: error.message
    });
  }
});

// @route   POST /api/admin/mark-yesterday-complete
// @desc    Manually mark yesterday's games as complete
// @access  Private (admin only)
router.post('/mark-yesterday-complete', [auth, admin], async (req, res) => {
  try {
    const result = await markYesterdayAsComplete();
    
    res.json({
      success: true,
      message: 'Yesterday marked as complete',
      result
    });
  } catch (error) {
    console.error('Error marking yesterday complete:', error);
    res.status(500).json({
      success: false,
      message: 'Error marking yesterday complete',
      error: error.message
    });
  }
});

module.exports = router;