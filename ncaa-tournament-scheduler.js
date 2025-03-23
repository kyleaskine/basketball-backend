require('dotenv').config();
const cron = require('node-cron');
const { exec } = require('child_process');
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const { 
  updateTournamentResults, 
  checkRecentUpdateLog,
  areAllGamesCompleteForToday
} = require('./ncaa-tournament-updater');
const NcaaUpdateLog = require('./models/NcaaUpdateLog');

// Connect to database
connectDB();

// Run every 15 minutes from 2pm until 3am for tournament days
cron.schedule('*/15 14-23 * 3 *', async () => {
  console.log(`[${new Date().toISOString()}] Running scheduled tournament update (afternoon/evening)...`);
  await runUpdate();
});

// Also need to handle the midnight to 3am window (next day)
cron.schedule('*/15 0-3 * 3 *', async () => {
  console.log(`[${new Date().toISOString()}] Running scheduled tournament update (late night)...`);
  await runUpdate();
});

// Check less frequently in the morning hours (8am-2pm)
cron.schedule('*/30 8-13 * 3 *', async () => {
  console.log(`[${new Date().toISOString()}] Running morning tournament update...`);
  await runUpdate();
});

/**
 * Run the update process, but only if needed
 */
async function runUpdate() {
  try {
    // Check if all games are already complete for today
    const allComplete = await areAllGamesCompleteForToday();
    if (allComplete) {
      console.log(`[${new Date().toISOString()}] All games for today are already complete. Skipping update.`);
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
    
    // Close database connection
    mongoose.connection.close();
  } catch (error) {
    console.error('Error running update:', error);
    
    // Create error log if possible
    try {
      const errorLog = new NcaaUpdateLog({
        status: 'error',
        logs: [`[${new Date().toISOString()}] Critical error in scheduler: ${error.message}`],
        errors: [{
          message: error.message,
          stack: error.stack
        }]
      });
      await errorLog.save();
    } catch (logError) {
      console.error('Failed to save error log:', logError);
    }
    
    // Close database connection
    mongoose.connection.close();
  }
}

// Add API endpoint for manual updates
function setupRoutes(app, auth, admin) {
  // Route to manually trigger updates
  app.post('/api/admin/update-tournament', [auth, admin], async (req, res) => {
    try {
      // Run the update
      const result = await updateTournamentResults();
      
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