/**
 * Tournament Possibilities Analyzer
 *
 * This script analyzes all possible remaining tournament outcomes and generates statistics
 * about each bracket's chances to win, potential scores, and other interesting metrics.
 */

const mongoose = require("mongoose");
require("dotenv").config();
const connectDB = require("./config/db");

// Models
const Bracket = require("./models/Bracket");
const TournamentResults = require("./models/TournamentResults");
const TournamentAnalysis = require("./models/TournamentAnalysis");

/**
 * Main function to analyze tournament possibilities
 * @param {Boolean} shouldSaveToDb - Whether to save the results to database
 * @returns {Object} Analysis results or error object
 */
async function analyzeTournamentPossibilities(shouldSaveToDb = false) {
    let dbConnection = null;
    
    try {
      // Connect to database
      dbConnection = await connectDB();
      console.log("MongoDB Connected");
  
      // Get current tournament state
      const tournament = await TournamentResults.findOne({
        year: new Date().getFullYear(),
      });
      if (!tournament) {
        throw new Error("No tournament data found for current year");
      }
  
      // Check if we're at Sweet 16 or beyond (16 or fewer teams remaining)
      const activeTeams = getActiveTeams(tournament);
      if (activeTeams.length > 16) {
        console.log(`Tournament has ${activeTeams.length} active teams - too many for analysis (need 16 or fewer)`);
        return {
          error: true,
          message: "Analysis is only available once the tournament reaches Sweet 16 (16 or fewer teams)",
          activeTeamCount: activeTeams.length
        };
      }
  
      // Get tournament stage information
      const stageInfo = determineTournamentStage(tournament);
      console.log(`Current tournament stage: ${stageInfo.roundName} (${stageInfo.progress})`);
      
      // Get all brackets
      const brackets = await Bracket.find({ isLocked: true });
      console.log(`Analyzing ${brackets.length} brackets`);
  
      // Calculate possible outcomes
      const possibleOutcomesCount = calculatePossibleOutcomes(tournament);
      console.log(`Tournament has ${possibleOutcomesCount} possible outcomes remaining`);
  
      // Generate all possible outcomes
      const possibleOutcomes = generatePossibleOutcomes(tournament);
      console.log(`Generated ${possibleOutcomes.length} outcomes for analysis`);
  
      // Calculate bracket scores under each outcome
      const outcomeAnalysis = analyzeBracketScores(
        brackets,
        possibleOutcomes,
        tournament
      );
  
      // Generate statistics
      const stats = generateStatistics(brackets, outcomeAnalysis, tournament, possibleOutcomes);
      
      // Save results to database if explicitly requested
      if (shouldSaveToDb) {
        const savedAnalysis = await saveAnalysisToDb(stats);
        console.log(`Analysis saved to database with ID: ${savedAnalysis._id}`);
      } else {
        console.log("Analysis complete (not saved to database)");
      }
  
      return stats;
    } catch (error) {
      console.error("Error in analysis:", error);
      throw error;
    }
  }

/**
 * Calculate appropriate description of the tournament stage
 * @param {Object} tournament - Current tournament data
 * @returns {Object} Stage information
 */
function determineTournamentStage(tournament) {
  // Get completed rounds
  const completedRounds = tournament.completedRounds || [];
  
  // Determine the current round
  let currentRound = 3; // Default to Sweet 16
  let roundName = 'Sweet 16';
  let stage = 'sweet16';
  
  if (completedRounds.includes(3)) {
    currentRound = 4;
    roundName = 'Elite 8';
    stage = 'elite8';
  }
  if (completedRounds.includes(4)) {
    currentRound = 5;
    roundName = 'Final Four';
    stage = 'final4';
  }
  if (completedRounds.includes(5)) {
    currentRound = 6;
    roundName = 'Championship';
    stage = 'championship';
  }
  
  // Count completed and total games in the current round
  let completedGames = 0;
  let totalGames = 0;
  
  if (tournament.results && tournament.results[currentRound]) {
    totalGames = tournament.results[currentRound].length;
    completedGames = tournament.results[currentRound].filter(
      matchup => matchup.winner
    ).length;
  }
  
  // Calculate progress
  const progress = totalGames > 0 ? 
    `${completedGames}/${totalGames} games complete` : 
    'No games found';
  
  return {
    currentRound,
    roundName,
    stage,
    completedGames,
    totalGames,
    progress
  };
}

/**
 * Calculate the total possible outcomes based on incomplete games
 * @param {Object} tournament - Current tournament data
 * @returns {Number} Number of possible outcomes
 */
function calculatePossibleOutcomes(tournament) {
  // Get completed rounds
  const completedRounds = tournament.completedRounds || [];
  
  // Determine the current round
  let currentRound = 3; // Default to Sweet 16
  if (completedRounds.includes(3)) currentRound = 4; // Elite 8
  if (completedRounds.includes(4)) currentRound = 5; // Final Four
  if (completedRounds.includes(5)) currentRound = 6; // Championship
  
  // Count incomplete games in the current round
  let incompleteGamesCount = 0;
  
  if (tournament.results && tournament.results[currentRound]) {
    // Count matchups that don't have a winner yet
    incompleteGamesCount = tournament.results[currentRound].filter(
      matchup => !matchup.winner && matchup.teamA && matchup.teamB
    ).length;
  }
  
  // Count incomplete games in future rounds
  for (let round = currentRound + 1; round <= 6; round++) {
    if (tournament.results && tournament.results[round]) {
      const matchupsInRound = tournament.results[round].length;
      incompleteGamesCount += matchupsInRound;
    }
  }
  
  // Calculate 2^(number of incomplete games)
  return Math.pow(2, incompleteGamesCount);
}

/**
 * Generate all possible outcomes for remaining games including future rounds
 * @param {Object} tournament - Current tournament state
 * @returns {Array} All possible tournament outcomes
 */
function generatePossibleOutcomes(tournament) {
  // Get all incomplete matchups from the current round
  const currentRound = determineCurrentRound(tournament);
  
  // Get only incomplete matchups from the current round
  const incompleteMatchups = tournament.results[currentRound]
    .filter((matchup) => !matchup.winner && matchup.teamA && matchup.teamB)
    .map((matchup) => ({
      ...matchup,
      round: currentRound,
    }));

  console.log(`Found ${incompleteMatchups.length} incomplete matchups in round ${currentRound}`);

  // Start with one empty outcome
  let outcomes = [
    {
      matchupResults: {}, // Maps matchupId -> result
      projectedMatchups: {}, // Tracks matchups we create for future rounds
    },
  ];

  // Process the incomplete matchups in the current round
  for (const matchup of incompleteMatchups) {
    const newOutcomes = [];

    // For each existing outcome
    for (const outcome of outcomes) {
      // TeamA wins
      const teamAWinsOutcome = {
        ...outcome,
        matchupResults: {
          ...outcome.matchupResults,
          [matchup.id]: {
            winner: matchup.teamA,
            matchupId: matchup.id,
            round: matchup.round,
          },
        },
        projectedMatchups: { ...outcome.projectedMatchups },
      };

      // TeamB wins
      const teamBWinsOutcome = {
        ...outcome,
        matchupResults: {
          ...outcome.matchupResults,
          [matchup.id]: {
            winner: matchup.teamB,
            matchupId: matchup.id,
            round: matchup.round,
          },
        },
        projectedMatchups: { ...outcome.projectedMatchups },
      };

      // Project the next round matchup for both outcomes
      projectNextRoundMatchup(
        tournament,
        teamAWinsOutcome,
        matchup.id,
        matchup.teamA
      );
      projectNextRoundMatchup(
        tournament,
        teamBWinsOutcome,
        matchup.id,
        matchup.teamB
      );

      newOutcomes.push(teamAWinsOutcome, teamBWinsOutcome);
    }

    // Replace old outcomes with new doubled set
    outcomes = newOutcomes;
  }

  // Now process future rounds
  for (let round = currentRound + 1; round <= 6; round++) {
    outcomes = processNextRoundOutcomes(tournament, outcomes, round);
  }

  return outcomes;
}

/**
 * Determine the current round based on tournament state
 * @param {Object} tournament - Current tournament state
 * @returns {Number} Current round number
 */
function determineCurrentRound(tournament) {
  const completedRounds = tournament.completedRounds || [];
  
  // Look at completed rounds to determine the current round
  if (completedRounds.includes(5)) return 6; // Championship
  if (completedRounds.includes(4)) return 5; // Final Four
  if (completedRounds.includes(3)) return 4; // Elite 8
  return 3; // Sweet 16
}

/**
 * Process a round of outcomes based on the projected matchups from previous rounds
 * @param {Object} tournament - Current tournament state
 * @param {Array} currentOutcomes - Current set of possible outcomes
 * @param {Number} round - Round to process (4, 5, or 6)
 * @returns {Array} Updated set of outcomes
 */
function processNextRoundOutcomes(tournament, currentOutcomes, round) {
  let newOutcomes = [];

  // For each existing outcome
  for (const outcome of currentOutcomes) {
    // Get projected matchups for this round from this outcome
    const roundMatchups = Object.values(outcome.projectedMatchups).filter(
      (m) => m.round === round
    );

    if (roundMatchups.length === 0) {
      // If no matchups for this round, just keep the outcome as is
      newOutcomes.push(outcome);
      continue;
    }

    // Start with just this outcome
    let outcomeVariations = [outcome];

    // For each matchup in this round, double the variations
    for (const matchup of roundMatchups) {
      const doubledVariations = [];

      // For each current variation
      for (const variation of outcomeVariations) {
        // TeamA wins
        const teamAWinsVariation = {
          ...variation,
          matchupResults: {
            ...variation.matchupResults,
            [matchup.id]: {
              winner: matchup.teamA,
              matchupId: matchup.id,
              round: matchup.round,
            },
          },
          projectedMatchups: { ...variation.projectedMatchups },
        };

        // TeamB wins
        const teamBWinsVariation = {
          ...variation,
          matchupResults: {
            ...variation.matchupResults,
            [matchup.id]: {
              winner: matchup.teamB,
              matchupId: matchup.id,
              round: matchup.round,
            },
          },
          projectedMatchups: { ...variation.projectedMatchups },
        };

        // Project the next round matchup for both variations (if not final round)
        if (round < 6) {
          projectNextRoundMatchup(
            tournament,
            teamAWinsVariation,
            matchup.id,
            matchup.teamA
          );
          projectNextRoundMatchup(
            tournament,
            teamBWinsVariation,
            matchup.id,
            matchup.teamB
          );
        }

        doubledVariations.push(teamAWinsVariation, teamBWinsVariation);
      }

      // Replace current variations with doubled set
      outcomeVariations = doubledVariations;
    }

    // Add all variations to new outcomes
    newOutcomes = newOutcomes.concat(outcomeVariations);
  }

  if (newOutcomes.length > 0) {
    console.log(`After processing round ${round}, we have ${newOutcomes.length} possible outcomes`);
  }
  
  return newOutcomes;
}

/**
 * Project what the next round matchup would be given a winner for this matchup
 * @param {Object} tournament - Tournament structure
 * @param {Object} outcome - Current outcome to update
 * @param {Number} matchupId - ID of the current matchup
 * @param {Object} winner - Winner of the matchup
 */
function projectNextRoundMatchup(tournament, outcome, matchupId, winner) {
  // Find the current matchup in tournament structure
  let currentMatchup = null;
  let currentRound = 0;

  // Look for the matchup in all rounds
  for (let round = 3; round <= 6; round++) {
    const matchupData = tournament.results[round]?.find(
      (m) => m.id === matchupId
    );
    if (matchupData) {
      currentMatchup = matchupData;
      currentRound = round;
      break;
    }
  }

  if (!currentMatchup || currentRound >= 6 || !currentMatchup.nextMatchupId) {
    // No next matchup for championship or if structure is incomplete
    return;
  }

  // Get or create the next matchup
  const nextMatchupId = currentMatchup.nextMatchupId;
  const nextRound = currentRound + 1;

  // Check if next matchup already exists in our projected matchups
  if (!outcome.projectedMatchups[nextMatchupId]) {
    // Find the base next matchup structure from tournament results
    let baseNextMatchup = tournament.results[nextRound]?.find(
      (m) => m.id === nextMatchupId
    );

    if (!baseNextMatchup) {
      console.warn(
        `Could not find matchup ${nextMatchupId} in round ${nextRound}`
      );
      return;
    }

    // Create a new projected matchup
    outcome.projectedMatchups[nextMatchupId] = {
      ...baseNextMatchup,
      round: nextRound,
      teamA: null,
      teamB: null,
    };
  }

  // Determine if this winner is teamA or teamB in the next matchup
  // In bracket structures, even positions (0, 2, 4...) go to teamA spot
  // and odd positions (1, 3, 5...) go to teamB spot
  const isTeamA = currentMatchup.position % 2 === 0;

  // Update the next matchup in our projected matchups
  if (isTeamA) {
    outcome.projectedMatchups[nextMatchupId].teamA = winner;
  } else {
    outcome.projectedMatchups[nextMatchupId].teamB = winner;
  }
}

/**
 * Analyze bracket scores under each possible outcome with proper tie handling
 * @param {Array} brackets - All submitted brackets
 * @param {Array} possibleOutcomes - All possible tournament outcomes
 * @param {Object} tournament - Current tournament state
 * @returns {Object} Analysis of each bracket under each outcome
 */
function analyzeBracketScores(brackets, possibleOutcomes, tournament) {
  // For each possible outcome, calculate the score of each bracket
  const results = {
    outcomeScores: {}, // Scores by outcome ID
    bracketResults: {}, // Results by bracket ID
  };

  // For each possible outcome
  possibleOutcomes.forEach((outcome, outcomeIndex) => {
    const outcomeId = `outcome_${outcomeIndex}`;
    results.outcomeScores[outcomeId] = {};

    // Create a tournament result with this outcome applied
    const projectedTournament = projectTournamentWithOutcome(
      tournament,
      outcome
    );

    // For each bracket, calculate the score
    brackets.forEach((bracket) => {
      // Calculate projected score for this bracket under this outcome
      const projectedScore = calculateProjectedScore(
        bracket,
        projectedTournament
      );

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
          minPlace: Infinity,
          maxPlace: 0,
          wins: {},
          places: { 1: 0, 2: 0, 3: 0 }, // Count of 1st, 2nd, 3rd place finishes
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
      return (
        results.outcomeScores[outcomeId][b] -
        results.outcomeScores[outcomeId][a]
      );
    });

    // Group brackets by score
    const positions = determinePositions(
      sortedIds,
      results.outcomeScores[outcomeId]
    );

    // Assign correct positions with proper tie handling
    assignPositionsWithTies(positions, results.bracketResults, outcomeId);
  });

  // Calculate averages and percentages
  const totalOutcomes = possibleOutcomes.length;
  for (const bracketId in results.bracketResults) {
    const bracketResult = results.bracketResults[bracketId];

    // Calculate average score
    const sum = bracketResult.possibleScores.reduce((a, b) => a + b, 0);
    bracketResult.avgScore = sum / totalOutcomes;

    // Calculate win percentage
    bracketResult.winPercentage =
      (bracketResult.outcomesWon / totalOutcomes) * 100;

    // Calculate place percentages
    bracketResult.placePercentages = {
      1: (bracketResult.places[1] / totalOutcomes) * 100,
      2: (bracketResult.places[2] / totalOutcomes) * 100,
      3: (bracketResult.places[3] / totalOutcomes) * 100,
      podium:
        ((bracketResult.places[1] +
          bracketResult.places[2] +
          bracketResult.places[3]) /
          totalOutcomes) *
        100,
    };

    // Remove the raw scores array to save space
    delete bracketResult.possibleScores;
  }

  return results;
}

/**
 * Assign positions to brackets with proper tie handling
 * @param {Array} positions - Array of arrays, each containing bracket IDs at that tier
 * @param {Object} bracketResults - Results object to update
 * @param {String} outcomeId - ID of the current outcome being processed
 */
function assignPositionsWithTies(positions, bracketResults, outcomeId) {
  let currentPosition = 1;

  for (let i = 0; i < positions.length; i++) {
    const bracketIds = positions[i];
    const tieSize = bracketIds.length;

    // Assign the current position to all brackets in this group
    bracketIds.forEach((bracketId) => {
      // If position is 1, increment outcomesWon (ALL tied for first are winners)
      if (currentPosition === 1) {
        bracketResults[bracketId].outcomesWon++;
        
        // Track which outcomes this bracket wins (for path analysis)
        if (!bracketResults[bracketId].wins) {
          bracketResults[bracketId].wins = {};
        }
        bracketResults[bracketId].wins[outcomeId] = true;
      }

      // Record the position (1, 2, or 3)
      if (currentPosition <= 3) {
        bracketResults[bracketId].places[currentPosition]++;
      }

      // Track min/max finishing position
      bracketResults[bracketId].minPlace = Math.min(
        bracketResults[bracketId].minPlace,
        currentPosition
      );

      bracketResults[bracketId].maxPlace = Math.max(
        bracketResults[bracketId].maxPlace,
        currentPosition
      );
    });

    // Update currentPosition for the next group - always increment by the number of tied brackets
    currentPosition += tieSize;
  }
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

  sortedIds.forEach((bracketId) => {
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

    // Find and update the matchup or create it if it doesn't exist
    let matchup = projectedTournament.results[matchupRound].find(
      (m) => m.id === parseInt(matchupId)
    );

    if (!matchup) {
      // If this is a projected matchup we created, add it to the tournament
      if (outcome.projectedMatchups && outcome.projectedMatchups[matchupId]) {
        const projectedMatchup = outcome.projectedMatchups[matchupId];
        projectedTournament.results[matchupRound].push(projectedMatchup);
        matchup = projectedTournament.results[matchupRound].find(
          (m) => m.id === parseInt(matchupId)
        );
      }
    }

    if (matchup) {
      // Make sure teams are set in the matchup
      if (outcome.projectedMatchups && outcome.projectedMatchups[matchupId]) {
        const projectedMatchup = outcome.projectedMatchups[matchupId];
        matchup.teamA = projectedMatchup.teamA;
        matchup.teamB = projectedMatchup.teamB;
      }

      matchup.winner = matchupResult.winner;
    }
  }

  return projectedTournament;
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
    1: 1,
    2: 2,
    3: 4,
    4: 8,
    5: 16,
    6: 32,
  };

  // Start from current completed rounds
  const startRound =
    (projectedTournament.completedRounds || []).length > 0
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
      const bracketMatchup = bracket.picks[round].find(
        (m) => m.id === tournamentMatchup.id
      );
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
 * Generate statistics from the analysis results
 * @param {Array} brackets - All brackets
 * @param {Object} analysis - Analysis results
 * @param {Object} tournament - Tournament data
 * @param {Array} possibleOutcomes - All possible tournament outcomes
 * @returns {Object} Statistics
 */
function generateStatistics(brackets, analysis, tournament, possibleOutcomes) {
    const bracketResults = analysis.bracketResults;
    const bracketIds = Object.keys(bracketResults);
    
    // Get current tournament stage information
    const stageInfo = determineTournamentStage(tournament);
    
    // Calculate the actual number of possible outcomes
    const totalPossibleOutcomes = calculatePossibleOutcomes(tournament);
    
    // Count players who can still win
    const playersWithWinChance = bracketIds.filter(id => 
      bracketResults[id].winPercentage > 0
    ).length;
    
    // Get all players with podium chances (not just top 10)
    const allPodiumContenders = bracketIds
      .filter(id => bracketResults[id].placePercentages.podium > 0)
      .map(id => ({
        id,
        participantName: bracketResults[id].participantName,
        entryNumber: bracketResults[id].entryNumber,
        currentScore: bracketResults[id].currentScore,
        placePercentages: bracketResults[id].placePercentages,
        minPlace: bracketResults[id].minPlace,
        maxPlace: bracketResults[id].maxPlace
      }));
    
    // Count players with no podium chance
    const playersWithNoPodiumChance = bracketIds.length - allPodiumContenders.length;
    
    // Identify teams most picked to win in brackets
    const championshipPicks = calculateChampionshipPicks(brackets);
    
    // Most common bracket outcomes
    const bracketOutcomes = calculateCommonOutcomes(brackets, tournament);
    
    // Find rare correct picks
    const rareCorrectPicks = findRareCorrectPicks(brackets, tournament);
    
    // Generate path-specific analysis
    const pathAnalysis = generatePathAnalysis(brackets, analysis, tournament, possibleOutcomes);
    
    return {
      timestamp: new Date(),
      stage: stageInfo.stage,
      totalBrackets: brackets.length,
      totalPossibleOutcomes: totalPossibleOutcomes,
      bracketResults: analysis.bracketResults,
      podiumContenders: allPodiumContenders,
      playersWithNoPodiumChance,
      playersWithWinChance,
      championshipPicks,
      bracketOutcomes,
      rareCorrectPicks,
      pathAnalysis,
      roundName: stageInfo.roundName,
      currentRound: stageInfo.currentRound,
      roundProgress: stageInfo.progress
    };
}

/**
 * Generate path-specific analysis showing how specific outcomes affect bracket standings
 * @param {Array} brackets - All brackets
 * @param {Object} analysis - Analysis results
 * @param {Object} tournament - Tournament data
 * @param {Array} possibleOutcomes - All possible tournament outcomes
 * @returns {Object} Path analysis
 */
function generatePathAnalysis(brackets, analysis, tournament, possibleOutcomes) {
  const { bracketResults } = analysis;
  const pathAnalysis = {
    teamPaths: {},
    championshipScenarios: []
  };
  
  // Get active teams in the tournament
  const activeTeams = getActiveTeams(tournament);
  
  // Group outcomes by championship winner
  const outcomesByChampion = groupOutcomesByChampion(possibleOutcomes);
  
  // 1. For each active team, analyze what happens if they win the championship
  activeTeams.forEach(team => {
    // Initialize team path analysis
    pathAnalysis.teamPaths[team.name] = {
      seed: team.seed,
      winsChampionship: {
        affectedBrackets: [],
        podiumChanges: []
      }
    };
    
    // Get all outcomes where this team wins the championship
    const teamWinsOutcomes = outcomesByChampion[team.name] || [];
    const totalTeamWinsOutcomes = teamWinsOutcomes.length;
    
    if (totalTeamWinsOutcomes === 0) return; // Skip if no outcomes
    
    // For each bracket, calculate actual podium chances if this team wins
    Object.keys(bracketResults).forEach(bracketId => {
      const bracket = brackets.find(b => b._id.toString() === bracketId);
      
      // Skip if no bracket found
      if (!bracket) return;
      
      // Check if this bracket picked this team as champion
      let pickedAsChampion = false;
      if (bracket.picks && bracket.picks[6] && bracket.picks[6][0] && bracket.picks[6][0].winner) {
        pickedAsChampion = bracket.picks[6][0].winner.name === team.name;
      }
      
      // Calculate podium finishes for this bracket in these outcomes
      let podiumFinishes = 0;
      
      teamWinsOutcomes.forEach(outcome => {
        // For each outcome where this team wins, get this bracket's position
        const position = calculateBracketPositionInOutcome(bracketId, outcome, brackets);
        if (position <= 3) {
          podiumFinishes++;
        }
      });
      
      // Calculate adjusted podium chance
      const adjustedPodiumChance = (podiumFinishes / totalTeamWinsOutcomes) * 100;
      
      // If significant change in podium chance (> 5%) or they picked this champion
      const normalPodiumChance = bracketResults[bracketId].placePercentages.podium;
      const changeDifference = Math.abs(adjustedPodiumChance - normalPodiumChance);
      
      if (pickedAsChampion || changeDifference > 5) {
        const podiumChange = {
          bracketId,
          participantName: bracketResults[bracketId].participantName,
          entryNumber: bracketResults[bracketId].entryNumber || 1,
          currentScore: bracketResults[bracketId].currentScore,
          normalPodiumChance: normalPodiumChance,
          adjustedPodiumChance: adjustedPodiumChance,
          changePercent: adjustedPodiumChance - normalPodiumChance
        };
        
        pathAnalysis.teamPaths[team.name].winsChampionship.podiumChanges.push(podiumChange);
      }
    });
    
    // Sort by change in podium chance (largest positive change first)
    pathAnalysis.teamPaths[team.name].winsChampionship.podiumChanges.sort((a, b) => 
      b.changePercent - a.changePercent
    );
  });
  
  // 2. For Final Four and Championship rounds, analyze all possible championship matchups
  const stageInfo = determineTournamentStage(tournament);
  if (stageInfo.currentRound >= 5) {
    // Get all possible championship matchups
    const possibleFinalists = getTeamsInRound(tournament, 5); // Teams in Final Four
    
    if (possibleFinalists.length >= 2) {
      // Create all possible championship matchup combinations
      for (let i = 0; i < possibleFinalists.length; i++) {
        for (let j = i + 1; j < possibleFinalists.length; j++) {
          const teamA = possibleFinalists[i];
          const teamB = possibleFinalists[j];
          
          // Get outcomes with this championship matchup
          const matchupOutcomes = possibleOutcomes.filter(outcome => 
            isChampionshipMatchup(outcome, teamA.name, teamB.name)
          );
          
          // Create scenario for this championship matchup
          const scenario = {
            matchup: {
              teamA,
              teamB
            },
            outcomes: [
              { winner: teamA, bracketImpacts: [] },
              { winner: teamB, bracketImpacts: [] }
            ]
          };
          
          // Get outcomes for each winner
          const teamAWinsOutcomes = matchupOutcomes.filter(outcome => 
            getChampionshipWinner(outcome) === teamA.name
          );
          
          const teamBWinsOutcomes = matchupOutcomes.filter(outcome => 
            getChampionshipWinner(outcome) === teamB.name
          );
          
          // Analyze impact on brackets for each winner
          Object.keys(bracketResults).forEach(bracketId => {
            const bracket = brackets.find(b => b._id.toString() === bracketId);
            if (!bracket) return;
            
            // Calculate podium chances under each winner scenario
            const normalPodiumChance = bracketResults[bracketId].placePercentages.podium;
            
            // Calculate for teamA winning
            if (teamAWinsOutcomes.length > 0) {
              let podiumFinishes = 0;
              teamAWinsOutcomes.forEach(outcome => {
                const position = calculateBracketPositionInOutcome(bracketId, outcome, brackets);
                if (position <= 3) podiumFinishes++;
              });
              
              const adjustedPodiumChance = (podiumFinishes / teamAWinsOutcomes.length) * 100;
              const changePercent = adjustedPodiumChance - normalPodiumChance;
              
              // Only include if significant change or picked this team
              let pickedTeamA = false;
              if (bracket.picks && bracket.picks[6] && bracket.picks[6][0] && bracket.picks[6][0].winner) {
                pickedTeamA = bracket.picks[6][0].winner.name === teamA.name;
              }
              
              if (pickedTeamA || Math.abs(changePercent) > 5) {
                scenario.outcomes[0].bracketImpacts.push({
                  bracketId,
                  participantName: bracketResults[bracketId].participantName,
                  entryNumber: bracketResults[bracketId].entryNumber || 1,
                  currentScore: bracketResults[bracketId].currentScore,
                  normalPodiumChance: normalPodiumChance,
                  affectedPodiumChance: adjustedPodiumChance,
                  changePercent: changePercent
                });
              }
            }
            
            // Calculate for teamB winning
            if (teamBWinsOutcomes.length > 0) {
              let podiumFinishes = 0;
              teamBWinsOutcomes.forEach(outcome => {
                const position = calculateBracketPositionInOutcome(bracketId, outcome, brackets);
                if (position <= 3) podiumFinishes++;
              });
              
              const adjustedPodiumChance = (podiumFinishes / teamBWinsOutcomes.length) * 100;
              const changePercent = adjustedPodiumChance - normalPodiumChance;
              
              // Only include if significant change or picked this team
              let pickedTeamB = false;
              if (bracket.picks && bracket.picks[6] && bracket.picks[6][0] && bracket.picks[6][0].winner) {
                pickedTeamB = bracket.picks[6][0].winner.name === teamB.name;
              }
              
              if (pickedTeamB || Math.abs(changePercent) > 5) {
                scenario.outcomes[1].bracketImpacts.push({
                  bracketId,
                  participantName: bracketResults[bracketId].participantName,
                  entryNumber: bracketResults[bracketId].entryNumber || 1,
                  currentScore: bracketResults[bracketId].currentScore,
                  normalPodiumChance: normalPodiumChance,
                  affectedPodiumChance: adjustedPodiumChance,
                  changePercent: changePercent
                });
              }
            }
          });
          
          // Sort impacts by change in podium chance
          scenario.outcomes[0].bracketImpacts.sort((a, b) => b.changePercent - a.changePercent);
          scenario.outcomes[1].bracketImpacts.sort((a, b) => b.changePercent - a.changePercent);
          
          // Add scenario to analysis
          pathAnalysis.championshipScenarios.push(scenario);
        }
      }
    }
  }
  
  return pathAnalysis;
}

/**
 * Group possible outcomes by championship winner
 * @param {Array} possibleOutcomes - All possible tournament outcomes
 * @returns {Object} Outcomes grouped by championship winner
 */
function groupOutcomesByChampion(possibleOutcomes) {
  const outcomesByChampion = {};
  
  possibleOutcomes.forEach(outcome => {
    const champion = getChampionshipWinner(outcome);
    if (champion) {
      if (!outcomesByChampion[champion]) {
        outcomesByChampion[champion] = [];
      }
      outcomesByChampion[champion].push(outcome);
    }
  });
  
  return outcomesByChampion;
}

/**
 * Get the championship winner from an outcome
 * @param {Object} outcome - A possible tournament outcome
 * @returns {String} Name of the championship winner, or null if not determined
 */
function getChampionshipWinner(outcome) {
  // Find any round 6 (championship) matchup
  const championshipResultEntry = Object.entries(outcome.matchupResults)
    .find(([matchupId, result]) => result.round === 6);
  
  // Return winner name if found
  if (championshipResultEntry && championshipResultEntry[1].winner) {
    return championshipResultEntry[1].winner.name;
  }
  
  // If no explicit championship round 6 matchup, check all matchup results
  // for the highest matchup ID which is likely the championship
  if (Object.keys(outcome.matchupResults).length > 0) {
    const matchupIds = Object.keys(outcome.matchupResults).map(id => parseInt(id));
    const highestMatchupId = Math.max(...matchupIds).toString();
    const highestMatchup = outcome.matchupResults[highestMatchupId];
    
    if (highestMatchup && highestMatchup.winner) {
      return highestMatchup.winner.name;
    }
  }
  
  // If still not found, check projected matchups
  if (outcome.projectedMatchups) {
    // Try both common championship IDs (62 and 63)
    for (const championshipId of ["62", "63"]) {
      if (outcome.projectedMatchups[championshipId] && outcome.matchupResults[championshipId]) {
        const championshipResult = outcome.matchupResults[championshipId];
        
        if (championshipResult && championshipResult.winner) {
          return championshipResult.winner.name;
        }
      }
    }
    
    // Last resort: check the highest matchup ID in projected matchups
    const projectedIds = Object.keys(outcome.projectedMatchups).map(id => parseInt(id));
    if (projectedIds.length > 0) {
      const highestProjectedId = Math.max(...projectedIds).toString();
      
      if (outcome.matchupResults[highestProjectedId] && 
          outcome.matchupResults[highestProjectedId].winner) {
        return outcome.matchupResults[highestProjectedId].winner.name;
      }
    }
  }
  
  return null;
}

/**
 * Check if an outcome has a specific championship matchup
 * @param {Object} outcome - A possible tournament outcome
 * @param {String} teamAName - First team name
 * @param {String} teamBName - Second team name
 * @returns {Boolean} True if the matchup exists
 */
function isChampionshipMatchup(outcome, teamAName, teamBName) {
  // Try common championship IDs (62 and 63)
  for (const championshipId of ["62", "63"]) {
    if (outcome.projectedMatchups && outcome.projectedMatchups[championshipId]) {
      const championship = outcome.projectedMatchups[championshipId];
      
      // Check if teams match (in either order)
      if (championship.teamA && championship.teamB) {
        if ((championship.teamA.name === teamAName && championship.teamB.name === teamBName) ||
            (championship.teamA.name === teamBName && championship.teamB.name === teamAName)) {
          return true;
        }
      }
    }
  }
  
  // If not found by ID, look for any round 6 matchup
  const round6Matchups = Object.values(outcome.projectedMatchups || {})
    .filter(matchup => matchup.round === 6);
  
  for (const championship of round6Matchups) {
    if (championship.teamA && championship.teamB) {
      if ((championship.teamA.name === teamAName && championship.teamB.name === teamBName) ||
          (championship.teamA.name === teamBName && championship.teamB.name === teamAName)) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Calculate a bracket's position in a specific outcome
 * @param {String} bracketId - ID of the bracket
 * @param {Object} outcome - A tournament outcome
 * @param {Array} brackets - All brackets
 * @returns {Number} Position of the bracket (1-based)
 */
function calculateBracketPositionInOutcome(bracketId, outcome, brackets) {
  // Calculate scores for all brackets in this outcome
  const scores = {};
  brackets.forEach(bracket => {
    const projectedScore = calculateProjectedScoreForOutcome(bracket, outcome);
    scores[bracket._id.toString()] = projectedScore;
  });
  
  // Sort brackets by score (descending)
  const sortedIds = Object.keys(scores).sort((a, b) => scores[b] - scores[a]);
  
  // Handle ties correctly
  const positions = {};
  let currentPosition = 1;
  let currentScore = null;
  let sameScoreCount = 0;
  
  sortedIds.forEach(id => {
    const score = scores[id];
    
    if (score !== currentScore) {
      // New score level, update position
      currentPosition += sameScoreCount;
      sameScoreCount = 1;
      currentScore = score;
    } else {
      // Same score, count for next position calculation
      sameScoreCount++;
    }
    
    positions[id] = currentPosition;
  });
  
  return positions[bracketId] || brackets.length + 1; // Default to last place if not found
}

/**
 * Calculate a bracket's projected score for a specific outcome
 * @param {Object} bracket - A bracket submission
 * @param {Object} outcome - Tournament outcome
 * @returns {Number} Projected score
 */
function calculateProjectedScoreForOutcome(bracket, outcome) {
  // Base score from already completed rounds
  let score = bracket.score || 0;
  
  // Add points for correct picks in this outcome
  if (bracket.picks) {
    for (let round = 3; round <= 6; round++) {
      if (!bracket.picks[round]) continue;
      
      // Check each matchup in the round
      bracket.picks[round].forEach(matchup => {
        if (!matchup.winner) return;
        
        // Find if this matchup has a result in the outcome
        const matchupResult = outcome.matchupResults[matchup.id];
        if (matchupResult && matchupResult.winner) {
          // Check if bracket's pick matches outcome
          if (
            matchupResult.winner.name === matchup.winner.name &&
            matchupResult.winner.seed === matchup.winner.seed
          ) {
            // Award points based on round (using standard scoring)
            const pointsByRound = {
              3: 4,  // Sweet 16
              4: 8,  // Elite 8
              5: 16, // Final Four
              6: 32  // Championship
            };
            
            score += pointsByRound[round] || 0;
          }
        }
      });
    }
  }
  
  return score;
}

/**
 * Calculate how often each team was picked to win the championship
 * @param {Array} brackets - All submitted brackets
 * @returns {Object} Championship pick statistics
 */
function calculateChampionshipPicks(brackets) {
  const championCounts = {};
  let totalPicks = 0;

  brackets.forEach((bracket) => {
    // Find championship matchup
    if (
      bracket.picks &&
      bracket.picks[6] &&
      bracket.picks[6][0] &&
      bracket.picks[6][0].winner
    ) {
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
      percentage: (championCounts[team] / totalPicks) * 100,
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

  brackets.forEach((bracket) => {
    // Sweet 16 winners (Round 3)
    if (bracket.picks && bracket.picks[3]) {
      bracket.picks[3].forEach((matchup) => {
        if (matchup.winner) {
          const key = `${matchup.id}_${matchup.winner.name}`;
          sweet16Picks[key] = (sweet16Picks[key] || 0) + 1;
        }
      });
    }

    // Final Four teams (winners from Round 4)
    if (bracket.picks && bracket.picks[4]) {
      const finalFourTeams = [];
      bracket.picks[4].forEach((matchup) => {
        if (matchup.winner) {
          finalFourTeams.push(matchup.winner.name);
        }
      });

      if (finalFourTeams.length === 4) {
        const key = finalFourTeams.sort().join(",");
        finalFourPicks[key] = (finalFourPicks[key] || 0) + 1;
      }
    }

    // Championship matchup (teams in Round 6)
    if (bracket.picks && bracket.picks[6] && bracket.picks[6][0]) {
      const matchup = bracket.picks[6][0];
      if (matchup.teamA && matchup.teamB) {
        // Sort team names to ensure consistent keys
        const teams = [matchup.teamA.name, matchup.teamB.name].sort();
        const key = teams.join(" vs ");
        championshipMatchups[key] = (championshipMatchups[key] || 0) + 1;
      }
    }
  });

  // Format and sort results
  return {
    sweet16: formatAndSortPicks(sweet16Picks, brackets.length),
    finalFour: formatAndSortPicks(finalFourPicks, brackets.length),
    championship: formatAndSortPicks(championshipMatchups, brackets.length),
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
      percentage: (pickCounts[key] / totalBrackets) * 100,
    });
  }

  return result.sort((a, b) => b.count - a.count).slice(0, 10); // Top 10 most common
}

/**
 * Find picks that were correctly made by less than 10% of brackets
 * @param {Array} brackets - All brackets
 * @param {Object} tournament - Tournament data
 * @returns {Array} Rare correct picks
 */
function findRareCorrectPicks(brackets, tournament) {
  const rarePicks = [];
  
  // Only analyze completed matchups
  for (let round = 1; round <= 6; round++) {
    if (!tournament.results[round]) continue;
    
    // Find matchups with winners
    const completedMatchups = tournament.results[round].filter(m => m.winner);
    
    for (const matchup of completedMatchups) {
      // Count how many brackets picked this winner
      let correctPicks = 0;
      let totalPicks = 0;
      
      for (const bracket of brackets) {
        if (!bracket.picks || !bracket.picks[round]) continue;
        
        const bracketMatchup = bracket.picks[round].find(m => m.id === matchup.id);
        if (!bracketMatchup || !bracketMatchup.winner) continue;
        
        totalPicks++;
        
        if (
          bracketMatchup.winner.name === matchup.winner.name &&
          bracketMatchup.winner.seed === matchup.winner.seed
        ) {
          correctPicks++;
        }
      }
      
      // Calculate percentage
      const percentage = totalPicks > 0 ? (correctPicks / totalPicks) * 100 : 0;
      
      // If less than 10% got it right, add to rare picks
      if (percentage > 0 && percentage < 10) {
        rarePicks.push({
          matchupId: matchup.id,
          round,
          winner: matchup.winner,
          correctPicks,
          totalPicks,
          percentage,
          region: matchup.region || 'Unknown',
          teams: {
            teamA: matchup.teamA,
            teamB: matchup.teamB
          }
        });
      }
    }
  }
  
  // Sort by rarity (lowest percentage first)
  return rarePicks.sort((a, b) => a.percentage - b.percentage);
}

/**
 * Get teams still active in the tournament
 * @param {Object} tournament - Tournament data
 * @returns {Array} Active teams
 */
function getActiveTeams(tournament) {
  const activeTeams = [];
  const eliminatedTeamNames = new Set();
  
  // Build a list of eliminated teams
  if (tournament.teams) {
    for (const teamName in tournament.teams) {
      if (tournament.teams[teamName].eliminated) {
        eliminatedTeamNames.add(teamName);
      }
    }
  }
  
  // Find all teams from tournament structure
  for (let round = 3; round <= 6; round++) {
    if (!tournament.results[round]) continue;
    
    for (const matchup of tournament.results[round]) {
      if (matchup.teamA && !eliminatedTeamNames.has(matchup.teamA.name)) {
        // Check if team is already in activeTeams
        if (!activeTeams.some(t => t.name === matchup.teamA.name)) {
          activeTeams.push(matchup.teamA);
        }
      }
      
      if (matchup.teamB && !eliminatedTeamNames.has(matchup.teamB.name)) {
        // Check if team is already in activeTeams
        if (!activeTeams.some(t => t.name === matchup.teamB.name)) {
          activeTeams.push(matchup.teamB);
        }
      }
    }
  }
  
  return activeTeams;
}

/**
 * Get teams in a specific round
 * @param {Object} tournament - Tournament data
 * @param {Number} round - Round number
 * @returns {Array} Teams in the round
 */
function getTeamsInRound(tournament, round) {
  const teams = [];
  
  if (!tournament.results[round]) return teams;
  
  for (const matchup of tournament.results[round]) {
    if (matchup.teamA && !teams.some(t => t.name === matchup.teamA.name)) {
      teams.push(matchup.teamA);
    }
    
    if (matchup.teamB && !teams.some(t => t.name === matchup.teamB.name)) {
      teams.push(matchup.teamB);
    }
  }
  
  return teams;
}

/**
 * Save analysis results to database
 * @param {Object} stats - Analysis results
 * @returns {Object} Saved database document
 */
async function saveAnalysisToDb(stats) {
    try {
      // Create the analysis document
      const analysis = new TournamentAnalysis({
        timestamp: stats.timestamp,
        stage: stats.stage,
        totalBrackets: stats.totalBrackets,
        totalPossibleOutcomes: stats.totalPossibleOutcomes,
        roundName: stats.roundName,
        currentRound: stats.currentRound,
        podiumContenders: stats.podiumContenders,
        playersWithNoPodiumChance: stats.playersWithNoPodiumChance,
        playersWithWinChance: stats.playersWithWinChance,
        championshipPicks: stats.championshipPicks,
        bracketOutcomes: stats.bracketOutcomes,
        rareCorrectPicks: stats.rareCorrectPicks,
        pathAnalysis: stats.pathAnalysis,
        bracketResults: stats.bracketResults
      });
      
      // Save to database
      return await analysis.save();
    } catch (error) {
      console.error('Error saving analysis to database:', error);
      throw error;
    }
  }
  
  /**
   * Save analysis results to cache files
   * @param {Object} stats - Analysis results
   */
  async function saveToCacheFiles(stats) {
    try {
      // Save to cache folder
      const fs = require('fs');
      const path = require('path');
      const analysisDir = path.join(__dirname, 'analysis-cache');
      
      // Create directory if it doesn't exist
      try {
        await fs.promises.mkdir(analysisDir, { recursive: true });
      } catch (err) {
        if (err.code !== 'EEXIST') {
          throw err;
        }
      }
      
      const timestamp = new Date().toISOString().replace(/:/g, '-');
      const filename = `tournament-analysis-${stats.stage}-${timestamp}.json`;
      const filePath = path.join(analysisDir, filename);
      
      await fs.promises.writeFile(filePath, JSON.stringify(stats, null, 2));
      console.log(`Analysis saved to ${filePath}`);
      
      // Also save as latest.json for easy access
      const latestPath = path.join(analysisDir, `tournament-analysis-${stats.stage}-latest.json`);
      await fs.promises.writeFile(latestPath, JSON.stringify(stats, null, 2));
      
      // Clean up old files (keep last 5 per stage)
      const files = await fs.promises.readdir(analysisDir);
      const stageFiles = files
        .filter(f => f.startsWith(`tournament-analysis-${stats.stage}-`) && f.endsWith('.json') && !f.includes('latest'))
        .sort()
        .reverse();
      
      if (stageFiles.length > 5) {
        console.log(`Cleaning up old analysis files for ${stats.stage} (keeping latest 5)...`);
        for (let i = 5; i < stageFiles.length; i++) {
          await fs.promises.unlink(path.join(analysisDir, stageFiles[i]));
        }
      }
    } catch (error) {
      console.error('Error saving to cache files:', error);
      throw error;
    }
  }

/**
 * Save analysis results (for backward compatibility)
 * @param {Object} stats - Analysis results
 * @returns {Object} Saved database document
 */
async function saveAnalysisResults(stats) {
    try {
      // Save to database
      const savedAnalysis = await saveAnalysisToDb(stats);
      console.log(`Analysis saved to database with ID: ${savedAnalysis._id}`);
      
      // Save to cache files
      await saveToCacheFiles(stats);
      
      return savedAnalysis;
    } catch (error) {
      console.error('Error saving analysis results:', error);
      throw error;
    }
  }

// Export for external use
module.exports = {
  analyzeTournamentPossibilities,
  generatePossibleOutcomes,
  analyzeBracketScores,
  generateStatistics,
  findRareCorrectPicks,
  generatePathAnalysis,
  saveAnalysisResults
};

// Run standalone if executed directly
if (require.main === module) {
  analyzeTournamentPossibilities()
    .then(() => {
      console.log("Analysis script completed successfully");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Error running analysis script:", err);
      process.exit(1);
    });
}