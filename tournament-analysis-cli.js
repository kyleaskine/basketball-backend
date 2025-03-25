/**
 * Tournament Analysis CLI
 * 
 * This script runs the tournament possibilities analysis and can be
 * scheduled to run at specific intervals (e.g., with cron).
 * 
 * Usage:
 *   node tournament-analysis-cli.js
 * 
 * Options:
 *   --output=./path/to/output  (Default: ./analysis-cache)
 *   --verbose                  (Print detailed logs)
 *   --force                    (Force run even if recently analyzed)
 *   --no-db-save               (Skip saving to database)
 */

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const TournamentResults = require('./models/TournamentResults');
const TournamentAnalysis = require('./models/TournamentAnalysis');
const { analyzeTournamentPossibilities } = require('./tournament-possibilities-analyzer');

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  output: './analysis-cache',
  verbose: false,
  force: false,
  'db-save': true // Default to saving to database
};

// Parse options
args.forEach(arg => {
  const [key, value] = arg.split('=');
  if (key.startsWith('--')) {
    const optionName = key.slice(2);
    if (optionName.startsWith('no-')) {
      options[optionName.slice(3)] = false;
    } else {
      options[optionName] = value || true;
    }
  }
});

// Set up output directory
const outputDir = path.resolve(process.cwd(), options.output);

async function ensureDirectoryExists(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

async function detectCurrentTournamentStage() {
  // Get the current tournament state
  const tournament = await TournamentResults.findOne({
    year: new Date().getFullYear()
  });
  
  if (!tournament) {
    throw new Error('No tournament data found for current year');
  }
  
  // Determine current round based on completed rounds
  const completedRounds = tournament.completedRounds || [];
  
  let currentRound = 3; // Default to Sweet 16
  let stageName = 'sweet16';
  let roundName = 'Sweet 16';
  
  if (completedRounds.includes(3)) {
    currentRound = 4;
    stageName = 'elite8';
    roundName = 'Elite 8';
  }
  if (completedRounds.includes(4)) {
    currentRound = 5;
    stageName = 'final4';
    roundName = 'Final Four';
  }
  if (completedRounds.includes(5)) {
    currentRound = 6;
    stageName = 'championship';
    roundName = 'Championship';
  }
  
  return {
    currentRound,
    stageName,
    roundName,
    completedRounds
  };
}

async function shouldRunAnalysis() {
  if (options.force) {
    return { shouldRun: true, reason: 'Force flag provided' };
  }
  
  // Check when the latest analysis was performed
  const latest = await TournamentAnalysis.findOne().sort({ timestamp: -1 });
  
  if (!latest) {
    return { shouldRun: true, reason: 'No previous analysis found' };
  }
  
  // Get current stage
  const currentStage = await detectCurrentTournamentStage();
  
  // If stage has changed, we should run new analysis
  if (latest.stage !== currentStage.stageName) {
    return { 
      shouldRun: true, 
      reason: `Tournament stage changed from ${latest.stage} to ${currentStage.stageName}` 
    };
  }
  
  // Check if it's been over an hour since last analysis
  const oneHourAgo = new Date(Date.now() - (60 * 60 * 1000));
  if (latest.timestamp < oneHourAgo) {
    return { 
      shouldRun: true, 
      reason: `Last analysis was over an hour ago (${latest.timestamp.toISOString()})` 
    };
  }
  
  return { 
    shouldRun: false, 
    reason: `Recent analysis exists from ${latest.timestamp.toISOString()}`,
    latestAnalysis: latest
  };
}

async function run() {
  let db = null;
  
  try {
    console.log('Tournament Analysis CLI');
    console.log('----------------------');
    console.log('Options:', options);
    
    // Ensure output directory exists
    await ensureDirectoryExists(outputDir);
    
    // Connect to database
    db = await connectDB();
    console.log('Connected to database');
    
    // Detect current tournament stage
    const stageInfo = await detectCurrentTournamentStage();
    console.log(`Current tournament stage: ${stageInfo.roundName} (${stageInfo.stageName})`);
    console.log(`Completed rounds: ${stageInfo.completedRounds.join(', ')}`);
    
    // Determine if analysis should run
    const { shouldRun, reason, latestAnalysis } = await shouldRunAnalysis();
    
    if (!shouldRun) {
      console.log(`Skipping analysis: ${reason}`);
      
      if (latestAnalysis && options.verbose) {
        console.log('Latest analysis info:');
        console.log(`- Timestamp: ${latestAnalysis.timestamp}`);
        console.log(`- Stage: ${latestAnalysis.stage}`);
        console.log(`- Players with podium chance: ${latestAnalysis.podiumContenders?.length || 0}`);
        console.log(`- Players with no podium chance: ${latestAnalysis.playersWithNoPodiumChance || 0}`);
      }
      
      console.log('To force analysis, run with --force option');
      return;
    }
    
    console.log(`Running analysis: ${reason}`);
    
    // Run analysis
    console.log('Running tournament possibilities analysis...');
    const startTime = Date.now();
    
    // Run the analysis, saving to DB if option is set
    const analysisData = await analyzeTournamentPossibilities(options['db-save']);
    
    const endTime = Date.now();
    console.log(`Analysis completed in ${((endTime - startTime) / 1000).toFixed(2)} seconds`);
    
    // Summary of analysis
    console.log('\nAnalysis Summary:');
    console.log(`- Tournament stage: ${analysisData.roundName}`);
    console.log(`- Total brackets: ${analysisData.totalBrackets}`);
    console.log(`- Possible outcomes: ${analysisData.totalPossibleOutcomes}`);
    console.log(`- Players with podium chance: ${analysisData.podiumContenders.length}`);
    console.log(`- Players with no podium chance: ${analysisData.playersWithNoPodiumChance}`);
    console.log(`- Players who can still win: ${analysisData.playersWithWinChance}`);
    console.log(`- Rare correct picks found: ${analysisData.rareCorrectPicks?.length || 0}`);
    
    console.log('\nAnalysis complete!');
  } catch (error) {
    console.error('Error running analysis:', error);
    process.exit(1);
  } finally {
    // Close database connection if it exists
    if (db) {
      await mongoose.connection.close();
      console.log('Database connection closed');
    }
  }
}

// Run the script
run()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Unhandled error:', err);
    process.exit(1);
  });