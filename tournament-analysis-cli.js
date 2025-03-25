/**
 * Tournament Analysis CLI
 * 
 * This script runs the tournament possibilities analysis and can be
 * scheduled to run at specific intervals (e.g., with cron).
 * 
 * Usage:
 *   node tournament-analysis-cli.js --stage=sweet16
 * 
 * Stages:
 *   - sweet16 (2^15 = 32,768 possibilities)
 *   - elite8 (2^7 = 128 possibilities)
 *   - final4 (2^3 = 8 possibilities)
 *   - championship (2^1 = 2 possibilities)
 */

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const connectDB = require('./config/db');
const { analyzeTournamentPossibilities } = require('./tournament-possibilities-analyzer');

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  stage: 'auto', // Default to auto-detect
  output: './analysis-cache',
  verbose: false
};

// Parse options
args.forEach(arg => {
  const [key, value] = arg.split('=');
  if (key.startsWith('--')) {
    options[key.slice(2)] = value || true;
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

async function run() {
  try {
    console.log('Tournament Analysis CLI');
    console.log('----------------------');
    console.log('Options:', options);
    
    // Ensure output directory exists
    await ensureDirectoryExists(outputDir);
    
    // Connect to database
    await connectDB();
    console.log('Connected to database');
    
    // Run analysis
    console.log('Running tournament possibilities analysis...');
    const startTime = Date.now();
    const analysisData = await analyzeTournamentPossibilities();
    const endTime = Date.now();
    console.log(`Analysis completed in ${((endTime - startTime) / 1000).toFixed(2)} seconds`);
    
    // Save results
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const stage = options.stage !== 'auto' ? options.stage : analysisData.roundName.toLowerCase().replace(/\s+/g, '');
    const filename = `tournament-analysis-${stage}-${timestamp}.json`;
    const outputPath = path.join(outputDir, filename);
    
    await fs.writeFile(outputPath, JSON.stringify(analysisData, null, 2));
    console.log(`Analysis saved to ${outputPath}`);
    
    // Create a copy as "latest.json" for easy access
    const latestPath = path.join(outputDir, `tournament-analysis-${stage}-latest.json`);
    await fs.writeFile(latestPath, JSON.stringify(analysisData, null, 2));
    console.log(`Latest analysis for ${stage} saved to ${latestPath}`);
    
    // Clean up old files (keep last 5 per stage)
    const files = await fs.readdir(outputDir);
    const stageFiles = files
      .filter(f => f.startsWith(`tournament-analysis-${stage}-`) && f.endsWith('.json') && !f.includes('latest'))
      .sort()
      .reverse();
    
    if (stageFiles.length > 5) {
      console.log(`Cleaning up old analysis files for ${stage} (keeping latest 5)...`);
      for (let i = 5; i < stageFiles.length; i++) {
        await fs.unlink(path.join(outputDir, stageFiles[i]));
        if (options.verbose) {
          console.log(`Deleted ${stageFiles[i]}`);
        }
      }
    }
    
    console.log('Analysis complete!');
    process.exit(0);
  } catch (error) {
    console.error('Error running analysis:', error);
    process.exit(1);
  }
}

// Run the script
run();