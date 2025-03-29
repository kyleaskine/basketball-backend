require("dotenv").config();
const axios = require("axios");
const mongoose = require("mongoose");
const connectDB = require("./config/db");
const TournamentResults = require("./models/TournamentResults");
const Bracket = require("./models/Bracket");
const NcaaUpdateLog = require("./models/NcaaUpdateLog");

// Connect to database
connectDB();

// NCAA API endpoint format
const NCAA_API_BASE =
  "https://data.ncaa.com/casablanca/scoreboard/basketball-men/d1";

/**
 * Main function to fetch NCAA data and update the tournament
 */
async function updateTournamentResults(forceYesterday = false) {
  let updateLog;
  try {
    console.log("Starting NCAA tournament update...");

    // Create a new log entry for this update run
    updateLog = new NcaaUpdateLog({
      status: "pending",
      trackedGames: [],
      logs: [],
      errorDetails: [],
      completedGames: 0,
      totalTrackedGames: 0,
    });

    updateLog.addLog("Starting NCAA tournament update");

    // 1. Get current tournament data from our database
    const tournament = await TournamentResults.findOne({
      year: new Date().getFullYear(),
    });

    if (!tournament) {
      updateLog.status = "error";
      updateLog.addLog("No tournament found in database");
      await updateLog.save();
      console.error("No tournament found in database");
      process.exit(1);
    }

    // 2. Get today's date in YYYY/MM/DD format
    // Current time
    const now = new Date();
    const currentHour = now.getHours();

    // If we're between midnight and 3am, we should use yesterday's date
    // because we're likely still checking games that started yesterday
    let dateToUse;
    if (forceYesterday || (currentHour >= 0 && currentHour < 4)) {
      // Use yesterday's date for games between midnight and 3am
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      dateToUse = yesterday;
      updateLog.addLog(
        `Using yesterday's date for API call. forceYesterday: ${forceYesterday}, currentHour: ${currentHour}`
      );
    } else {
      // Use today's date for normal hours
      dateToUse = now;
    }

    const formatDate = (date) => {
      return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(
        2,
        "0"
      )}/${String(date.getDate()).padStart(2, "0")}`;
    };

    const formattedDate = formatDate(dateToUse);

    // Check if we should be checking yesterday rather than today when looking for completion logs
    const checkYesterday =
      forceYesterday || (currentHour >= 0 && currentHour < 4);

    // Check if we already have a log entry saying all games are complete for the day we're checking
    const checkDate = new Date();
    if (checkYesterday) {
      checkDate.setDate(checkDate.getDate() - 1);
    }

    const dayStart = new Date(checkDate.setHours(0, 0, 0, 0));
    const dayEnd = new Date(checkDate.setHours(23, 59, 59, 999));

    const existingCompleteLog = await NcaaUpdateLog.findOne({
      runDate: {
        $gte: dayStart,
        $lte: dayEnd,
      },
      allGamesComplete: true,
    });

    if (existingCompleteLog) {
      updateLog.status = "complete_for_day";
      updateLog.addLog(
        `All games for ${
          checkYesterday ? "yesterday" : "today"
        } are already complete. Skipping update.`
      );
      await updateLog.save();
      console.log(
        `All games for ${
          checkYesterday ? "yesterday" : "today"
        } are already complete. Skipping update.`
      );
      return {
        status: "complete_for_day",
        message: `All games already complete for ${
          checkYesterday ? "yesterday" : "today"
        }`,
      };
    }

    // 3. Fetch games using the determined date
    updateLog.addLog(`Fetching NCAA data for ${formattedDate}`);
    const todayGames = await fetchNcaaResults(formattedDate);

    // Filter for tournament games only (games with bracketRound property)
    const tournamentGames = todayGames.filter(
      (game) => game.bracketRound && game.bracketRound !== ""
    );

    if (tournamentGames.length === 0) {
      updateLog.status = "no_updates";
      updateLog.addLog("No tournament games found today");
      await updateLog.save();
      console.log("No tournament games found today");
      return {
        status: "no_updates",
        message: "No tournament games found today",
      };
    }

    // 4. Track the tournament games for today
    updateLog.addLog(
      `Found ${tournamentGames.length} tournament games to track`
    );

    // Map games to our format for tracking
    tournamentGames.forEach((game) => {
      // Find corresponding matchup in our database
      const matchupId = mapNcaaGameToMatchupId(game, tournament);

      updateLog.trackedGames.push({
        gameId: game.gameID,
        matchupId: matchupId,
        homeTeam: game.home.names.short,
        awayTeam: game.away.names.short,
        region: game.bracketRegion,
        round: game.bracketRound,
        completed: game.gameState === "final",
        score: {
          homeScore: game.home.score ? parseInt(game.home.score) : 0,
          awayScore: game.away.score ? parseInt(game.away.score) : 0,
        },
        updatedInDb: false,
      });
    });

    updateLog.totalTrackedGames = updateLog.trackedGames.length;
    updateLog.completedGames = updateLog.trackedGames.filter(
      (game) => game.completed
    ).length;

    // Check if any games are complete
    const completedGames = tournamentGames.filter(
      (game) => game.gameState === "final"
    );

    if (completedGames.length === 0) {
      updateLog.status = "no_updates";
      updateLog.addLog("No completed tournament games found");
      await updateLog.save();
      console.log("No completed tournament games found");
      return {
        status: "no_updates",
        message: "No completed tournament games found",
        totalGames: updateLog.trackedGames,
      };
    }

    // 5. Process each completed game and update our database
    updateLog.addLog(`Processing ${completedGames.length} completed games`);
    let updatedCount = 0;
    let newlyCompletedRounds = new Set(tournament.completedRounds || []);

    for (const game of completedGames) {
      // Find corresponding matchup in our database
      const matchupId = mapNcaaGameToMatchupId(game, tournament);

      if (!matchupId) {
        const errorMsg = `Could not map NCAA game ID ${game.gameID} to our matchup ID. Teams: ${game.away.names.short} vs ${game.home.names.short}`;
        updateLog.addLog(errorMsg);
        updateLog.errorDetails.push({
          // Changed from errors.push to errorDetails.push
          message: errorMsg,
          gameId: game.gameID,
        });
        continue;
      }

      // Check if this game is already updated in our database
      const existingGame = tournament.games.find(
        (g) => g.matchupId === matchupId
      );

      if (existingGame && existingGame.completed) {
        updateLog.addLog(
          `Game ${matchupId} (${game.away.names.short} vs ${game.home.names.short}) already processed`
        );

        // Update tracking info
        updateLog.updateTrackedGame(game.gameID, {
          completed: true,
          updatedInDb: true,
        });

        continue;
      }

      // Update the game
      try {
        const updated = await updateGameInDatabase(game, matchupId, tournament);

        if (updated) {
          updatedCount++;

          // Update tracking info
          updateLog.updateTrackedGame(game.gameID, {
            completed: true,
            updatedInDb: true,
            score: {
              homeScore: game.home.score ? parseInt(game.home.score) : 0,
              awayScore: game.away.score ? parseInt(game.away.score) : 0,
            },
          });

          // Track round completion status
          const round = mapRoundNameToNumber(game.bracketRound);
          if (round && !newlyCompletedRounds.has(round)) {
            const isRoundComplete = checkIfRoundIsComplete(round, tournament);
            if (isRoundComplete) {
              updateLog.addLog(`Round ${round} is now complete!`);
              newlyCompletedRounds.add(round);
            }
          }
        }
      } catch (error) {
        const errorMsg = `Error updating game ${matchupId}: ${error.message}`;
        updateLog.addLog(errorMsg);
        updateLog.errorDetails.push({
          // Changed from errors.push to errorDetails.push
          message: errorMsg,
          gameId: game.gameID,
        });
      }
    }

    // 6. If any games were updated, update completed rounds and recalculate scores
    if (updatedCount > 0) {
      // Update completed rounds
      tournament.completedRounds = [...newlyCompletedRounds].sort(
        (a, b) => a - b
      );
      tournament.lastUpdated = new Date();
      tournament.markModified("completedRounds");
      await tournament.save();

      // Recalculate all bracket scores
      const updatedBrackets = await recalculateAllBracketScores(tournament);

      updateLog.addLog(`Updated scores for ${updatedBrackets} brackets`);
      updateLog.updatedCount = updatedCount;
      updateLog.status = "success";

      // After scores are updated, run tournament analysis if appropriate
      if (updatedCount > 0) {
        try {
          // Import the tournament analysis functions
          const {
            analyzeTournamentPossibilities,
            getActiveTeams,
          } = require("./tournament-possibilities-analyzer");

          // Check if we're at Sweet 16 or beyond (16 or fewer teams)
          const activeTeams = getActiveTeams(tournament);

          updateLog.addLog(
            `Checking for tournament analysis: ${activeTeams.length} active teams remaining`
          );

          if (activeTeams.length <= 16) {
            updateLog.addLog(
              "Tournament has 16 or fewer teams - running analysis synchronously"
            );
            console.log("Running tournament analysis synchronously...");

            try {
              // Run analysis synchronously with database save enabled
              const analysisResult = await analyzeTournamentPossibilities(true);

              if (analysisResult.error) {
                updateLog.addLog(
                  `Tournament analysis skipped: ${analysisResult.message}`
                );
                console.log(
                  `Tournament analysis skipped: ${analysisResult.message}`
                );
              } else {
                updateLog.addLog(
                  "Tournament analysis completed and saved to database"
                );
                console.log("Tournament analysis completed successfully");
              }
            } catch (analysisError) {
              updateLog.addLog(
                `Error in tournament analysis: ${analysisError.message}`
              );
              console.error("Error in tournament analysis:", analysisError);
            }
          } else {
            updateLog.addLog(
              `Tournament analysis skipped: ${activeTeams.length} active teams (need 16 or fewer)`
            );
          }
        } catch (err) {
          updateLog.addLog(
            `Error preparing tournament analysis: ${err.message}`
          );
          console.error("Error preparing tournament analysis:", err);
        }
      }

      updateLog.addLog(
        `Tournament update successful! Updated ${updatedCount} games.`
      );
      updateLog.addLog(
        `Completed rounds: ${tournament.completedRounds.join(", ")}`
      );
    } else {
      updateLog.status = "no_updates";
      updateLog.addLog("No new games were updated.");
    }

    // 7. Check if all tracked games are now complete
    const allComplete = updateLog.trackedGames.every((game) => game.completed);
    updateLog.allGamesComplete = allComplete;

    if (allComplete) {
      updateLog.addLog("All tracked games for today are complete!");
    }

    await updateLog.save();

    return {
      status: updateLog.status,
      updated: updatedCount,
      totalGames: updateLog.totalTrackedGames,
      completedGames: updateLog.completedGames,
      allComplete,
    };
  } catch (error) {
    console.error("Error updating tournament:", error);

    // Save error to log
    if (updateLog) {
      updateLog.status = "error";
      updateLog.addLog(`Critical error: ${error.message}`);
      updateLog.errorDetails.push({
        // Changed from errors to errorDetails
        message: error.message,
        stack: error.stack,
      });
      await updateLog.save();
    }

    return {
      status: "error",
      error: error.message,
    };
  }
}

/**
 * Fetch results from NCAA API for a specific date
 * @param {string} dateStr - Date in YYYY/MM/DD format
 */
async function fetchNcaaResults(dateStr) {
  try {
    const url = `${NCAA_API_BASE}/${dateStr}/scoreboard.json`;
    console.log(`Fetching NCAA data from: ${url}`);

    const response = await axios.get(url);

    if (response.data && response.data.games) {
      return response.data.games.map((gameWrapper) => gameWrapper.game);
    }

    return [];
  } catch (error) {
    console.error(`Error fetching NCAA results for ${dateStr}:`, error.message);
    return [];
  }
}

/**
 * Map NCAA bracket round names to our round numbers
 */
function mapRoundNameToNumber(roundName) {
  const roundMap = {
    "First Four": 0,
    "First Round": 1,
    "Second Round": 2,
    "Sweet 16": 3,
    "Elite Eight": 4,
    "Final Four": 5,
    Championship: 6,
  };

  return roundMap[roundName] || null;
}

/**
 * Map NCAA region names to our region names
 */
function mapRegionName(regionName) {
  // Handle any inconsistencies between NCAA region names and ours
  const regionMap = {
    East: "East",
    West: "West",
    South: "South",
    Midwest: "Midwest",
    "Final Four": "Final Four",
    Championship: "Championship",
  };

  return regionMap[regionName] || regionName;
}

/**
 * Map NCAA game to our matchup ID
 */
function mapNcaaGameToMatchupId(ncaaGame, tournament) {
  // Determine round number
  const round = mapRoundNameToNumber(ncaaGame.bracketRound);
  if (!round || !tournament.results[round]) {
    return null;
  }

  // Get team names and region
  const region = mapRegionName(ncaaGame.bracketRegion);
  const awayTeamName = cleanTeamName(ncaaGame.away.names.short);
  const homeTeamName = cleanTeamName(ncaaGame.home.names.short);
  const awaySeed = parseInt(ncaaGame.away.seed) || 0;
  const homeSeed = parseInt(ncaaGame.home.seed) || 0;

  // Find the matchup in our database by matching teams
  for (const matchup of tournament.results[round]) {
    // Skip if region doesn't match (except for Final Four/Championship)
    if (round < 5 && matchup.region !== region) {
      continue;
    }

    // Try to match by team names
    const teamsMatch =
      (matchTeamNames(matchup.teamA?.name, awayTeamName) &&
        matchTeamNames(matchup.teamB?.name, homeTeamName)) ||
      (matchTeamNames(matchup.teamA?.name, homeTeamName) &&
        matchTeamNames(matchup.teamB?.name, awayTeamName));

    if (teamsMatch) {
      return matchup.id;
    }

    // If team names don't match exactly, try matching by seeds
    const seedsMatch =
      (matchup.teamA?.seed === awaySeed && matchup.teamB?.seed === homeSeed) ||
      (matchup.teamA?.seed === homeSeed && matchup.teamB?.seed === awaySeed);

    // If seeds match and we're in round 1 or 2, this is likely the correct matchup
    if (seedsMatch && (round === 1 || round === 2)) {
      return matchup.id;
    }
  }

  // If no match found, try a more aggressive approach with a manual mapping table
  return manualMatchupMapping(ncaaGame, tournament, round);
}

/**
 * Clean team name to standardize format
 */
function cleanTeamName(name) {
  // Handle specific team name transformations
  // Examples: "St. John's (NY)" -> "St. John's", "NC-Wilmington" -> "NC Wilmington"

  // Remove parentheses and contents
  name = name.replace(/\s*\([^)]*\)/g, "");

  // Remove "University", "State University", etc.
  name = name.replace(/\s*University\s*/g, "");

  // Standardize St./Saint
  name = name.replace(/^Saint\s+/i, "St. ");

  // Replace hyphens with spaces
  name = name.replace(/-/g, " ");

  return name.trim();
}

/**
 * Match team names accounting for common variations
 */
function matchTeamNames(ourName, ncaaName) {
  if (!ourName || !ncaaName) return false;

  const our = cleanTeamName(ourName).toLowerCase();
  const ncaa = cleanTeamName(ncaaName).toLowerCase();

  // Direct match
  if (our === ncaa) return true;

  // Common abbreviated teams
  const aliases = {
    uconn: ["connecticut"],
    "nc wilmington": ["unc wilmington", "unc-wilmington"],
    "texas a&m": ["texas a m", "tx a&m"],
    "siu edwardsville": ["siue"],
    mississippi: ["ole miss"],
    "st mary's": ["saint mary's"],
    "a&m": ["a m"],
    "st. john's": ["st johns", "saint johns"],
  };

  // Check aliases
  for (const [alias, variants] of Object.entries(aliases)) {
    if (
      (our.includes(alias) && variants.some((v) => ncaa.includes(v))) ||
      (variants.some((v) => our.includes(v)) && ncaa.includes(alias))
    ) {
      return true;
    }
  }

  // Handle challenging cases with a more fuzzy matching approach
  // Get the first word of each name (often the most distinctive part)
  const ourFirstWord = our.split(" ")[0];
  const ncaaFirstWord = ncaa.split(" ")[0];

  // If first words match and one is a substring of the other, consider it a match
  if (
    ourFirstWord === ncaaFirstWord &&
    (our.includes(ncaa) || ncaa.includes(our))
  ) {
    return true;
  }

  return false;
}

/**
 * Manual mapping for hard-to-match teams
 */
function manualMatchupMapping(ncaaGame, tournament, round) {
  // Check for specific edge cases that might need direct mapping
  const teamPair = `${ncaaGame.away.names.short}-${ncaaGame.home.names.short}`;
  const reversePair = `${ncaaGame.home.names.short}-${ncaaGame.away.names.short}`;

  // This would be populated with specific mappings based on issues encountered
  const manualMappings = {
    // Add mappings for problematic teams here
    "UConn-Florida": 36,
    "Florida-UConn": 36,
    "Baylor-Duke": 40,
    "Duke-Baylor": 40,
    "Saint Mary's (CA)-Alabama": 43,
    "Alabama-Saint Mary's (CA)": 43,
    "Colorado St.-Maryland": 37,
    "Maryland-Colorado St.": 37,
    "Ole Miss-Iowa St.": 34,
    "Iowa St.-Ole Miss": 34,
    "New Mexico-Michigan St.": 35,
    "Michigan St.-New Mexico": 35,
    "Oregon-Arizona": 41,
    "Arizona-Oregon": 41,
    "Illinois-Kentucky": 46,
    "Kentucky-Illinois": 46,
  };

  // Check manual mappings first
  if (manualMappings[teamPair]) return manualMappings[teamPair];
  if (manualMappings[reversePair]) return manualMappings[reversePair];

  // If no manual mapping, log the issue for later resolution
  console.log(
    `Manual mapping needed for game: ${teamPair} (Round ${round}, Region ${ncaaGame.bracketRegion})`
  );
  return null;
}

/**
 * Update a specific game in the database
 */
async function updateGameInDatabase(ncaaGame, matchupId, tournament) {
  try {
    // Find the game in our database
    const gameIndex = tournament.games.findIndex(
      (g) => g.matchupId === matchupId
    );

    if (gameIndex === -1) {
      console.log(
        `Game with matchup ID ${matchupId} not found in our database`
      );
      return false;
    }

    // Skip if the game is already marked as completed with same winner
    if (tournament.games[gameIndex].completed) {
      const existingWinner = tournament.games[gameIndex].winner?.name;
      const ncaaWinner = ncaaGame.away.winner
        ? ncaaGame.away.names.short
        : ncaaGame.home.names.short;

      if (matchTeamNames(existingWinner, ncaaWinner)) {
        console.log(`Game ${matchupId} already updated with same winner`);
        return false;
      }
    }

    // Get current game object
    const currentGame = tournament.games[gameIndex];

    // Determine winner based on NCAA data
    let winner;
    if (ncaaGame.away.winner) {
      // Away team won, match to our teamA or teamB
      if (matchTeamNames(currentGame.teamA.name, ncaaGame.away.names.short)) {
        winner = { ...currentGame.teamA };
      } else {
        winner = { ...currentGame.teamB };
      }
    } else if (ncaaGame.home.winner) {
      // Home team won, match to our teamA or teamB
      if (matchTeamNames(currentGame.teamA.name, ncaaGame.home.names.short)) {
        winner = { ...currentGame.teamA };
      } else {
        winner = { ...currentGame.teamB };
      }
    } else {
      // If neither team is marked as winner but game is final, determine by score
      if (parseInt(ncaaGame.away.score) > parseInt(ncaaGame.home.score)) {
        if (matchTeamNames(currentGame.teamA.name, ncaaGame.away.names.short)) {
          winner = { ...currentGame.teamA };
        } else {
          winner = { ...currentGame.teamB };
        }
      } else {
        if (matchTeamNames(currentGame.teamA.name, ncaaGame.home.names.short)) {
          winner = { ...currentGame.teamA };
        } else {
          winner = { ...currentGame.teamB };
        }
      }
    }

    if (!winner) {
      console.log(`Could not determine winner for game ${matchupId}`);
      return false;
    }

    // Map the scores correctly
    let scoreA, scoreB;
    if (matchTeamNames(currentGame.teamA.name, ncaaGame.away.names.short)) {
      scoreA = parseInt(ncaaGame.away.score);
      scoreB = parseInt(ncaaGame.home.score);
    } else {
      scoreA = parseInt(ncaaGame.home.score);
      scoreB = parseInt(ncaaGame.away.score);
    }

    // Update the game in our database
    tournament.games[gameIndex].winner = winner;
    tournament.games[gameIndex].completed = true;
    tournament.games[gameIndex].playedAt = new Date();
    tournament.games[gameIndex].score = {
      teamA: scoreA,
      teamB: scoreB,
    };

    // Update the tournament results bracket structure too
    let matchupUpdated = false;
    for (const round in tournament.results) {
      const matchupIndex = tournament.results[round].findIndex(
        (m) => m.id === matchupId
      );

      if (matchupIndex !== -1) {
        // Update this matchup's winner
        tournament.results[round][matchupIndex].winner = winner;
        matchupUpdated = true;

        // Also update any subsequent rounds where this team appears
        const updatedMatchup = tournament.results[round][matchupIndex];
        if (updatedMatchup.nextMatchupId !== null) {
          // Determine if this team is teamA or teamB in the next matchup based on position
          const isTeamA = updatedMatchup.position % 2 === 0;

          // Find and update the next matchup
          for (const nextRound in tournament.results) {
            if (parseInt(nextRound) > parseInt(round)) {
              const nextMatchupIndex = tournament.results[nextRound].findIndex(
                (m) => m.id === updatedMatchup.nextMatchupId
              );

              if (nextMatchupIndex !== -1) {
                // Update the appropriate team slot
                if (isTeamA) {
                  tournament.results[nextRound][nextMatchupIndex].teamA =
                    winner;
                } else {
                  tournament.results[nextRound][nextMatchupIndex].teamB =
                    winner;
                }
                break;
              }
            }
          }
        }
        break;
      }
    }

    if (!matchupUpdated) {
      console.log(`Could not find matchup ${matchupId} in tournament results`);
      return false;
    }

    // Update team elimination status
    if (!tournament.teams) {
      tournament.teams = {};
    }

    // Update loser as eliminated
    const loser =
      winner.name === currentGame.teamA.name
        ? { ...currentGame.teamB }
        : { ...currentGame.teamA };

    if (tournament.teams[loser.name]) {
      tournament.teams[loser.name] = {
        ...tournament.teams[loser.name],
        eliminated: true,
        eliminationRound: parseInt(
          matchupId < 32
            ? 1
            : matchupId < 48
            ? 2
            : matchupId < 56
            ? 3
            : matchupId < 60
            ? 4
            : matchupId < 62
            ? 5
            : 6
        ),
        eliminationMatchupId: matchupId,
      };
    } else {
      tournament.teams[loser.name] = {
        seed: loser.seed,
        eliminated: true,
        eliminationRound: parseInt(
          matchupId < 32
            ? 1
            : matchupId < 48
            ? 2
            : matchupId < 56
            ? 3
            : matchupId < 60
            ? 4
            : matchupId < 62
            ? 5
            : 6
        ),
        eliminationMatchupId: matchupId,
      };
    }

    // Update winner status
    if (!tournament.teams[winner.name]) {
      tournament.teams[winner.name] = {
        seed: winner.seed,
        eliminated: false,
        eliminationRound: null,
        eliminationMatchupId: null,
      };
    } else {
      // Make sure we don't accidentally mark the winner as eliminated
      tournament.teams[winner.name].eliminated = false;
      tournament.teams[winner.name].eliminationRound = null;
      tournament.teams[winner.name].eliminationMatchupId = null;
    }

    // Save the tournament updates
    tournament.lastUpdated = new Date();
    tournament.markModified("results");
    tournament.markModified("games");
    tournament.markModified("teams");
    await tournament.save();

    console.log(
      `Successfully updated game ${matchupId}: ${currentGame.teamA.name} ${scoreA}-${scoreB} ${currentGame.teamB.name}. Winner: ${winner.name}`
    );
    return true;
  } catch (error) {
    console.error(`Error updating game ${matchupId} in database:`, error);
    throw error;
  }
}

/**
 * Check if a round is complete
 */
function checkIfRoundIsComplete(round, tournament) {
  if (!tournament.results[round]) return false;

  // A round is complete if all matchups in that round have winners
  return tournament.results[round].every((matchup) => matchup.winner !== null);
}

/**
 * Recalculate scores for all brackets
 */
async function recalculateAllBracketScores(tournament) {
  try {
    // Get all brackets
    const brackets = await Bracket.find();
    let updatedBrackets = 0;

    console.log(`Recalculating scores for ${brackets.length} brackets...`);

    for (const bracket of brackets) {
      let score = 0;

      // Process each round
      for (let round = 1; round <= 6; round++) {
        // Get matchups for this round from tournament results
        const tournamentMatchups = tournament.results[round];

        // Get matchups for this round from bracket
        const bracketMatchups = bracket.picks[round];

        if (!tournamentMatchups || !bracketMatchups) continue;

        // Check each matchup in the round
        for (const tournamentMatchup of tournamentMatchups) {
          // Skip if tournament matchup doesn't have a winner yet
          if (!tournamentMatchup.winner) continue;

          // Find corresponding bracket matchup
          const bracketMatchup = bracketMatchups.find(
            (m) => m.id === tournamentMatchup.id
          );

          if (!bracketMatchup || !bracketMatchup.winner) {
            continue;
          }

          // Check if the winner matches
          if (
            bracketMatchup.winner.name === tournamentMatchup.winner.name &&
            bracketMatchup.winner.seed === tournamentMatchup.winner.seed
          ) {
            // Add points based on the round
            score += tournament.scoringConfig[round];
          }
        }
      }

      // Only update if the score changed
      if (score !== bracket.score) {
        bracket.score = score;
        await bracket.save();
        updatedBrackets++;
      }
    }

    console.log(`Updated scores for ${updatedBrackets} brackets`);
    return updatedBrackets;
  } catch (error) {
    console.error("Error recalculating bracket scores:", error);
    return 0;
  }
}

/**
 * Check if there was a recent update log
 */
async function checkRecentUpdateLog() {
  try {
    const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000);
    const recentLog = await NcaaUpdateLog.findOne({
      runDate: { $gte: threeMinutesAgo },
    }).sort({ runDate: -1 });

    return recentLog;
  } catch (error) {
    console.error("Error checking recent update log:", error);
    return null;
  }
}

/**
 * Check if all games are complete for today
 */
async function areAllGamesCompleteForToday() {
  try {
    const today = new Date();
    const dayStart = new Date(today.setHours(0, 0, 0, 0));
    const dayEnd = new Date(today.setHours(23, 59, 59, 999));

    const completionLog = await NcaaUpdateLog.findOne({
      runDate: { $gte: dayStart, $lte: dayEnd },
      allGamesComplete: true,
    });

    return !!completionLog;
  } catch (error) {
    console.error("Error checking if all games are complete:", error);
    return false;
  }
}

/**
 * Check if all games are complete for today
 * @param {boolean} checkYesterday - If true, check yesterday instead of today
 */
async function areAllGamesCompleteForToday(checkYesterday = false) {
  try {
    const today = new Date();

    // If checking yesterday (for midnight to 3am window)
    if (checkYesterday) {
      today.setDate(today.getDate() - 1);
    }

    const dayStart = new Date(today.setHours(0, 0, 0, 0));
    const dayEnd = new Date(today.setHours(23, 59, 59, 999));

    const completionLog = await NcaaUpdateLog.findOne({
      runDate: { $gte: dayStart, $lte: dayEnd },
      allGamesComplete: true,
    });

    return !!completionLog;
  } catch (error) {
    console.error("Error checking if all games are complete:", error);
    return false;
  }
}

/**
 * Manually mark yesterday's games as complete
 * This is useful for recovery when the scheduler fails around midnight
 */
async function markYesterdayAsComplete() {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dayStart = new Date(yesterday.setHours(0, 0, 0, 0));
    const dayEnd = new Date(yesterday.setHours(23, 59, 59, 999));

    // Find the most recent log with tracked games from yesterday
    const mostRecentLog = await NcaaUpdateLog.findOne({
      runDate: { $gte: dayStart, $lte: dayEnd },
      totalTrackedGames: { $gt: 0 },
    }).sort({ runDate: -1 });

    if (!mostRecentLog) {
      console.log("No logs found for yesterday to mark as complete");

      // Create a new completion log
      const newCompletionLog = new NcaaUpdateLog({
        runDate: dayEnd, // Set to end of yesterday
        status: "complete_for_day",
        trackedGames: [],
        totalTrackedGames: 0,
        completedGames: 0,
        allGamesComplete: true,
        logs: ["Manually marked as complete"],
      });

      await newCompletionLog.save();
      return {
        status: "created_completion_log",
        message: "Created new completion log for yesterday",
      };
    }

    // Mark the most recent log as complete
    mostRecentLog.allGamesComplete = true;
    mostRecentLog.addLog("Manually marked as complete");

    // Make sure all games are marked as completed
    if (mostRecentLog.trackedGames && mostRecentLog.trackedGames.length > 0) {
      mostRecentLog.trackedGames.forEach((game) => {
        game.completed = true;
      });

      mostRecentLog.completedGames = mostRecentLog.trackedGames.length;
    }

    await mostRecentLog.save();

    return {
      status: "updated_completion_log",
      message: "Updated existing log as complete",
      log: mostRecentLog,
    };
  } catch (error) {
    console.error("Error marking yesterday as complete:", error);
    throw error;
  }
}

// Export the functions for use in the scheduler
module.exports = {
  updateTournamentResults,
  checkRecentUpdateLog,
  areAllGamesCompleteForToday,
  markYesterdayAsComplete,
};

// Execute directly if called as a script
if (require.main === module) {
  updateTournamentResults()
    .then((result) => {
      console.log("NCAA tournament update completed:", result);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Error in tournament update:", err);
      process.exit(1);
    });
}