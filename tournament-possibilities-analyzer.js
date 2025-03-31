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
 * Calculate appropriate description of the tournament stage
 * @param {Object} tournament - Current tournament data
 * @returns {Object} Stage information
 */
function determineTournamentStage(tournament) {
  // Get completed rounds
  const completedRounds = tournament.completedRounds || [];

  // Determine the current round
  let currentRound = 3; // Default to Sweet 16
  let roundName = "Sweet 16";
  let stage = "sweet16";

  if (completedRounds.includes(3)) {
    currentRound = 4;
    roundName = "Elite 8";
    stage = "elite8";
  }
  if (completedRounds.includes(4)) {
    currentRound = 5;
    roundName = "Final Four";
    stage = "final4";
  }
  if (completedRounds.includes(5)) {
    currentRound = 6;
    roundName = "Championship";
    stage = "championship";
  }

  // Count completed and total games in the current round
  let completedGames = 0;
  let totalGames = 0;

  if (tournament.results && tournament.results[currentRound]) {
    totalGames = tournament.results[currentRound].length;
    completedGames = tournament.results[currentRound].filter(
      (matchup) => matchup.winner
    ).length;
  }

  // Calculate progress
  const progress =
    totalGames > 0
      ? `${completedGames}/${totalGames} games complete`
      : "No games found";

  return {
    currentRound,
    roundName,
    stage,
    completedGames,
    totalGames,
    progress,
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

  // Count incomplete games in the current and future rounds
  let incompleteGamesCount = 0;

  for (let round = currentRound; round <= 6; round++) {
    if (tournament.results && tournament.results[round]) {
      // Count matchups that don't have a winner yet
      const incompleteGamesInRound = tournament.results[round].filter(
        (matchup) => !matchup.winner
      ).length;

      incompleteGamesCount += incompleteGamesInRound;
    }
  }

  // Calculate 2^(number of incomplete games)
  return Math.pow(2, incompleteGamesCount);
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
        if (!activeTeams.some((t) => t.name === matchup.teamA.name)) {
          activeTeams.push(matchup.teamA);
        }
      }

      if (matchup.teamB && !eliminatedTeamNames.has(matchup.teamB.name)) {
        // Check if team is already in activeTeams
        if (!activeTeams.some((t) => t.name === matchup.teamB.name)) {
          activeTeams.push(matchup.teamB);
        }
      }
    }
  }

  return activeTeams;
}

/**
 * Generate all possible outcomes using an improved approach
 * @param {Object} tournament - Tournament data
 * @returns {Array} Complete set of possible outcomes
 */
function generateAllOutcomes(tournament) {
  // Get the current round
  const currentRound = determineCurrentRound(tournament);

  // Create bracket structure for all rounds
  const bracketStructure = getBracketStructure(tournament);

  // Get active teams in the tournament
  const activeTeams = getActiveTeams(tournament);

  // Base outcome with no results
  const baseOutcome = {
    matchupResults: {},
    projectedMatchups: {},
  };

  // Initialize with a single empty outcome
  let outcomes = [baseOutcome];

  // First, make sure we have all existing matchups correctly represented
  outcomes = initializeOutcomesWithKnownMatchups(
    outcomes,
    tournament,
    bracketStructure
  );

  // Then process each round sequentially
  for (let round = currentRound; round <= 6; round++) {
    outcomes = processRound(outcomes, round, bracketStructure, tournament);

    // Perform validation to ensure teams are being tracked correctly
    validateOutcomes(outcomes, round, activeTeams);
  }

  return outcomes;
}

/**
 * Initialize outcomes with already known matchups from the tournament
 */
function initializeOutcomesWithKnownMatchups(
  outcomes,
  tournament,
  bracketStructure
) {
  // Copy the first outcome as our template
  const initialOutcome = {
    matchupResults: { ...outcomes[0].matchupResults },
    projectedMatchups: { ...outcomes[0].projectedMatchups },
  };

  // Go through all rounds and record known matchups
  for (let round = 1; round <= 6; round++) {
    if (!tournament.results[round]) continue;

    for (const matchup of tournament.results[round]) {
      // If matchup already has a winner, record it in matchupResults
      if (matchup.winner) {
        initialOutcome.matchupResults[matchup.id] = {
          winner: matchup.winner,
          matchupId: matchup.id,
          round: round,
        };

        // If this matchup leads to another matchup, project the winner forward
        if (round < 6 && matchup.nextMatchupId) {
          projectWinnerToNextRound(
            initialOutcome,
            matchup,
            matchup.winner,
            bracketStructure
          );
        }
      }
      // If matchup has teams defined but no winner yet, record in projectedMatchups
      else if (matchup.teamA || matchup.teamB) {
        initialOutcome.projectedMatchups[matchup.id] = {
          ...matchup,
          round: round,
        };
      }
    }
  }

  // Replace the first outcome with our initialized version
  return [initialOutcome];
}

/**
 * Process a single round, generating all possible outcomes
 */
function processRound(prevOutcomes, round, bracketStructure, tournament) {
  const roundMatchups = bracketStructure[round];
  let newOutcomes = [];

  // For each previous outcome
  for (const prevOutcome of prevOutcomes) {
    // Collect all matchups that need to be processed in this round
    const matchupsToProcess = [];

    // Check each matchup in this round
    for (const matchup of roundMatchups) {
      // Skip matchups that already have a winner
      if (matchup.winner) continue;

      // CASE 1: Matchup already has both teams set in tournament structure
      if (matchup.teamA && matchup.teamB) {
        matchupsToProcess.push({
          ...matchup,
          round: round,
        });
        continue;
      }

      // CASE 2: Check for projected teams from prevOutcome
      const projectedMatchup = prevOutcome.projectedMatchups[matchup.id];

      if (
        projectedMatchup &&
        projectedMatchup.teamA &&
        projectedMatchup.teamB
      ) {
        matchupsToProcess.push({
          ...matchup,
          teamA: projectedMatchup.teamA,
          teamB: projectedMatchup.teamB,
          round: round,
        });
      }
    }

    // If we have matchups to process, generate all combinations
    if (matchupsToProcess.length > 0) {
      // Create all binary combinations for these matchups
      const combinations = Math.pow(2, matchupsToProcess.length);

      for (
        let binaryCounter = 0;
        binaryCounter < combinations;
        binaryCounter++
      ) {
        // Create a new outcome based on previous outcome with PROPER deep cloning
        const newOutcome = {
          matchupResults: { ...prevOutcome.matchupResults },
          projectedMatchups: {},
        };

        // Deep clone the projectedMatchups to avoid reference issues
        for (const matchupId in prevOutcome.projectedMatchups) {
          newOutcome.projectedMatchups[matchupId] = JSON.parse(
            JSON.stringify(prevOutcome.projectedMatchups[matchupId])
          );
        }

        // Apply this binary pattern to each matchup
        for (
          let matchupIndex = 0;
          matchupIndex < matchupsToProcess.length;
          matchupIndex++
        ) {
          const matchup = matchupsToProcess[matchupIndex];

          // Determine winner (0=teamA wins, 1=teamB wins)
          const bit = (binaryCounter >> matchupIndex) & 1;
          const winner = bit === 0 ? matchup.teamA : matchup.teamB;

          // Add to results
          newOutcome.matchupResults[matchup.id] = {
            winner: winner,
            matchupId: matchup.id,
            round: round,
          };

          // Project this winner to next round if applicable
          if (round < 6 && matchup.nextMatchupId) {
            projectWinnerToNextRound(
              newOutcome,
              matchup,
              winner,
              bracketStructure
            );
          }
        }

        newOutcomes.push(newOutcome);
      }
    } else {
      // If no matchups to process in this round, keep the outcome as is
      newOutcomes.push(prevOutcome);
    }
  }

  return newOutcomes;
}

/**
 * Improved function to project a winner to the next round
 */
function projectWinnerToNextRound(outcome, matchup, winner, bracketStructure) {
  const nextMatchupId = matchup.nextMatchupId;
  if (!nextMatchupId) return;

  const nextRound = matchup.round + 1;

  // Find the next matchup in the structure
  const nextMatchup = findMatchupById(
    bracketStructure,
    nextRound,
    nextMatchupId
  );

  if (!nextMatchup) {
    console.warn(
      `Could not find next matchup ${nextMatchupId} in round ${nextRound}`
    );
    return;
  }

  // Create projected matchup if it doesn't exist
  if (!outcome.projectedMatchups[nextMatchupId]) {
    outcome.projectedMatchups[nextMatchupId] = {
      ...nextMatchup,
      id: nextMatchupId,
      round: nextRound,
      teamA: null,
      teamB: null,
    };
  }

  // Determine if this winner is teamA or teamB in the next matchup
  const isTeamA = isWinnerTeamA(
    matchup,
    bracketStructure,
    nextRound,
    nextMatchupId
  );

  // Update the next matchup with this winner
  if (isTeamA) {
    outcome.projectedMatchups[nextMatchupId].teamA = winner;
  } else {
    outcome.projectedMatchups[nextMatchupId].teamB = winner;
  }
}

/**
 * Helper function to find a matchup by ID in bracket structure
 */
function findMatchupById(bracketStructure, round, id) {
  if (!bracketStructure[round]) return null;

  // Try to find by ID directly
  const matchup = bracketStructure[round].find(
    (m) => m.id === parseInt(id) || m.id === id
  );

  if (matchup) return matchup;

  // If not found, create a basic structure
  return { id: id, round: round };
}

/**
 * Determine if the winner will be teamA or teamB in the next matchup
 * This is based on the structure of the bracket
 */
function isWinnerTeamA(matchup, bracketStructure, nextRound, nextMatchupId) {
  // If matchup has position property, use it
  if (matchup.position !== undefined) {
    return matchup.position % 2 === 0;
  }

  // If matchup's teamA is advancing to another matchup's teamA slot
  const nextMatchup = findMatchupById(
    bracketStructure,
    nextRound,
    nextMatchupId
  );
  if (
    nextMatchup &&
    nextMatchup.teamASource &&
    nextMatchup.teamASource === matchup.id
  ) {
    return true;
  }

  // If matchup's teamB is advancing to another matchup's teamB slot
  if (
    nextMatchup &&
    nextMatchup.teamBSource &&
    nextMatchup.teamBSource === matchup.id
  ) {
    return false;
  }

  // Default based on matchup ID (even IDs typically feed into teamA slot)
  return parseInt(matchup.id) % 2 === 0;
}

/**
 * Validate that all active teams are properly represented in outcomes
 */
function validateOutcomes(outcomes, round, activeTeams) {
  // After round 6, check which teams have championship outcomes
  if (round === 6) {
    const championshipWinners = {};

    outcomes.forEach((outcome) => {
      const champion = getChampionshipWinner(outcome);
      if (champion) {
        championshipWinners[champion] =
          (championshipWinners[champion] || 0) + 1;
      }
    });

    // Check if any active team is missing from championship outcomes
    activeTeams.forEach((team) => {
      if (!championshipWinners[team.name]) {
        console.warn(`Active team ${team.name} has no championship outcomes!`);
      }
    });
  }
}

/**
 * Get complete bracket structure from tournament
 * @param {Object} tournament - Tournament data
 * @returns {Object} Complete bracket structure by round
 */
function getBracketStructure(tournament) {
  const structure = {};

  for (let round = 1; round <= 6; round++) {
    if (tournament.results && tournament.results[round]) {
      structure[round] = tournament.results[round];
    } else {
      structure[round] = [];
    }
  }

  return structure;
}

/**
 * Get the championship winner from an outcome
 * @param {Object} outcome - A possible tournament outcome
 * @returns {String} Name of the championship winner, or null if not determined
 */
function getChampionshipWinner(outcome) {
  // Find any round 6 (championship) matchup
  const championshipResultEntry = Object.entries(outcome.matchupResults).find(
    ([matchupId, result]) => result.round === 6
  );

  // Return winner name if found
  if (championshipResultEntry && championshipResultEntry[1].winner) {
    return championshipResultEntry[1].winner.name;
  }

  // If no explicit championship round 6 matchup, check all matchup results
  // for the highest matchup ID which is likely the championship
  if (Object.keys(outcome.matchupResults).length > 0) {
    const matchupIds = Object.keys(outcome.matchupResults).map((id) =>
      parseInt(id)
    );
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
      if (
        outcome.projectedMatchups[championshipId] &&
        outcome.matchupResults[championshipId]
      ) {
        const championshipResult = outcome.matchupResults[championshipId];

        if (championshipResult && championshipResult.winner) {
          return championshipResult.winner.name;
        }
      }
    }

    // Last resort: check the highest matchup ID in projected matchups
    const projectedIds = Object.keys(outcome.projectedMatchups).map((id) =>
      parseInt(id)
    );
    if (projectedIds.length > 0) {
      const highestProjectedId = Math.max(...projectedIds).toString();

      if (
        outcome.matchupResults[highestProjectedId] &&
        outcome.matchupResults[highestProjectedId].winner
      ) {
        return outcome.matchupResults[highestProjectedId].winner.name;
      }
    }
  }

  return null;
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
  // Start with 0 and calculate the entire score from scratch
  let score = 0;

  const scoringConfig = projectedTournament.scoringConfig || {
    1: 1, // First round: 1 point
    2: 2, // Second round: 2 points
    3: 4, // Sweet 16: 4 points
    4: 8, // Elite 8: 8 points
    5: 16, // Final Four: 16 points
    6: 32, // Championship: 32 points
  };

  // Calculate score for each round
  for (let round = 1; round <= 6; round++) {
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

  // Return the total score without adding bracket.score
  return score;
}

/**
 * Calculate a bracket's projected score for a specific outcome
 * @param {Object} bracket - A bracket submission
 * @param {Object} outcome - Tournament outcome
 * @param {Object} tournament - Tournament with scoring configuration
 * @returns {Number} Projected score
 */
function calculateProjectedScoreForOutcome(bracket, outcome, tournament) {
  // Base score from already completed rounds - this already includes points for completed matchups
  let score = bracket.score || 0;

  // Get scoring config from tournament or use default scoring
  const scoringConfig = tournament.scoringConfig || {
    1: 1, // First round: 1 point
    2: 2, // Second round: 2 points
    3: 4, // Sweet 16: 4 points
    4: 8, // Elite 8: 8 points
    5: 16, // Final Four: 16 points
    6: 32, // Championship: 32 points
  };

  // Determine which rounds are already completed
  const completedRounds = tournament.completedRounds || [];

  // Determine current round
  let currentRound = 3; // Default to Sweet 16
  if (completedRounds.includes(3)) currentRound = 4; // Elite 8
  if (completedRounds.includes(4)) currentRound = 5; // Final Four
  if (completedRounds.includes(5)) currentRound = 6; // Championship

  // Track completed matchups by ID to avoid double counting
  const completedMatchupIds = new Set();

  // Identify completed matchups in the current tournament state
  for (let round = 1; round <= 6; round++) {
    if (tournament.results && tournament.results[round]) {
      tournament.results[round].forEach((matchup) => {
        if (matchup.winner) {
          completedMatchupIds.add(matchup.id.toString());
        }
      });
    }
  }

  // Add points only for matchups that haven't been completed yet
  if (bracket.picks) {
    for (let round = currentRound; round <= 6; round++) {
      if (!bracket.picks[round]) continue;

      // Check each matchup in the round
      bracket.picks[round].forEach((matchup) => {
        if (!matchup.winner) return;

        // Skip already completed matchups (their points are included in bracket.score)
        if (completedMatchupIds.has(matchup.id.toString())) return;

        // Find if this matchup has a projected result in the outcome
        const matchupResult = outcome.matchupResults[matchup.id];
        if (matchupResult && matchupResult.winner) {
          // Check if bracket's pick matches outcome
          if (
            matchupResult.winner.name === matchup.winner.name &&
            matchupResult.winner.seed === matchup.winner.seed
          ) {
            // Award points based on round using tournament's scoring config
            score += scoringConfig[round] || 0;
          }
        }
      });
    }
  }

  return score;
}

/**
 * Calculate a bracket's position in a specific outcome using existing tie-handling functions
 * @param {String} bracketId - ID of the bracket
 * @param {Object} outcome - A tournament outcome
 * @param {Array} brackets - All brackets
 * @param {Object} tournament - Tournament data with scoring config
 * @returns {Number} Position of the bracket (1-based)
 */
function calculateBracketPositionInOutcome(
  bracketId,
  outcome,
  brackets,
  tournament
) {
  // Calculate scores for all brackets in this outcome
  const scores = {};
  brackets.forEach((bracket) => {
    const projectedScore = calculateProjectedScoreForOutcome(
      bracket,
      outcome,
      tournament
    );
    scores[bracket._id.toString()] = projectedScore;
  });

  // Sort brackets by score (descending)
  const sortedIds = Object.keys(scores).sort((a, b) => scores[b] - scores[a]);

  // Step 1: Use determinePositions to group brackets by score
  const positions = determinePositions(sortedIds, scores);

  // Step 2: Create a temporary results object to capture positions
  const tempResults = {};

  // Initialize the temp results object
  sortedIds.forEach((id) => {
    tempResults[id] = { position: 0 };
  });

  // Step 3: Apply Olympic-style tie handling logic
  let currentPosition = 1;

  for (let i = 0; i < positions.length; i++) {
    const bracketIds = positions[i];
    const tieSize = bracketIds.length;

    // Assign current position to all brackets in this group
    bracketIds.forEach((id) => {
      tempResults[id].position = currentPosition;
    });

    // Increment position by the number of tied brackets (Olympic style)
    currentPosition += tieSize;
  }

  // Return the position of our target bracket
  return tempResults[bracketId]?.position || brackets.length + 1;
}

/**
 * Get a team's region from tournament data with multiple fallback methods
 * @param {String} teamName - Name of the team
 * @param {Object} tournament - Tournament data
 * @returns {String} Region name or "Unknown" if not found
 */
function getTeamRegion(teamName, tournament) {
  // Method 1: Check if tournament has a teams object with region information
  if (
    tournament.teams &&
    tournament.teams[teamName] &&
    tournament.teams[teamName].region
  ) {
    return tournament.teams[teamName].region;
  }

  // Method 2: Check matchups in rounds 1-4 for region information
  // Start with early rounds as they're more likely to have region information
  for (let round = 1; round <= 4; round++) {
    if (tournament.results && tournament.results[round]) {
      for (const matchup of tournament.results[round]) {
        if (matchup.region) {
          if (matchup.teamA && matchup.teamA.name === teamName) {
            return matchup.region;
          }
          if (matchup.teamB && matchup.teamB.name === teamName) {
            return matchup.region;
          }
        }
      }
    }
  }

  // Method 3: Check games array
  if (tournament.games && Array.isArray(tournament.games)) {
    for (const game of tournament.games) {
      if (game.region) {
        if (game.teamA && game.teamA.name === teamName) {
          return game.region;
        }
        if (game.teamB && game.teamB.name === teamName) {
          return game.region;
        }
      }
    }
  }

  // Method 4: Try to determine region from seed number (if team has a seed property)
  const activeTeams = getActiveTeams(tournament);
  const team = activeTeams.find((t) => t.name === teamName);
  if (team && team.seed) {
    // Standard NCAA seeding (in a 4-region tournament):
    // 1-16: South region
    // 101-116 or 17-32: East region
    // 201-216 or 33-48: West region
    // 301-316 or 49-64: Midwest region
    const seed = team.seed;

    if (seed <= 16) return "South";
    if (seed <= 116 || (seed > 16 && seed <= 32)) return "East";
    if (seed <= 216 || (seed > 32 && seed <= 48)) return "West";
    if (seed <= 316 || (seed > 48 && seed <= 64)) return "Midwest";
  }

  // Method 5: Determine from team name if possible
  if (teamName.includes("South")) return "South";
  if (teamName.includes("East")) return "East";
  if (teamName.includes("West")) return "West";
  if (teamName.includes("Midwest") || teamName.includes("Mid-"))
    return "Midwest";

  return "Unknown";
}

/**
 * Determine which regions play each other in the Final Four based on tournament data
 * @param {Object} tournament - Tournament data
 * @returns {Array} Array of region pairs that play each other in Final Four
 */
function getFinalFourRegionPairings(tournament) {
  // Initialize pairs
  const finalFourPairs = [];

  // Try to get region pairings from the tournament structure
  if (tournament.results && tournament.results[5]) {
    // Round 5 is the Final Four
    const finalFourMatchups = tournament.results[5];

    // For each Final Four matchup, determine the regions that feed into it
    finalFourMatchups.forEach((matchup) => {
      // Find matchups from previous round (Elite Eight) that feed into this Final Four matchup
      if (matchup.id && tournament.results[4]) {
        const eliteEightMatchups = tournament.results[4].filter(
          (m) => m.nextMatchupId === matchup.id
        );

        if (eliteEightMatchups.length === 2) {
          // Get regions from these Elite Eight matchups
          const regions = new Set();

          eliteEightMatchups.forEach((m) => {
            if (m.region) {
              regions.add(m.region);
            } else if (m.teamA && m.teamA.region) {
              regions.add(m.teamA.region);
            } else if (m.teamB && m.teamB.region) {
              regions.add(m.teamB.region);
            }
          });

          // Convert regions set to array
          const regionArray = Array.from(regions);
          if (regionArray.length === 2) {
            finalFourPairs.push([regionArray[0], regionArray[1]]);
          }
        }
      }
    });
  }

  // If we couldn't determine from matchups, try inspecting games array
  if (finalFourPairs.length === 0 && tournament.games) {
    const finalFourGames = tournament.games.filter((g) => g.round === 5);
    finalFourGames.forEach((game) => {
      // Try to determine regions from game data
      const regions = new Set();

      // Check team regions
      if (game.teamA && game.teamA.region) regions.add(game.teamA.region);
      if (game.teamB && game.teamB.region) regions.add(game.teamB.region);

      // If game has a region property directly
      if (game.regionA) regions.add(game.regionA);
      if (game.regionB) regions.add(game.regionB);

      const regionArray = Array.from(regions);
      if (regionArray.length === 2) {
        finalFourPairs.push([regionArray[0], regionArray[1]]);
      }
    });
  }

  // If we still don't have pairings, check if the data structure has explicit Final Four paths
  if (finalFourPairs.length === 0 && tournament.finalFourPaths) {
    tournament.finalFourPaths.forEach((path) => {
      if (path.regions && path.regions.length === 2) {
        finalFourPairs.push([path.regions[0], path.regions[1]]);
      }
    });
  }

  // Log what we found for debugging
  console.log("Final Four Region Pairings:", finalFourPairs);

  // If we still couldn't determine, use the actual pairings you provided
  if (finalFourPairs.length === 0) {
    console.log("Using default region pairings based on your data");
    return [
      ["South", "West"], // South plays West in one semifinal
      ["East", "Midwest"], // East plays Midwest in the other semifinal
    ];
  }

  return finalFourPairs;
}

/**
 * Check if two regions play each other in the Final Four
 * @param {String} regionA - First region
 * @param {String} regionB - Second region
 * @param {Object} tournament - Tournament data
 * @returns {Boolean} True if regions play each other in Final Four
 */
function regionsPlayInFinalFour(regionA, regionB, tournament) {
  // Get the region pairings for this tournament
  const finalFourPairs = getFinalFourRegionPairings(tournament);

  // Check if these regions make up one of the Final Four matchups
  return finalFourPairs.some(
    (pair) =>
      (pair[0] === regionA && pair[1] === regionB) ||
      (pair[0] === regionB && pair[1] === regionA)
  );
}

/**
 * Debugging function to log all found regions
 * This helps identify any issues with region detection
 */
function logTeamRegions(tournament) {
  const activeTeams = getActiveTeams(tournament);
  console.log("Active teams and their detected regions:");

  activeTeams.forEach((team) => {
    const region = getTeamRegion(team.name, tournament);
    console.log(`${team.name} (Seed: ${team.seed}): ${region}`);
  });
}

/**
 * Calculate average positions for all brackets under a specific scenario
 * @param {Array} brackets - All brackets
 * @param {Array} outcomes - Specific outcomes to analyze
 * @param {Object} tournament - Tournament data
 * @returns {Object} Map of bracketId to average position
 */
function calculateBracketPositionsForScenario(brackets, outcomes, tournament) {
  const positionsMap = {};

  // Initialize position map for all brackets
  brackets.forEach((bracket) => {
    positionsMap[bracket._id.toString()] = {
      positions: [],
      score: bracket.score || 0,
    };
  });

  // Calculate position for each bracket in each outcome
  outcomes.forEach((outcome) => {
    // Calculate projected score for this outcome for each bracket
    const outcomeScores = {};
    brackets.forEach((bracket) => {
      const projectedScore = calculateProjectedScoreForOutcome(
        bracket,
        outcome,
        tournament
      );
      outcomeScores[bracket._id.toString()] = projectedScore;

      // Store the latest calculated score in the positions map
      positionsMap[bracket._id.toString()].latestScore = projectedScore;
    });

    // Sort brackets by projected score for this outcome
    const sortedBrackets = [...brackets].sort((a, b) => {
      const scoreA = outcomeScores[a._id.toString()];
      const scoreB = outcomeScores[b._id.toString()];
      return scoreB - scoreA;
    });

    // Assign positions (with Olympic-style tie handling)
    let currentPos = 1;
    let currentScore = null;
    let sameScoreCount = 0;

    sortedBrackets.forEach((bracket, idx) => {
      const bracketId = bracket._id.toString();
      const score = outcomeScores[bracketId];

      // Handle ties - if score is same as previous, position is same
      if (currentScore !== null && score === currentScore) {
        sameScoreCount++;
      } else {
        // New score means new position (skip positions for ties)
        currentPos += sameScoreCount;
        sameScoreCount = 1;
        currentScore = score;
      }

      // Record position for this bracket in this outcome
      positionsMap[bracketId].positions.push(currentPos);
    });
  });

  // Calculate average position for each bracket
  Object.keys(positionsMap).forEach((bracketId) => {
    const positions = positionsMap[bracketId].positions;
    const avgPosition =
      positions.length > 0
        ? positions.reduce((sum, pos) => sum + pos, 0) / positions.length
        : Infinity;

    positionsMap[bracketId].avgPosition = avgPosition;
  });

  return positionsMap;
}

/**
 * Get top N brackets for a specific scenario
 * @param {Object} positionsMap - Map of bracketId to position data
 * @param {Array} brackets - All brackets
 * @param {Object} bracketResults - Analysis results for brackets
 * @param {Number} limit - Number of top brackets to return
 * @returns {Array} Top brackets with position info
 */
function getTopBracketsForScenario(
  positionsMap,
  brackets,
  bracketResults,
  limit = 5
) {
  // Convert positions map to array for sorting
  const positionArray = Object.keys(positionsMap).map((bracketId) => ({
    bracketId,
    avgPosition: positionsMap[bracketId].avgPosition,
    latestScore: positionsMap[bracketId].latestScore || 0,
  }));

  // Sort by average position (ascending)
  positionArray.sort((a, b) => a.avgPosition - b.avgPosition);

  // Take top N results
  const topResults = positionArray.slice(0, limit);

  // Format for frontend display
  return topResults.map((result, index) => {
    const bracket = brackets.find((b) => b._id.toString() === result.bracketId);
    const bracketResult = bracketResults[result.bracketId];

    return {
      bracketId: result.bracketId,
      participantName:
        bracketResult?.participantName || bracket?.participantName || "Unknown",
      entryNumber: bracketResult?.entryNumber || bracket?.entryNumber || 1,
      currentScore: result.latestScore, // Use the projected score for this scenario
      position: index + 1,
      // We're not using these anymore but keeping them for backward compatibility
      normalPodiumChance: bracketResult?.placePercentages?.podium || 0,
      affectedPodiumChance: 0,
    };
  });
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
  const playersWithWinChance = bracketIds.filter(
    (id) => bracketResults[id].winPercentage > 0
  ).length;

  // Get all players with podium chances (not just top 10)
  const allPodiumContenders = bracketIds
    .filter((id) => bracketResults[id].placePercentages.podium > 0)
    .map((id) => ({
      id,
      participantName: bracketResults[id].participantName,
      entryNumber: bracketResults[id].entryNumber,
      currentScore: bracketResults[id].currentScore,
      placePercentages: bracketResults[id].placePercentages,
      minPlace: bracketResults[id].minPlace,
      maxPlace: bracketResults[id].maxPlace,
    }));

  // Count players with no podium chance
  const playersWithNoPodiumChance =
    bracketIds.length - allPodiumContenders.length;

  // Identify teams most picked to win in brackets
  const championshipPicks = calculateChampionshipPicks(brackets);

  // Most common bracket outcomes
  const bracketOutcomes = calculateCommonOutcomes(brackets, tournament);

  // Find rare correct picks
  const rareCorrectPicks = findRareCorrectPicks(brackets, tournament);

  // Generate path-specific analysis
  const pathAnalysis = generatePathAnalysis(
    brackets,
    analysis,
    tournament,
    possibleOutcomes
  );

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
    roundProgress: stageInfo.progress,
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
function generatePathAnalysis(
  brackets,
  analysis,
  tournament,
  possibleOutcomes
) {
  const { bracketResults } = analysis;
  const pathAnalysis = {
    teamPaths: {},
    championshipScenarios: [],
  };

  // Get active teams in the tournament
  const activeTeams = getActiveTeams(tournament);

  // Group outcomes by championship winner
  const outcomesByChampion = groupOutcomesByChampion(possibleOutcomes);

  // 1. For each active team, analyze what happens if they win the championship
  activeTeams.forEach((team) => {
    // Get team's region
    const teamRegion = getTeamRegion(team.name, tournament);

    // Initialize team path analysis
    pathAnalysis.teamPaths[team.name] = {
      seed: team.seed,
      region: teamRegion, // Add region info
      winsChampionship: {
        affectedBrackets: [],
        podiumChanges: [],
      },
    };

    // Get all outcomes where this team wins the championship
    const teamWinsOutcomes = outcomesByChampion[team.name] || [];
    const totalTeamWinsOutcomes = teamWinsOutcomes.length;

    if (totalTeamWinsOutcomes === 0) return; // Skip if no outcomes

    // For each bracket, calculate actual podium chances if this team wins
    Object.keys(bracketResults).forEach((bracketId) => {
      const bracket = brackets.find((b) => b._id.toString() === bracketId);

      // Skip if no bracket found
      if (!bracket) return;

      // Check if this bracket picked this team as champion
      let pickedAsChampion = false;
      if (
        bracket.picks &&
        bracket.picks[6] &&
        bracket.picks[6][0] &&
        bracket.picks[6][0].winner
      ) {
        pickedAsChampion = bracket.picks[6][0].winner.name === team.name;
      }

      // Calculate podium finishes for this bracket in these outcomes
      let podiumFinishes = 0;

      teamWinsOutcomes.forEach((outcome) => {
        // For each outcome where this team wins, get this bracket's position
        const position = calculateBracketPositionInOutcome(
          bracketId,
          outcome,
          brackets,
          tournament
        );
        if (position <= 3) {
          podiumFinishes++;
        }
      });

      // Calculate adjusted podium chance
      const adjustedPodiumChance =
        (podiumFinishes / totalTeamWinsOutcomes) * 100;

      // If significant change in podium chance (> 5%) or they picked this champion
      const normalPodiumChance =
        bracketResults[bracketId].placePercentages.podium;
      const changeDifference = Math.abs(
        adjustedPodiumChance - normalPodiumChance
      );

      //Commented out to include all brackets for 2025
      //if (pickedAsChampion || changeDifference > 5) {
      const podiumChange = {
        bracketId,
        participantName: bracketResults[bracketId].participantName,
        entryNumber: bracketResults[bracketId].entryNumber || 1,
        currentScore: bracketResults[bracketId].currentScore,
        normalPodiumChance: normalPodiumChance,
        adjustedPodiumChance: adjustedPodiumChance,
        changePercent: adjustedPodiumChance - normalPodiumChance,
      };

      pathAnalysis.teamPaths[team.name].winsChampionship.podiumChanges.push(
        podiumChange
      );
      //}
    });

    // Sort by change in podium chance (largest positive change first)
    pathAnalysis.teamPaths[team.name].winsChampionship.podiumChanges.sort(
      (a, b) => b.changePercent - a.changePercent
    );
  });

  // 2. For Final Four and Championship rounds, analyze all possible championship matchups
  const stageInfo = determineTournamentStage(tournament);
  if (stageInfo.currentRound >= 5) {
    // First, log team regions to help with debugging
    logTeamRegions(tournament);

    // Get all possible championship contenders
    const possibleFinalists = getTeamsInRound(tournament, 5); // Teams in Final Four

    if (possibleFinalists.length >= 2) {
      // Map of team name to region for quick lookup
      const teamRegions = {};
      possibleFinalists.forEach((team) => {
        teamRegions[team.name] = getTeamRegion(team.name, tournament);
      });

      console.log(
        "Generating championship scenarios for teams:",
        possibleFinalists.map((t) => t.name).join(", ")
      );

      // Create all possible championship matchup combinations
      for (let i = 0; i < possibleFinalists.length; i++) {
        for (let j = i + 1; j < possibleFinalists.length; j++) {
          const teamA = possibleFinalists[i];
          const teamB = possibleFinalists[j];

          // Get team regions
          const regionA = teamRegions[teamA.name] || "Unknown";
          const regionB = teamRegions[teamB.name] || "Unknown";

          const isInvalidMatchup = regionsPlayInFinalFour(
            regionA,
            regionB,
            tournament
          );
          console.log(
            `Matchup: ${teamA.name} (${regionA}) vs ${
              teamB.name
            } (${regionB}) - ${isInvalidMatchup ? "INVALID" : "VALID"}`
          );

          if (isInvalidMatchup) {
            console.log(
              `Skipping invalid championship matchup: ${teamA.name} vs ${teamB.name} - regions play in Final Four`
            );
            continue; // Skip to next matchup
          }

          // Get outcomes with this championship matchup
          const matchupOutcomes = possibleOutcomes.filter((outcome) =>
            isChampionshipMatchup(outcome, teamA.name, teamB.name)
          );

          // If no outcomes found for this matchup, skip it
          if (matchupOutcomes.length === 0) {
            console.log(
              `No outcomes found for matchup: ${teamA.name} vs ${teamB.name}`
            );
            continue;
          }

          // Create scenario for this championship matchup
          const scenario = {
            matchup: {
              teamA: { ...teamA, region: regionA },
              teamB: { ...teamB, region: regionB },
            },
            outcomes: [
              { winner: teamA, bracketImpacts: [] },
              { winner: teamB, bracketImpacts: [] },
            ],
          };

          // Process Team A winning outcomes
          const teamAWinsOutcomes = matchupOutcomes.filter(
            (outcome) => getChampionshipWinner(outcome) === teamA.name
          );

          if (teamAWinsOutcomes.length > 0) {
            // Calculate positions for all brackets when Team A wins
            const bracketPositions = calculateBracketPositionsForScenario(
              brackets,
              teamAWinsOutcomes,
              tournament
            );

            // Get top 5 brackets (sorted by position)
            const topBrackets = getTopBracketsForScenario(
              bracketPositions,
              brackets,
              bracketResults,
              5
            );

            // Add to scenario
            scenario.outcomes[0].bracketImpacts = topBrackets;
          }

          // Process Team B winning outcomes
          const teamBWinsOutcomes = matchupOutcomes.filter(
            (outcome) => getChampionshipWinner(outcome) === teamB.name
          );

          if (teamBWinsOutcomes.length > 0) {
            // Calculate positions for all brackets when Team B wins
            const bracketPositions = calculateBracketPositionsForScenario(
              brackets,
              teamBWinsOutcomes,
              tournament
            );

            // Get top 5 brackets (sorted by position)
            const topBrackets = getTopBracketsForScenario(
              bracketPositions,
              brackets,
              bracketResults,
              5
            );

            // Add to scenario
            scenario.outcomes[1].bracketImpacts = topBrackets;
          }

          // Add completed scenario to analysis
          pathAnalysis.championshipScenarios.push(scenario);
          console.log(
            `Added championship scenario: ${teamA.name} vs ${teamB.name}`
          );
        }
      }

      console.log(
        `Generated ${pathAnalysis.championshipScenarios.length} championship scenarios`
      );
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

  possibleOutcomes.forEach((outcome) => {
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
 * Check if an outcome has a specific championship matchup
 * @param {Object} outcome - A possible tournament outcome
 * @param {String} teamAName - First team name
 * @param {String} teamBName - Second team name
 * @returns {Boolean} True if the matchup exists
 */
function isChampionshipMatchup(outcome, teamAName, teamBName) {
  // Try common championship IDs (62 and 63)
  for (const championshipId of ["62", "63"]) {
    if (
      outcome.projectedMatchups &&
      outcome.projectedMatchups[championshipId]
    ) {
      const championship = outcome.projectedMatchups[championshipId];

      // Check if teams match (in either order)
      if (championship.teamA && championship.teamB) {
        if (
          (championship.teamA.name === teamAName &&
            championship.teamB.name === teamBName) ||
          (championship.teamA.name === teamBName &&
            championship.teamB.name === teamAName)
        ) {
          return true;
        }
      }
    }
  }

  // If not found by ID, look for any round 6 matchup
  const round6Matchups = Object.values(outcome.projectedMatchups || {}).filter(
    (matchup) => matchup.round === 6
  );

  for (const championship of round6Matchups) {
    if (championship.teamA && championship.teamB) {
      if (
        (championship.teamA.name === teamAName &&
          championship.teamB.name === teamBName) ||
        (championship.teamA.name === teamBName &&
          championship.teamB.name === teamAName)
      ) {
        return true;
      }
    }
  }

  return false;
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
    if (matchup.teamA && !teams.some((t) => t.name === matchup.teamA.name)) {
      teams.push(matchup.teamA);
    }

    if (matchup.teamB && !teams.some((t) => t.name === matchup.teamB.name)) {
      teams.push(matchup.teamB);
    }
  }

  return teams;
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
    const completedMatchups = tournament.results[round].filter((m) => m.winner);

    for (const matchup of completedMatchups) {
      // Count how many brackets picked this winner
      let correctPicks = 0;
      let totalPicks = 0;
      const correctPicksByUsers = []; // Track users who made correct picks

      for (const bracket of brackets) {
        if (!bracket.picks || !bracket.picks[round]) continue;

        const bracketMatchup = bracket.picks[round].find(
          (m) => m.id === matchup.id
        );
        if (!bracketMatchup || !bracketMatchup.winner) continue;

        totalPicks++;

        if (
          bracketMatchup.winner.name === matchup.winner.name &&
          bracketMatchup.winner.seed === matchup.winner.seed
        ) {
          correctPicks++;
          // Add user to correctPicksByUsers
          correctPicksByUsers.push({
            bracketId: bracket._id.toString(),
            participantName: bracket.participantName,
            entryNumber: bracket.entryNumber || 1,
            userEmail: bracket.userEmail,
          });
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
          region: matchup.region || "Unknown",
          teams: {
            teamA: matchup.teamA,
            teamB: matchup.teamB,
          },
          correctPicksByUsers, // Add the users who made correct picks
        });
      }
    }
  }

  // Sort by rarity (lowest percentage first)
  return rarePicks.sort((a, b) => a.percentage - b.percentage);
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
      bracketResults: stats.bracketResults,
    });

    // Save to database
    return await analysis.save();
  } catch (error) {
    console.error("Error saving analysis to database:", error);
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
    const fs = require("fs");
    const path = require("path");
    const analysisDir = path.join(__dirname, "analysis-cache");

    // Create directory if it doesn't exist
    try {
      await fs.promises.mkdir(analysisDir, { recursive: true });
    } catch (err) {
      if (err.code !== "EEXIST") {
        throw err;
      }
    }

    const timestamp = new Date().toISOString().replace(/:/g, "-");
    const filename = `tournament-analysis-${stats.stage}-${timestamp}.json`;
    const filePath = path.join(analysisDir, filename);

    await fs.promises.writeFile(filePath, JSON.stringify(stats, null, 2));
    console.log(`Analysis saved to ${filePath}`);

    // Also save as latest.json for easy access
    const latestPath = path.join(
      analysisDir,
      `tournament-analysis-${stats.stage}-latest.json`
    );
    await fs.promises.writeFile(latestPath, JSON.stringify(stats, null, 2));

    // Clean up old files (keep last 5 per stage)
    const files = await fs.promises.readdir(analysisDir);
    const stageFiles = files
      .filter(
        (f) =>
          f.startsWith(`tournament-analysis-${stats.stage}-`) &&
          f.endsWith(".json") &&
          !f.includes("latest")
      )
      .sort()
      .reverse();

    if (stageFiles.length > 5) {
      console.log(
        `Cleaning up old analysis files for ${stats.stage} (keeping latest 5)...`
      );
      for (let i = 5; i < stageFiles.length; i++) {
        await fs.promises.unlink(path.join(analysisDir, stageFiles[i]));
      }
    }
  } catch (error) {
    console.error("Error saving to cache files:", error);
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
    console.error("Error saving analysis results:", error);
    throw error;
  }
}

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
      console.log(
        `Tournament has ${activeTeams.length} active teams - too many for analysis (need 16 or fewer)`
      );
      return {
        error: true,
        message:
          "Analysis is only available once the tournament reaches Sweet 16 (16 or fewer teams)",
        activeTeamCount: activeTeams.length,
      };
    }

    // Get tournament stage information
    const stageInfo = determineTournamentStage(tournament);
    console.log(
      `Current tournament stage: ${stageInfo.roundName} (${stageInfo.progress})`
    );

    // Get all brackets
    const brackets = await Bracket.find({ isLocked: true });
    console.log(`Analyzing ${brackets.length} brackets`);

    // Calculate possible outcomes
    const possibleOutcomesCount = calculatePossibleOutcomes(tournament);
    console.log(
      `Tournament has ${possibleOutcomesCount} possible outcomes remaining`
    );

    // Generate all possible outcomes
    const possibleOutcomes = generateAllOutcomes(tournament);
    console.log(`Generated ${possibleOutcomes.length} outcomes for analysis`);

    // Calculate bracket scores under each outcome
    console.log("Analyzing bracket scores under all possible outcomes...");
    const outcomeAnalysis = analyzeBracketScores(
      brackets,
      possibleOutcomes,
      tournament
    );

    // Generate statistics
    console.log("Generating statistics from analysis...");
    const stats = generateStatistics(
      brackets,
      outcomeAnalysis,
      tournament,
      possibleOutcomes
    );

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

// Export for external use
module.exports = {
  analyzeTournamentPossibilities,
  generateAllOutcomes,
  analyzeBracketScores,
  generateStatistics,
  findRareCorrectPicks,
  generatePathAnalysis,
  saveAnalysisResults,
  getActiveTeams,
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
