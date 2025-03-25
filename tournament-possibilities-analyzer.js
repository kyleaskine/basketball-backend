/**
 * Tournament Possibilities Analyzer
 * 
 * This script analyzes all possible remaining tournament outcomes and generates statistics
 * about each bracket's chances to win, potential scores, and other interesting metrics.
 */

const mongoose = require('mongoose');
require('dotenv').config();
const connectDB = require('./config/db');

// Models
const Bracket = require('./models/Bracket');
const TournamentResults = require('./models/TournamentResults');

/**
 * Main function to analyze tournament possibilities
 */
async function analyzeTournamentPossibilities() {
  try {
    // Connect to database
    await connectDB();
    console.log('MongoDB Connected');

    // Get current tournament state
    const tournament = await TournamentResults.findOne({ year: new Date().getFullYear() });
    if (!tournament) {
      throw new Error('No tournament data found for current year');
    }

    // Get all brackets
    const brackets = await Bracket.find({ isLocked: true });
    console.log(`Analyzing ${brackets.length} brackets`);

    // Get remaining games by finding incomplete matchups in round 3 (Sweet 16)
    const incompleteMatchups = [];
    for (const round in tournament.results) {
      if (parseInt(round) >= 3) { // Sweet 16 and beyond
        for (const matchup of tournament.results[round]) {
          if (!matchup.winner) {
            incompleteMatchups.push({
              ...matchup,
              round: parseInt(round)
            });
          }
        }
      }
    }

    console.log(`Found ${incompleteMatchups.length} incomplete matchups`);

    // Generate all possible outcomes (2^N combinations)
    const possibleOutcomes = generatePossibleOutcomes(incompleteMatchups);
    console.log(`Analyzing ${possibleOutcomes.length} possible tournament outcomes`);

    // Calculate bracket scores under each outcome
    const outcomeAnalysis = analyzeBracketScores(brackets, possibleOutcomes, tournament);

    // Generate interesting statistics
    const stats = generateStatistics(brackets, outcomeAnalysis, tournament);

    // Save the analysis results
    await saveAnalysisResults(stats);

    console.log('Analysis complete!');
    return stats;

  } catch (error) {
    console.error('Error in analysis:', error);
    throw error;
  } finally {
    // Close database connection
    mongoose.connection.close();
    console.log('Database connection closed');
  }
}

/**
 * Generate all possible outcomes for remaining games
 * @param {Array} incompleteMatchups - Array of matchups without winners
 * @returns {Array} All possible tournament outcomes
 */
function generatePossibleOutcomes(incompleteMatchups) {
  // For Sweet 16, we have 8 matchups = 2^8 = 256 possibilities just for that round
  // Total possibilities including future rounds is 2^15 = 32,768
  
  // Start with one empty outcome
  let outcomes = [{ matchupResults: {} }];
  
  // For each incomplete matchup, double the number of outcomes
  for (const matchup of incompleteMatchups) {
    const newOutcomes = [];
    
    // For each existing outcome
    for (const outcome of outcomes) {
      // Create two new outcomes - one for each possible winner
      if (matchup.teamA && matchup.teamB) {
        // TeamA wins
        newOutcomes.push({
          ...outcome,
          matchupResults: {
            ...outcome.matchupResults,
            [matchup.id]: { winner: matchup.teamA, matchupId: matchup.id, round: matchup.round }
          }
        });
        
        // TeamB wins
        newOutcomes.push({
          ...outcome,
          matchupResults: {
            ...outcome.matchupResults,
            [matchup.id]: { winner: matchup.teamB, matchupId: matchup.id, round: matchup.round }
          }
        });
      } else {
        // If teams not set yet, carry forward the outcome without changes
        newOutcomes.push(outcome);
      }
    }
    
    // Replace old outcomes with new doubled set
    outcomes = newOutcomes;
  }
  
  return outcomes;
}

/**
 * Analyze bracket scores under each possible outcome
 * @param {Array} brackets - All submitted brackets
 * @param {Array} possibleOutcomes - All possible tournament outcomes
 * @param {Object} tournament - Current tournament state
 * @returns {Object} Analysis of each bracket under each outcome
 */
function analyzeBracketScores(brackets, possibleOutcomes, tournament) {
  // For each possible outcome, calculate the score of each bracket
  const results = {
    outcomeScores: {}, // Scores by outcome ID
    bracketResults: {} // Results by bracket ID
  };
  
  // For each possible outcome
  possibleOutcomes.forEach((outcome, outcomeIndex) => {
    const outcomeId = `outcome_${outcomeIndex}`;
    results.outcomeScores[outcomeId] = {};
    
    // Create a tournament result with this outcome applied
    const projectedTournament = projectTournamentWithOutcome(tournament, outcome);
    
    // For each bracket, calculate the score
    brackets.forEach(bracket => {
      // Calculate projected score for this bracket under this outcome
      const projectedScore = calculateProjectedScore(bracket, projectedTournament);
      
      // Store in results
      results.outcomeScores[outcomeId][bracket._id] = projectedScore;
      
      // Initialize bracket results if needed
      if (!results.bracketResults[bracket._id]) {
        results.bracketResults[bracket._id] = {
          participantName: bracket.participantName,
          entryNumber: bracket.entryNumber || 1,
          currentScore: bracket.score,
          outcomesWon: 0,
          possibleScores: [],
          minScore: Infinity,
          maxScore: -Infinity,
          avgScore: 0,
          wins: {},
          places: { 1: 0, 2: 0, 3: 0 } // Count of 1st, 2nd, 3rd place finishes
        };
      }
      
      // Update bracket results
      results.bracketResults[bracket._id].possibleScores.push(projectedScore);
      results.bracketResults[bracket._id].minScore = Math.min(
        results.bracketResults[bracket._id].minScore, 
        projectedScore
      );
      results.bracketResults[bracket._id].maxScore = Math.max(
        results.bracketResults[bracket._id].maxScore, 
        projectedScore
      );
    });
    
    // Determine rankings for this outcome
    const bracketIds = Object.keys(results.outcomeScores[outcomeId]);
    const sortedIds = bracketIds.sort((a, b) => {
      return results.outcomeScores[outcomeId][b] - results.outcomeScores[outcomeId][a];
    });
    
    // Record 1st, 2nd, 3rd place finishes
    const positions = determinePositions(sortedIds, results.outcomeScores[outcomeId]);
    
    // Track win counts
    const winner = positions[0][0]; // First place bracket ID (or first one in case of tie)
    results.bracketResults[winner].outcomesWon++;
    
    // Record all positions
    positions.forEach((bracketIds, index) => {
      const position = index + 1;
      if (position <= 3) { // Only track top 3
        bracketIds.forEach(bracketId => {
          results.bracketResults[bracketId].places[position]++;
        });
      }
    });
  });
  
  // Calculate averages and percentages
  const totalOutcomes = possibleOutcomes.length;
  for (const bracketId in results.bracketResults) {
    const bracketResult = results.bracketResults[bracketId];
    
    // Calculate average score
    const sum = bracketResult.possibleScores.reduce((a, b) => a + b, 0);
    bracketResult.avgScore = sum / totalOutcomes;
    
    // Calculate win percentage
    bracketResult.winPercentage = (bracketResult.outcomesWon / totalOutcomes) * 100;
    
    // Calculate place percentages
    bracketResult.placePercentages = {
      1: (bracketResult.places[1] / totalOutcomes) * 100,
      2: (bracketResult.places[2] / totalOutcomes) * 100,
      3: (bracketResult.places[3] / totalOutcomes) * 100,
      podium: ((bracketResult.places[1] + bracketResult.places[2] + bracketResult.places[3]) / totalOutcomes) * 100
    };
    
    // Remove the raw scores array to save space
    delete bracketResult.possibleScores;
  }
  
  return results;
}

/**
 * Determine positions for brackets given their scores
 * @param {Array} sortedIds - Bracket IDs sorted by score
 * @param {Object} scores - Score for each bracket ID
 * @returns {Array} Array of arrays, each containing bracket IDs at that position
 */
function determinePositions(sortedIds, scores) {
  const positions = [];
  let currentPosition = [];
  let currentScore = null;
  
  sortedIds.forEach(bracketId => {
    const score = scores[bracketId];
    
    if (currentScore === null || score === currentScore) {
      // Same score, add to current position
      currentPosition.push(bracketId);
    } else {
      // New score, new position
      positions.push(currentPosition);
      currentPosition = [bracketId];
    }
    
    currentScore = score;
  });
  
  // Add the last position
  if (currentPosition.length > 0) {
    positions.push(currentPosition);
  }
  
  return positions;
}

/**
 * Project full tournament outcomes based on a specific outcome scenario
 * @param {Object} tournament - Current tournament state
 * @param {Object} outcome - A specific outcome scenario
 * @returns {Object} Projected tournament results
 */
function projectTournamentWithOutcome(tournament, outcome) {
  // Deep clone the tournament to avoid modifying the original
  const projectedTournament = JSON.parse(JSON.stringify(tournament));
  
  // Apply outcome results to the tournament
  for (const matchupId in outcome.matchupResults) {
    const matchupResult = outcome.matchupResults[matchupId];
    const matchupRound = matchupResult.round;
    
    // Find and update the matchup
    const matchup = projectedTournament.results[matchupRound].find(m => m.id === parseInt(matchupId));
    if (matchup) {
      matchup.winner = matchupResult.winner;
      
      // Propagate the result to the next round
      if (matchup.nextMatchupId !== null) {
        propagateResult(
          projectedTournament, 
          matchup.nextMatchupId, 
          matchupResult.winner,
          matchup.position % 2 === 0 // even positions are teamA
        );
      }
    }
  }
  
  return projectedTournament;
}

/**
 * Propagate a matchup result to future rounds
 * @param {Object} tournament - Tournament to update
 * @param {Number} nextMatchupId - ID of the next matchup
 * @param {Object} winner - Winner to propagate
 * @param {Boolean} isTeamA - Whether this winner goes to the teamA slot
 */
function propagateResult(tournament, nextMatchupId, winner, isTeamA) {
  // Find the next matchup in any future round
  for (let round = 3; round <= 6; round++) {
    const nextMatchup = tournament.results[round]?.find(m => m.id === nextMatchupId);
    if (nextMatchup) {
      // Update the appropriate team slot
      if (isTeamA) {
        nextMatchup.teamA = winner;
      } else {
        nextMatchup.teamB = winner;
      }
      
      // If both teams are set and we have a projected winner, propagate further
      if (nextMatchup.teamA && nextMatchup.teamB && nextMatchup.winner) {
        if (nextMatchup.nextMatchupId !== null) {
          propagateResult(
            tournament,
            nextMatchup.nextMatchupId,
            nextMatchup.winner,
            nextMatchup.position % 2 === 0
          );
        }
      }
      
      // Exit after finding and updating the next matchup
      break;
    }
  }
}

/**
 * Calculate a bracket's projected score for a given tournament outcome
 * @param {Object} bracket - A bracket submission
 * @param {Object} projectedTournament - Tournament with projected results
 * @returns {Number} Projected score
 */
function calculateProjectedScore(bracket, projectedTournament) {
  let score = 0;
  const scoringConfig = projectedTournament.scoringConfig || { 
    1: 1, 2: 2, 3: 4, 4: 8, 5: 16, 6: 32 
  };
  
  // Start from current completed rounds
  const startRound = (projectedTournament.completedRounds || []).length > 0 
    ? Math.max(...projectedTournament.completedRounds) + 1 
    : 1;
  
  // Calculate score for each round
  for (let round = startRound; round <= 6; round++) {
    // Skip if this round doesn't exist in either bracket or projected results
    if (!projectedTournament.results[round] || !bracket.picks[round]) continue;
    
    // Check each matchup in the round
    for (const tournamentMatchup of projectedTournament.results[round]) {
      // Skip if tournament matchup doesn't have a winner
      if (!tournamentMatchup.winner) continue;
      
      // Find corresponding bracket matchup
      const bracketMatchup = bracket.picks[round].find(m => m.id === tournamentMatchup.id);
      if (!bracketMatchup || !bracketMatchup.winner) continue;
      
      // Check if the winner matches
      if (
        bracketMatchup.winner.name === tournamentMatchup.winner.name &&
        bracketMatchup.winner.seed === tournamentMatchup.winner.seed
      ) {
        // Add points based on the round
        score += scoringConfig[round];
      }
    }
  }
  
  // Add current score from completed rounds
  return score + (bracket.score || 0);
}

/**
 * Generate interesting statistics from the analysis
 * @param {Array} brackets - All submitted brackets
 * @param {Object} analysis - Results of analysis
 * @param {Object} tournament - Current tournament state
 * @returns {Object} Interesting statistics
 */
function generateStatistics(brackets, analysis, tournament) {
  const bracketResults = analysis.bracketResults;
  const bracketIds = Object.keys(bracketResults);
  
  // Sort brackets by win percentage
  const sortedByWinChance = [...bracketIds].sort((a, b) => {
    return bracketResults[b].winPercentage - bracketResults[a].winPercentage;
  });
  
  // Sort brackets by podium finish percentage
  const sortedByPodiumChance = [...bracketIds].sort((a, b) => {
    return bracketResults[b].placePercentages.podium - bracketResults[a].placePercentages.podium;
  });
  
  // Sort brackets by maximum possible score
  const sortedByMaxScore = [...bracketIds].sort((a, b) => {
    return bracketResults[b].maxScore - bracketResults[a].maxScore;
  });
  
  // Find brackets with the most variance (max - min)
  const sortedByVariance = [...bracketIds].sort((a, b) => {
    const varianceA = bracketResults[a].maxScore - bracketResults[a].minScore;
    const varianceB = bracketResults[b].maxScore - bracketResults[b].minScore;
    return varianceB - varianceA;
  });
  
  // Identify Cinderella teams (teams still alive that are high seeds)
  const cinderellaTeams = findCinderellaTeams(tournament);
  
  // Identify teams most picked to win in brackets
  const championshipPicks = calculateChampionshipPicks(brackets);
  
  // Most common bracket outcomes
  const bracketOutcomes = calculateCommonOutcomes(brackets, tournament);
  
  return {
    timestamp: new Date(),
    totalBrackets: brackets.length,
    totalPossibleOutcomes: Math.pow(2, 15), // 2^15 for Sweet 16
    bracketResults: analysis.bracketResults,
    topContenders: sortedByWinChance.slice(0, 10).map(id => ({
      id,
      ...bracketResults[id]
    })),
    podiumContenders: sortedByPodiumChance.slice(0, 10).map(id => ({
      id,
      ...bracketResults[id]
    })),
    highestCeilings: sortedByMaxScore.slice(0, 10).map(id => ({
      id,
      ...bracketResults[id]
    })),
    mostVolatile: sortedByVariance.slice(0, 10).map(id => ({
      id,
      ...bracketResults[id]
    })),
    cinderellaTeams,
    championshipPicks,
    bracketOutcomes,
    roundName: 'Sweet 16',
    currentRound: 3
  };
}

/**
 * Find Cinderella teams still in the tournament
 * @param {Object} tournament - Current tournament state
 * @returns {Array} List of Cinderella teams
 */
function findCinderellaTeams(tournament) {
  const cinderellaTeams = [];
  const eliminatedTeams = new Set();
  
  // Build a list of eliminated teams
  if (tournament.teams) {
    for (const teamName in tournament.teams) {
      if (tournament.teams[teamName].eliminated) {
        eliminatedTeams.add(teamName);
      }
    }
  }
  
  // Collect active teams from remaining matchups
  const activeTeams = new Map();
  
  for (let round = 3; round <= 6; round++) {
    if (!tournament.results[round]) continue;
    
    for (const matchup of tournament.results[round]) {
      if (matchup.teamA && !eliminatedTeams.has(matchup.teamA.name)) {
        activeTeams.set(matchup.teamA.name, matchup.teamA.seed);
      }
      if (matchup.teamB && !eliminatedTeams.has(matchup.teamB.name)) {
        activeTeams.set(matchup.teamB.name, matchup.teamB.seed);
      }
    }
  }
  
  // Define Cinderella teams as seed 5 or higher
  for (const [teamName, seed] of activeTeams.entries()) {
    if (seed >= 5) {
      cinderellaTeams.push({ name: teamName, seed });
    }
  }
  
  return cinderellaTeams.sort((a, b) => b.seed - a.seed); // Sort by seed (highest first)
}

/**
 * Calculate how often each team was picked to win the championship
 * @param {Array} brackets - All submitted brackets
 * @returns {Object} Championship pick statistics
 */
function calculateChampionshipPicks(brackets) {
  const championCounts = {};
  let totalPicks = 0;
  
  brackets.forEach(bracket => {
    // Find championship matchup
    if (bracket.picks && bracket.picks[6] && bracket.picks[6][0] && bracket.picks[6][0].winner) {
      const champion = bracket.picks[6][0].winner;
      const teamKey = `${champion.name} (${champion.seed})`;
      
      championCounts[teamKey] = (championCounts[teamKey] || 0) + 1;
      totalPicks++;
    }
  });
  
  // Calculate percentages and sort
  const result = [];
  for (const team in championCounts) {
    result.push({
      team,
      count: championCounts[team],
      percentage: (championCounts[team] / totalPicks) * 100
    });
  }
  
  return result.sort((a, b) => b.count - a.count);
}

/**
 * Calculate most common bracket outcomes for Sweet 16 and beyond
 * @param {Array} brackets - All submitted brackets
 * @param {Object} tournament - Current tournament state
 * @returns {Object} Common bracket outcomes
 */
function calculateCommonOutcomes(brackets, tournament) {
  // Analyze Sweet 16 picks
  const sweet16Picks = {};
  // Final Four composition picks
  const finalFourPicks = {};
  // Championship matchup picks
  const championshipMatchups = {};
  
  brackets.forEach(bracket => {
    // Sweet 16 winners (Round 3)
    if (bracket.picks && bracket.picks[3]) {
      bracket.picks[3].forEach(matchup => {
        if (matchup.winner) {
          const key = `${matchup.id}_${matchup.winner.name}`;
          sweet16Picks[key] = (sweet16Picks[key] || 0) + 1;
        }
      });
    }
    
    // Final Four teams (winners from Round 4)
    if (bracket.picks && bracket.picks[4]) {
      const finalFourTeams = [];
      bracket.picks[4].forEach(matchup => {
        if (matchup.winner) {
          finalFourTeams.push(matchup.winner.name);
        }
      });
      
      if (finalFourTeams.length === 4) {
        const key = finalFourTeams.sort().join(',');
        finalFourPicks[key] = (finalFourPicks[key] || 0) + 1;
      }
    }
    
    // Championship matchup (teams in Round 6)
    if (bracket.picks && bracket.picks[6] && bracket.picks[6][0]) {
      const matchup = bracket.picks[6][0];
      if (matchup.teamA && matchup.teamB) {
        // Sort team names to ensure consistent keys
        const teams = [matchup.teamA.name, matchup.teamB.name].sort();
        const key = teams.join(' vs ');
        championshipMatchups[key] = (championshipMatchups[key] || 0) + 1;
      }
    }
  });
  
  // Format and sort results
  return {
    sweet16: formatAndSortPicks(sweet16Picks, brackets.length),
    finalFour: formatAndSortPicks(finalFourPicks, brackets.length),
    championship: formatAndSortPicks(championshipMatchups, brackets.length)
  };
}

/**
 * Format and sort pick counts
 * @param {Object} pickCounts - Raw pick counts
 * @param {Number} totalBrackets - Total number of brackets
 * @returns {Array} Formatted and sorted picks
 */
function formatAndSortPicks(pickCounts, totalBrackets) {
  const result = [];
  for (const key in pickCounts) {
    result.push({
      key,
      count: pickCounts[key],
      percentage: (pickCounts[key] / totalBrackets) * 100
    });
  }
  
  return result.sort((a, b) => b.count - a.count).slice(0, 10); // Top 10 most common
}

/**
 * Save analysis results to database
 * @param {Object} stats - Analysis results
 */
async function saveAnalysisResults(stats) {
  // You could create a dedicated model/collection for storing these results
  // For now, just log that we would save them
  console.log('Would save analysis results to database');
  console.log(`Analysis timestamp: ${stats.timestamp}`);
  console.log(`Total brackets analyzed: ${stats.totalBrackets}`);
  console.log(`Total possible outcomes: ${stats.totalPossibleOutcomes}`);
  
  // Optionally, save to a file for testing
  const fs = require('fs');
  fs.writeFileSync(
    `./tournament-analysis-${new Date().toISOString().replace(/:/g, '-')}.json`,
    JSON.stringify(stats, null, 2)
  );
}

// Export for external use
module.exports = {
  analyzeTournamentPossibilities,
  generatePossibleOutcomes,
  analyzeBracketScores,
  generateStatistics
};

// Run standalone if executed directly
if (require.main === module) {
  analyzeTournamentPossibilities()
    .then(() => {
      console.log('Analysis script completed successfully');
      process.exit(0);
    })
    .catch(err => {
      console.error('Error running analysis script:', err);
      process.exit(1);
    });
}