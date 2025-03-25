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

/**
 * Main function to analyze tournament possibilities
 */
async function analyzeTournamentPossibilities() {
  try {
    // Connect to database
    await connectDB();
    console.log("MongoDB Connected");

    // Get current tournament state
    const tournament = await TournamentResults.findOne({
      year: new Date().getFullYear(),
    });
    if (!tournament) {
      throw new Error("No tournament data found for current year");
    }

    // Get all brackets
    const brackets = await Bracket.find({ isLocked: true });
    console.log(`Analyzing ${brackets.length} brackets`);

    // Generate all possible outcomes (2^15 = 32,768 combinations for Sweet 16)
    // Passing the entire tournament so we can access structure for all rounds
    const possibleOutcomes = generatePossibleOutcomes(tournament);
    console.log(
      `Analyzing ${possibleOutcomes.length} possible tournament outcomes`
    );

    // Calculate bracket scores under each outcome
    const outcomeAnalysis = analyzeBracketScores(
      brackets,
      possibleOutcomes,
      tournament
    );

    // Generate interesting statistics
    const stats = generateStatistics(brackets, outcomeAnalysis, tournament);

    // Get current round name based on completed rounds
    const completedRounds = tournament.completedRounds || [];
    let currentRound = 3; // Default to Sweet 16
    let roundName = "Sweet 16";

    if (completedRounds.includes(3)) {
      currentRound = 4;
      roundName = "Elite 8";
    }
    if (completedRounds.includes(4)) {
      currentRound = 5;
      roundName = "Final Four";
    }
    if (completedRounds.includes(5)) {
      currentRound = 6;
      roundName = "Championship";
    }

    // Update the stats with accurate round data
    stats.currentRound = currentRound;
    stats.roundName = roundName;
    stats.totalPossibleOutcomes = possibleOutcomes.length;

    // Save the analysis results
    await saveAnalysisResults(stats);

    console.log("Analysis complete!");
    return stats;
  } catch (error) {
    console.error("Error in analysis:", error);
    throw error;
  } finally {
    // Close database connection
    mongoose.connection.close();
    console.log("Database connection closed");
  }
}

/**
 * Generate all possible outcomes for remaining games including future rounds
 * @param {Object} tournament - Current tournament state
 * @returns {Array} All possible tournament outcomes
 */
function generatePossibleOutcomes(tournament) {
  // Get all incomplete matchups from Sweet 16 (round 3)
  const sweet16Matchups = tournament.results[3]
    .filter((matchup) => !matchup.winner && matchup.teamA && matchup.teamB)
    .map((matchup) => ({
      ...matchup,
      round: 3,
    }));

  console.log(`Found ${sweet16Matchups.length} Sweet 16 matchups to analyze`);

  // Start with one empty outcome
  let outcomes = [
    {
      matchupResults: {}, // Maps matchupId -> result
      projectedMatchups: {}, // Tracks matchups we create for future rounds
    },
  ];

  // Process the Sweet 16 matchups first to get started
  for (const matchup of sweet16Matchups) {
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

  // Now process round 4 (Elite 8) based on projected matchups from Sweet 16
  outcomes = processNextRoundOutcomes(tournament, outcomes, 4);

  // Process round 5 (Final Four) based on projected matchups from Elite 8
  outcomes = processNextRoundOutcomes(tournament, outcomes, 5);

  // Process round 6 (Championship) based on projected matchups from Final Four
  outcomes = processNextRoundOutcomes(tournament, outcomes, 6);

  console.log(
    `Generated ${outcomes.length} total possible tournament outcomes`
  );

  return outcomes;
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

  console.log(
    `After processing round ${round}, we have ${newOutcomes.length} possible outcomes`
  );
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
    assignPositionsWithTies(positions, results.bracketResults);
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
 */
function assignPositionsWithTies(positions, bracketResults) {
  let currentPosition = 1;

  for (let i = 0; i < positions.length; i++) {
    const bracketIds = positions[i];
    const tieSize = bracketIds.length;

    // Assign the current position to all brackets in this group
    bracketIds.forEach((bracketId) => {
      // If position is 1, increment outcomesWon (ALL tied for first are winners)
      if (currentPosition === 1) {
        bracketResults[bracketId].outcomesWon++;
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
 * Propagate a matchup result to future rounds
 * @param {Object} tournament - Tournament to update
 * @param {Number} nextMatchupId - ID of the next matchup
 * @param {Object} winner - Winner to propagate
 * @param {Boolean} isTeamA - Whether this winner goes to the teamA slot
 */
function propagateResult(tournament, nextMatchupId, winner, isTeamA) {
  // Find the next matchup in any future round
  for (let round = 3; round <= 6; round++) {
    const nextMatchup = tournament.results[round]?.find(
      (m) => m.id === nextMatchupId
    );
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
    
    // Get current round name based on completed rounds
    const completedRounds = tournament.completedRounds || [];
    let currentRound = 3; // Default to Sweet 16
    let roundName = 'Sweet 16';
    
    if (completedRounds.includes(3)) {
      currentRound = 4;
      roundName = 'Elite 8';
    }
    if (completedRounds.includes(4)) {
      currentRound = 5;
      roundName = 'Final Four';
    }
    if (completedRounds.includes(5)) {
      currentRound = 6;
      roundName = 'Championship';
    }
    
    return {
      timestamp: new Date(),
      totalBrackets: brackets.length,
      totalPossibleOutcomes: Math.pow(2, 15), // 2^15 for Sweet 16
      bracketResults: analysis.bracketResults,
      topContenders: sortedByWinChance.slice(0, 10).map(id => ({
        id,
        participantName: bracketResults[id].participantName,
        entryNumber: bracketResults[id].entryNumber,
        currentScore: bracketResults[id].currentScore,
        winPercentage: bracketResults[id].winPercentage,
        maxScore: bracketResults[id].maxScore,
        minPlace: bracketResults[id].minPlace,
        maxPlace: bracketResults[id].maxPlace
      })),
      podiumContenders: sortedByPodiumChance.slice(0, 10).map(id => ({
        id,
        participantName: bracketResults[id].participantName,
        entryNumber: bracketResults[id].entryNumber,
        currentScore: bracketResults[id].currentScore,
        placePercentages: bracketResults[id].placePercentages,
        minPlace: bracketResults[id].minPlace,
        maxPlace: bracketResults[id].maxPlace
      })),
      highestCeilings: sortedByMaxScore.slice(0, 10).map(id => ({
        id,
        participantName: bracketResults[id].participantName,
        entryNumber: bracketResults[id].entryNumber,
        currentScore: bracketResults[id].currentScore,
        maxScore: bracketResults[id].maxScore,
        minPlace: bracketResults[id].minPlace,
        maxPlace: bracketResults[id].maxPlace
      })),
      mostVolatile: sortedByVariance.slice(0, 10).map(id => ({
        id,
        participantName: bracketResults[id].participantName,
        entryNumber: bracketResults[id].entryNumber,
        currentScore: bracketResults[id].currentScore,
        minScore: bracketResults[id].minScore,
        maxScore: bracketResults[id].maxScore,
        minPlace: bracketResults[id].minPlace,
        maxPlace: bracketResults[id].maxPlace
      })),
      cinderellaTeams,
      championshipPicks,
      bracketOutcomes,
      roundName,
      currentRound
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

async function saveAnalysisResults(stats) {
    try {
      // Save to database
      const TournamentAnalysis = require('./models/TournamentAnalysis');
      
      // Map roundName to stage format
      let stage = 'sweet16';
      switch (stats.roundName.toLowerCase().replace(/\s+/g, '')) {
        case 'elite8':
        case 'eliteeight':
          stage = 'elite8';
          break;
        case 'finalfour':
        case 'final4':
          stage = 'final4';
          break;
        case 'championship':
        case 'finals':
          stage = 'championship';
          break;
      }
      
      // Create the analysis document
      const analysis = new TournamentAnalysis({
        timestamp: stats.timestamp,
        stage: stage,
        totalBrackets: stats.totalBrackets,
        totalPossibleOutcomes: stats.totalPossibleOutcomes,
        roundName: stats.roundName,
        currentRound: stats.currentRound,
        topContenders: stats.topContenders,
        podiumContenders: stats.podiumContenders,
        highestCeilings: stats.highestCeilings,
        mostVolatile: stats.mostVolatile,
        cinderellaTeams: stats.cinderellaTeams,
        championshipPicks: stats.championshipPicks,
        bracketOutcomes: stats.bracketOutcomes,
        bracketResults: stats.bracketResults
      });
      
      // Save to database
      const savedAnalysis = await analysis.save();
      console.log(`Analysis saved to database with ID: ${savedAnalysis._id}`);
      
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
      const filename = `tournament-analysis-${stage}-${timestamp}.json`;
      const filePath = path.join(analysisDir, filename);
      
      await fs.promises.writeFile(filePath, JSON.stringify(stats, null, 2));
      console.log(`Analysis cached to ${filePath}`);
      
      // Also save as latest.json for easy access
      const latestPath = path.join(analysisDir, `tournament-analysis-${stage}-latest.json`);
      await fs.promises.writeFile(latestPath, JSON.stringify(stats, null, 2));
      
      // Clean up old files (keep last 5 per stage)
      const files = await fs.promises.readdir(analysisDir);
      const stageFiles = files
        .filter(f => f.startsWith(`tournament-analysis-${stage}-`) && f.endsWith('.json') && !f.includes('latest'))
        .sort()
        .reverse();
      
      if (stageFiles.length > 5) {
        console.log(`Cleaning up old analysis files for ${stage} (keeping latest 5)...`);
        for (let i = 5; i < stageFiles.length; i++) {
          await fs.promises.unlink(path.join(analysisDir, stageFiles[i]));
        }
      }
      
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
