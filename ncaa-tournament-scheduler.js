require('dotenv').config();
const cron = require('node-cron');
const { exec } = require('child_process');
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const { 
  updateTournamentResults, 
  checkRecentUpdateLog,
  areAllGamesCompleteForToday,
  markYesterdayAsComplete  // New utility function we'll add
} = require('./ncaa-tournament-updater');
const NcaaUpdateLog = require('./models/NcaaUpdateLog');

// Connect to database
connectDB();

// Run every 15 minutes from 2pm until 3am for tournament days
// Changed to use a single cron job to avoid midnight transition issues
cron.schedule('*/15 14-23,0-3 * 3 *', async () => {
  const currentHour = new Date().getHours();
  const timeOfDay = (currentHour >= 0 && currentHour < 4) ? 'late night' : 'afternoon/evening';
  console.log(`[${new Date().toISOString()}] Running scheduled tournament update (${timeOfDay})...`);
  await runUpdate();
});

// Check less frequently in the morning hours (8am-2pm)
cron.schedule('*/30 8-13 * 3 *', async () => {
  console.log(`[${new Date().toISOString()}] Running morning tournament update...`);
  await runUpdate();
});

/**
 * Run the update process, but only if needed and enabled
 */
async function runUpdate() {
  try {
    // Check scheduler settings
    const SchedulerSettings = require('./models/SchedulerSettings');
    const settings = await SchedulerSettings.findOne({});
    
    // If scheduler is disabled, skip update
    if (settings && !settings.enabled) {
      console.log(`[${new Date().toISOString()}] Scheduler is disabled. Skipping update.`);
      return;
    }
    
    // If nextRunTime is set and it's in the future, skip update
    if (settings && settings.nextRunTime && new Date(settings.nextRunTime) > new Date()) {
      console.log(`[${new Date().toISOString()}] Next run time is ${settings.nextRunTime}. Skipping update.`);
      return;
    }
    
    // Check if all games are already complete for today
    const currentHour = new Date().getHours();
    const isLateNight = (currentHour >= 0 && currentHour < 4);
    
    if (isLateNight) {
      console.log(`[${new Date().toISOString()}] Late night update - checking yesterday's completion status...`);
      await checkAndMarkYesterdayCompletion();
    }
    
    const allComplete = await areAllGamesCompleteForToday(isLateNight);
    if (allComplete) {
      console.log(`[${new Date().toISOString()}] All games for ${isLateNight ? 'yesterday' : 'today'} are already complete. Skipping update.`);
      return;
    }
    
    // Check if we've run an update in the last 3 minutes
    const recentLog = await checkRecentUpdateLog();
    if (recentLog) {
      console.log(`[${new Date().toISOString()}] Recent update found from ${recentLog.runDate}. Skipping to avoid redundant updates.`);
      return;
    }
    
    // Run the update
    const result = await updateTournamentResults();
    console.log(`[${new Date().toISOString()}] Update completed with status: ${result.status}`);
    
    // Check if we should disable scheduler until tomorrow
    if (result.status === 'success' && result.totalGames > 0 && result.allComplete === true) {
      await autoDisableUntilTomorrow('All games for today are complete');
      console.log(`[${new Date().toISOString()}] Scheduler auto-disabled until tomorrow - all games complete`);
    } 
    else if (result.status === 'no_updates' && result.message === 'No tournament games found today') {
      await autoDisableUntilTomorrow('No tournament games scheduled for today');
      console.log(`[${new Date().toISOString()}] Scheduler auto-disabled until tomorrow - no games found`);
    }
    else if (result.status === 'complete_for_day') {
      await autoDisableUntilTomorrow('Day already marked as complete');
      console.log(`[${new Date().toISOString()}] Scheduler auto-disabled until tomorrow - day marked complete`);
    }
    
  } catch (error) {
    console.error('Error running update:', error);
    
    // Create error log if possible
    try {
      const errorLog = new NcaaUpdateLog({
        status: 'error',
        logs: [`[${new Date().toISOString()}] Critical error in scheduler: ${error.message}`],
        errorDetails: [{
          message: error.message,
          stack: error.stack
        }]
      });
      await errorLog.save();
    } catch (logError) {
      console.error('Failed to save error log:', logError);
    }
  }
}

/**
 * Check if yesterday's games should be marked as complete
 * Helps handle situations where the scheduler didn't run at midnight
 */
async function checkAndMarkYesterdayCompletion() {
  try {
    // First check if we already have a completion record for yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dayStart = new Date(yesterday.setHours(0, 0, 0, 0));
    const dayEnd = new Date(yesterday.setHours(23, 59, 59, 999));
    
    const existingCompletionLog = await NcaaUpdateLog.findOne({
      runDate: { $gte: dayStart, $lte: dayEnd },
      allGamesComplete: true
    });
    
    if (existingCompletionLog) {
      console.log(`[${new Date().toISOString()}] Yesterday is already marked as complete.`);
      return;
    }
    
    // Find the most recent log with tracked games from yesterday
    const mostRecentLog = await NcaaUpdateLog.findOne({
      runDate: { $gte: dayStart, $lte: dayEnd },
      totalTrackedGames: { $gt: 0 }
    }).sort({ runDate: -1 });
    
    if (!mostRecentLog) {
      console.log(`[${new Date().toISOString()}] No logs found for yesterday.`);
      return;
    }
    
    // Check if all tracked games are complete
    const allComplete = mostRecentLog.trackedGames.every(game => game.completed);
    
    if (allComplete && !mostRecentLog.allGamesComplete) {
      console.log(`[${new Date().toISOString()}] All games for yesterday appear complete but weren't marked. Updating status.`);
      await markYesterdayAsComplete();
    }
  } catch (error) {
    console.error('Error checking yesterday completion:', error);
  }
}

// Add API endpoint for manual updates
function setupRoutes(app, auth, admin) {
  // Route to manually trigger updates
  app.post('/api/admin/update-tournament', [auth, admin], async (req, res) => {
    try {
      // Check if manually forcing update for a specific day
      const forceYesterday = req.query.forceYesterday === 'true';
      
      if (forceYesterday) {
        console.log('Manually updating for yesterday...');
      }
      
      // Run the update
      const result = await updateTournamentResults(forceYesterday);
      
      res.json({
        success: true,
        message: 'Tournament update completed',
        result
      });
    } catch (error) {
      console.error('Error triggering manual update:', error);
      res.status(500).json({
        success: false,
        message: 'Error updating tournament',
        error: error.message
      });
    }
  });
  
  // Route to get update logs
  app.get('/api/admin/tournament-logs', [auth, admin], async (req, res) => {
    try {
      // Get the most recent logs
      const logs = await NcaaUpdateLog.find()
        .sort({ runDate: -1 })
        .limit(req.query.limit ? parseInt(req.query.limit) : 10);
      
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
  
  // Route to manually mark yesterday as complete
  app.post('/api/admin/mark-yesterday-complete', [auth, admin], async (req, res) => {
    try {
      const result = await markYesterdayAsComplete();
      res.json({
        success: true,
        message: 'Marked yesterday as complete',
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
  
  // Route to check today's games status
  app.get('/api/admin/tournament-today', [auth, admin], async (req, res) => {
    try {
      // Get today's logs
      const today = new Date();
      const dayStart = new Date(today.setHours(0, 0, 0, 0));
      const dayEnd = new Date(today.setHours(23, 59, 59, 999));
      
      const logs = await NcaaUpdateLog.find({
        runDate: { $gte: dayStart, $lte: dayEnd }
      }).sort({ runDate: -1 });
      
      // Get the latest log with tracked games
      const latestWithGames = logs.find(log => log.trackedGames && log.trackedGames.length > 0);
      
      if (!latestWithGames) {
        return res.json({
          success: true,
          message: 'No tracked games found for today',
          hasGames: false
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
}

/**
 * Auto-disable scheduler until the next morning
 */
async function autoDisableUntilTomorrow(reason) {
  try {
    const SchedulerSettings = require('./models/SchedulerSettings');
    let settings = await SchedulerSettings.findOne({});
    
    if (!settings) {
      settings = new SchedulerSettings({});
    }
    
    // Get current date and hour
    const now = new Date();
    const currentHour = now.getHours();
    
    // Calculate the next run time
    const nextRunTime = new Date();
    
    // If it's between midnight and 6 AM, disable only until 8 AM of the current day
    if (currentHour >= 0 && currentHour < 6) {
      // Set to 8 AM today
      nextRunTime.setHours(8, 0, 0, 0);
    } else {
      // Otherwise, disable until 8 AM tomorrow
      nextRunTime.setDate(nextRunTime.getDate() + 1);
      nextRunTime.setHours(8, 0, 0, 0);
    }
    
    settings.enabled = false;
    settings.autoDisabled = true;
    settings.disabledReason = reason;
    settings.nextRunTime = nextRunTime;
    settings.lastUpdated = new Date();
    
    await settings.save();
    
    console.log(`[${new Date().toISOString()}] Scheduler auto-disabled until ${nextRunTime.toISOString()}. Reason: ${reason}`);
  } catch (error) {
    console.error('Error auto-disabling scheduler:', error);
  }
}

// Export for server.js
module.exports = function(app) {
  if (app) {
    const auth = require('./middleware/auth');
    const admin = require('./middleware/admin');
    setupRoutes(app, auth, admin);
    return app;
  }
  
  // If running standalone
  console.log('NCAA Tournament updater scheduler started');
  console.log('Scheduled for tournament period in March');
  console.log('Press Ctrl+C to exit');
  
  // Run an initial update
  runUpdate();
};

// If running this file directly
if (require.main === module) {
  console.log('NCAA Tournament updater scheduler started');
  console.log('Scheduled for tournament period in March');
  console.log('Press Ctrl+C to exit');
  
  // Run an initial update
  runUpdate();
}