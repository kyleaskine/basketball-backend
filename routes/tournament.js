const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const admin = require("../middleware/admin");
const TournamentResults = require("../models/TournamentResults");
const Bracket = require("../models/Bracket");

// @route   GET api/tournament/results
// @desc    Get tournament results
// @access  Public
router.get("/results", async (req, res) => {
  try {
    // Get the current year's tournament results, or create if it doesn't exist
    let results = await TournamentResults.findOne({
      year: new Date().getFullYear(),
    });

    if (!results) {
      // Return empty results if none exist yet
      return res.json({
        results: null,
        completedRounds: [],
        games: [],
        teams: {}, // Add empty teams object
      });
    }

    // Make sure to include teams in the response even if it's empty
    if (!results.teams) {
      results.teams = {};
    }

    res.json(results);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

// @route   GET api/tournament/standings
// @desc    Get bracket standings
// @access  Public
router.get("/standings", async (req, res) => {
  try {
    // Get tournament results to check if it exists
    const tournament = await TournamentResults.findOne({
      year: new Date().getFullYear(),
    });

    /* Commented out this check to allow standings to work without completed rounds
      if (!tournament || tournament.completedRounds.length === 0) {
        return res.status(400).json({ 
          msg: 'No tournament results available yet' 
        });
      }
      */

    // Get all brackets with scores
    const brackets = await Bracket.find().sort({
      score: -1,
      participantName: 1,
    });

    // Format standings data
    const standings = brackets.map((bracket, index) => {
      return {
        position: index + 1,
        participantName: bracket.participantName,
        entryNumber: bracket.entryNumber || 1,
        score: bracket.score,
        userEmail: bracket.userEmail,
        id: bracket._id,
      };
    });

    // Get some stats
    const stats = {
      totalBrackets: brackets.length,
      averageScore:
        brackets.reduce((acc, bracket) => acc + bracket.score, 0) /
        (brackets.length || 1), // Avoid division by zero
      highestScore: brackets.length > 0 ? brackets[0].score : 0,
      completedRounds: tournament ? tournament.completedRounds : [],
    };

    res.json({
      standings,
      stats,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

// ADMIN ROUTES

// @route   POST api/tournament/results
// @desc    Create or update tournament results
// @access  Private (admin only)
router.post("/results", [auth, admin], async (req, res) => {
  const { results, completedRounds, games, scoringConfig } = req.body;

  try {
    // Find existing tournament results for the current year
    let tournament = await TournamentResults.findOne({
      year: new Date().getFullYear(),
    });

    if (tournament) {
      // Update existing tournament
      if (results) tournament.results = results;
      if (completedRounds) tournament.completedRounds = completedRounds;
      if (games) tournament.games = games;
      if (scoringConfig) tournament.scoringConfig = scoringConfig;

      tournament.lastUpdated = Date.now();
      tournament.markModified("results");
      tournament.markModified("games");
      tournament.markModified("teams");
      await tournament.save();
    } else {
      // Create new tournament results
      tournament = new TournamentResults({
        results,
        completedRounds: completedRounds || [],
        games: games || [],
        scoringConfig: scoringConfig || undefined,
      });
      tournament.markModified("results");
      tournament.markModified("games");
      tournament.markModified("teams");
      await tournament.save();
    }

    res.json(tournament);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

// @route   POST api/tournament/calculate-scores
// @desc    Calculate scores for all brackets based on tournament results
// @access  Private (admin only)
router.post("/calculate-scores", [auth, admin], async (req, res) => {
  try {
    // Get tournament results
    const tournament = await TournamentResults.findOne({
      year: new Date().getFullYear(),
    });

    if (!tournament || !tournament.results) {
      return res.status(400).json({
        msg: "No tournament results available for scoring",
      });
    }

    // Get all brackets
    const brackets = await Bracket.find();

    // Results counter
    let updated = 0;
    let errors = 0;

    // Loop through each bracket and calculate score
    for (const bracket of brackets) {
      try {
        // Initialize score
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

        // Update bracket score
        bracket.score = score;
        await bracket.save();
        updated++;
      } catch (err) {
        console.error(
          `Error calculating score for bracket ${bracket._id}:`,
          err
        );
        errors++;
      }
    }

    res.json({
      msg: `Scores calculated: ${updated} brackets updated, ${errors} errors`,
      success: true,
      updated,
      errors,
    });
  } catch (err) {
    console.error("Error calculating scores:", err.message);
    res.status(500).send("Server error");
  }
});

// @route   PUT api/tournament/lock-brackets
// @desc    Lock all brackets (when tournament starts)
// @access  Private (admin only)
router.put("/lock-brackets", [auth, admin], async (req, res) => {
  try {
    const result = await Bracket.updateMany({}, { isLocked: true });

    res.json({
      msg: `Locked ${result.nModified} brackets`,
      success: true,
      count: result.nModified,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

// @route   PUT api/tournament/unlock-brackets
// @desc    Unlock all brackets (for testing purposes)
// @access  Private (admin only)
router.put("/unlock-brackets", [auth, admin], async (req, res) => {
  try {
    const result = await Bracket.updateMany({}, { isLocked: false });

    res.json({
      msg: `Unlocked ${result.nModified} brackets`,
      success: true,
      count: result.nModified,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

// @route   GET api/tournament/status
// @desc    Get tournament lock status
// @access  Public
router.get("/status", async (req, res) => {
  try {
    // First check if any brackets are locked
    const bracketCount = await Bracket.countDocuments();
    if (bracketCount === 0) {
      // If no brackets exist yet, tournament is not locked
      return res.json({ isLocked: false });
    }

    // Check if brackets are locked by checking one bracket
    const sampleBracket = await Bracket.findOne();
    return res.json({ isLocked: sampleBracket.isLocked });
  } catch (err) {
    console.error("Error checking tournament status:", err);
    res.status(500).send("Server error");
  }
});

// @route   PUT api/tournament/games/:id
// @desc    Update a specific game result
// @access  Private (admin only)
router.put("/games/:id", [auth, admin], async (req, res) => {
  const { winner, score, completed } = req.body;
  const matchupId = parseInt(req.params.id);
  const autoCalculateScores = req.query.calculateScores === "true";
  const runTournamentAnalysis = req.query.runAnalysis !== "false"; // Default to true unless explicitly set to false

  // Fix for handling ID 0 - check if it's a number instead of truthy/falsy check
  if (isNaN(matchupId) || matchupId < 0) {
    return res.status(400).json({ msg: "Valid matchup ID is required" });
  }

  try {
    // Get tournament results
    let tournament = await TournamentResults.findOne({
      year: new Date().getFullYear(),
    });

    if (!tournament) {
      return res.status(404).json({ msg: "Tournament results not found" });
    }

    // Find the game in the tournament results
    const gameIndex = tournament.games.findIndex(
      (g) => g.matchupId === matchupId
    );

    if (gameIndex === -1) {
      return res.status(404).json({ msg: "Game not found" });
    }

    // Get current game and previous winner (if any)
    const currentGame = tournament.games[gameIndex];
    const previousWinner = currentGame.winner
      ? { ...currentGame.winner }
      : null;

    // Update the game
    if (winner) tournament.games[gameIndex].winner = winner;
    if (score) tournament.games[gameIndex].score = score;
    if (completed !== undefined)
      tournament.games[gameIndex].completed = completed;

    // If marking as completed, set playedAt date
    if (completed) {
      tournament.games[gameIndex].playedAt = Date.now();
    }

    // Initialize teams object if it doesn't exist
    if (!tournament.teams) {
      tournament.teams = {};
    }

    // Update teams object based on game result
    if (completed && winner) {
      const loser =
        winner.name === currentGame.teamA.name
          ? { ...currentGame.teamB }
          : { ...currentGame.teamA };

      // If loser exists in teams, mark as eliminated
      if (tournament.teams[loser.name]) {
        tournament.teams[loser.name] = {
          ...tournament.teams[loser.name],
          eliminated: true,
          eliminationRound: currentGame.round,
          eliminationMatchupId: matchupId,
        };
      } else {
        // Create the team entry if it doesn't exist
        tournament.teams[loser.name] = {
          seed: loser.seed,
          eliminated: true,
          eliminationRound: currentGame.round,
          eliminationMatchupId: matchupId,
        };
      }

      // Initialize winner entry if needed
      if (!tournament.teams[winner.name]) {
        tournament.teams[winner.name] = {
          seed: winner.seed,
          eliminated: false,
          eliminationRound: null,
          eliminationMatchupId: null,
        };
      }

      // If the winner is changing, we need to update the previous winner too
      if (previousWinner && previousWinner.name !== winner.name) {
        // Reset the elimination status of the previous "loser" that's now winning
        if (tournament.teams[winner.name]) {
          tournament.teams[winner.name].eliminated = false;
          tournament.teams[winner.name].eliminationRound = null;
          tournament.teams[winner.name].eliminationMatchupId = null;
        }

        // Also update any team that the previous winner will now face in the next round
        // This would require looking through the bracket to find matchups that would be affected
        // ...code to update future matchups would go here...
      }
    }

    // Also update the main results object
    let matchupFound = false;
    for (const round in tournament.results) {
      const matchupIndex = tournament.results[round].findIndex(
        (m) => m.id === matchupId
      );

      if (matchupIndex !== -1) {
        matchupFound = true;
        if (winner) tournament.results[round][matchupIndex].winner = winner;

        // Also update any subsequent rounds where this team appears
        if (winner) {
          const updatedMatchup = tournament.results[round][matchupIndex];
          if (updatedMatchup.nextMatchupId !== null) {
            // Find which team slot to update (teamA or teamB) in the next matchup
            let isTeamA = updatedMatchup.position % 2 === 0;

            // Find and update the next matchup
            for (const nextRound in tournament.results) {
              if (parseInt(nextRound) > parseInt(round)) {
                const nextMatchupIndex = tournament.results[
                  nextRound
                ].findIndex((m) => m.id === updatedMatchup.nextMatchupId);

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
        }
        break;
      }
    }

    if (!matchupFound) {
      return res.status(404).json({ msg: "Matchup not found in results" });
    }

    // Update lastUpdated timestamp
    tournament.lastUpdated = Date.now();
    tournament.markModified("results");
    tournament.markModified("games");
    tournament.markModified("teams");
    await tournament.save();

    // Auto-calculate scores if requested
    if (autoCalculateScores && completed && winner) {
      // This is a simplified version of the score calculation logic
      // to update scores based on this specific game result
      const brackets = await Bracket.find();
      let updatedBrackets = 0;

      for (const bracket of brackets) {
        try {
          // Find the round for this matchup
          let matchupRound = null;
          for (const round in tournament.results) {
            if (tournament.results[round].some((m) => m.id === matchupId)) {
              matchupRound = parseInt(round);
              break;
            }
          }

          if (!matchupRound) continue;

          // Get the matchup from the bracket
          const bracketMatchups = bracket.picks[matchupRound];
          if (!bracketMatchups) continue;

          const bracketMatchup = bracketMatchups.find(
            (m) => m.id === matchupId
          );
          if (!bracketMatchup || !bracketMatchup.winner) continue;

          // Check if the pick matches the result
          const correctPick =
            bracketMatchup.winner.name === winner.name &&
            bracketMatchup.winner.seed === winner.seed;

          // Update score if correct
          if (correctPick) {
            bracket.score += tournament.scoringConfig[matchupRound];
            await bracket.save();
            updatedBrackets++;
          }
        } catch (err) {
          console.error(
            `Error updating score for bracket ${bracket._id}:`,
            err
          );
        }
      }

      // Run tournament analysis if completed game and requested
      if (completed && runTournamentAnalysis) {
        try {
          // Import the analysis function
          const {
            analyzeTournamentPossibilities,
            getActiveTeams,
          } = require("../tournament-possibilities-analyzer");

          // First check if we're at Sweet 16 or beyond
          const activeTeams = getActiveTeams(tournament);
          if (activeTeams.length <= 16) {
            // Run analysis in the background without waiting for it to complete
            // Save to DB since this is an admin action
            analyzeTournamentPossibilities(true)
              .then((result) => {
                if (result.error) {
                  console.log(`Tournament analysis skipped: ${result.message}`);
                } else {
                  console.log(
                    "Tournament analysis completed and saved to database after game update"
                  );
                }
              })
              .catch((err) => {
                console.error(
                  "Error running tournament analysis after game update:",
                  err
                );
              });

            console.log(
              "Tournament analysis started in background after game update"
            );
          } else {
            console.log(
              `Tournament analysis skipped: ${activeTeams.length} active teams (need 16 or fewer)`
            );
          }
        } catch (analysisErr) {
          console.error("Failed to start tournament analysis:", analysisErr);
        }
      }

      // Get a fresh copy of the tournament data to return
      const updatedTournament = await TournamentResults.findOne({
        year: new Date().getFullYear(),
      });

      return res.json({
        tournament: updatedTournament,
        scoresUpdated: true,
        bracketsUpdated: updatedBrackets,
        analysisStarted: completed && runTournamentAnalysis,
      });
    }

    res.json(tournament);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

/**
 * Calculate scores by round and region for a bracket
 * @param {Object} bracket - Bracket data with picks
 * @param {Object} tournamentResults - Current tournament results
 * @returns {Object} Object containing roundScores and regionScores
 */
const calculateDetailedScores = (bracket, tournamentResults) => {
  // Initialize score objects
  const roundScores = {
    "1": 0, // First Round
    "2": 0, // Second Round
    "3": 0, // Sweet 16
    "4": 0, // Elite 8
    "5": 0, // Final Four
    "6": 0  // Championship
  };
  
  const regionScores = {
    "East": 0,
    "West": 0,
    "South": 0,
    "Midwest": 0,
    "FinalFour": 0 // For Final Four games
  };

  // If we don't have the necessary data, return empty scores
  if (!bracket.picks || !tournamentResults || !tournamentResults.results || !tournamentResults.scoringConfig) {
    console.log("Missing necessary data for score calculation");
    return { roundScores, regionScores };
  }
  
  try {
    // Create a direct matchup to region mapping using tournament structure
    const matchupRegions = {};
    
    // STEP 1: First extract regions directly from the games collection
    // This is the most authoritative source if available
    if (tournamentResults.games && tournamentResults.games.length > 0) {
      tournamentResults.games.forEach(game => {
        if (game.matchupId !== undefined) {
          // Handle edge cases like matchupId 0
          const matchupId = game.matchupId;
          
          // Handle special regions like "Championship"
          if (game.region === "Championship") {
            matchupRegions[matchupId] = "FinalFour";
          } else if (game.region) {
            matchupRegions[matchupId] = game.region;
          }
        }
      });
    }
    
    // STEP 2: For rounds 5-6, explicitly map to FinalFour
    // Rounds 5-6 are always Final Four and Championship
    for (const round of ["5", "6"]) {
      if (tournamentResults.results[round]) {
        tournamentResults.results[round].forEach(matchup => {
          if (matchup.id !== undefined) {
            matchupRegions[matchup.id] = "FinalFour";
          }
        });
      }
    }
    
    // STEP 3: Handle special case matchup IDs mentioned by the user
    // These appear to be edge cases in the matchup ID system
    for (const specialId of [0, 32, 48]) {
      // Find these matchups in the tournament data
      for (let round = 1; round <= 6; round++) {
        if (tournamentResults.results[round]) {
          const matchup = tournamentResults.results[round].find(m => m.id === specialId);
          if (matchup) {
            // If we found the matchup, determine its region
            if (round >= 5) {
              matchupRegions[specialId] = "FinalFour";
            } else if (round <= 4) {
              // For earlier rounds, try to determine region from the teams
              // If a region is already set from games data, use that
              if (!matchupRegions[specialId]) {
                // As a fallback, look for region info in the matchup object itself
                if (matchup.region) {
                  matchupRegions[specialId] = matchup.region;
                } else {
                  console.log(`Special matchup ${specialId} found in round ${round}, but can't determine region`);
                }
              }
            }
          }
        }
      }
    }
    
    // STEP 4: Cross-reference with team data
    // Since teams belong to regions, we can use team data to infer regions for rounds 1-4
    if (tournamentResults.teams) {
      // For each matchup in rounds 1-4
      for (let round = 1; round <= 4; round++) {
        if (tournamentResults.results[round]) {
          tournamentResults.results[round].forEach(matchup => {
            // If we haven't determined this matchup's region yet
            if (matchup.id !== undefined && !matchupRegions[matchup.id]) {
              // Check if this matchup has region info directly
              if (matchup.region) {
                matchupRegions[matchup.id] = matchup.region;
              }
              // Otherwise try to infer from teams
              else if (matchup.teamA && matchup.teamA.name && tournamentResults.teams[matchup.teamA.name]) {
                // Some tournament structures store region with the team
                const teamData = tournamentResults.teams[matchup.teamA.name];
                if (teamData.region) {
                  matchupRegions[matchup.id] = teamData.region;
                }
              }
            }
          });
        }
      }
    }
    
    // Calculate scores by round
    for (let round = 1; round <= 6; round++) {
      // Skip if no picks for this round
      if (!bracket.picks[round]) continue;
      
      // Check each matchup in the round
      bracket.picks[round].forEach(matchup => {
        // Skip if no winner picked
        if (!matchup.winner) return;
        
        // Find corresponding tournament matchup
        const tournamentMatchup = tournamentResults.results[round]?.find(
          m => m.id === matchup.id
        );
        
        // Skip if tournament matchup not found or doesn't have a winner
        if (!tournamentMatchup || !tournamentMatchup.winner) return;
        
        // Check if the pick matches the result
        if (
          tournamentMatchup.winner.name === matchup.winner.name &&
          tournamentMatchup.winner.seed === matchup.winner.seed
        ) {
          // Add points to the round total
          const points = tournamentResults.scoringConfig[round] || 0;
          roundScores[round] += points;
          
          // Determine region for this matchup
          let region = "Unknown";
          
          // For rounds 5-6, always use FinalFour
          if (round >= 5) {
            region = "FinalFour";
          } else {
            // For rounds 1-4, use our mapping
            region = matchupRegions[matchup.id] || "Unknown";
            
            // If still unknown, check if the matchup has region info directly
            if (region === "Unknown" && tournamentMatchup.region) {
              region = tournamentMatchup.region;
            }
            
            // If still unknown, check if we can infer from the winner's region
            if (region === "Unknown" && tournamentResults.teams && 
                tournamentResults.teams[tournamentMatchup.winner.name]?.region) {
              region = tournamentResults.teams[tournamentMatchup.winner.name].region;
            }
          }
          
          // Add points to the appropriate region
          if (regionScores.hasOwnProperty(region)) {
            regionScores[region] += points;
          } else if (region === "Unknown") {
            console.log(`Still unknown region for matchup ${matchup.id} in round ${round}`);
            
            // As a last resort fallback for rounds 1-4, distribute equally
            if (round <= 4) {
              for (const r of ["East", "West", "South", "Midwest"]) {
                regionScores[r] += points / 4;
              }
            } else {
              // Rounds 5-6 always go to FinalFour
              regionScores["FinalFour"] += points;
            }
          }
        }
      });
    }
    
    return { roundScores, regionScores };
  } catch (error) {
    console.error("Error calculating detailed scores:", error);
    return { roundScores, regionScores };
  }
};

// @route   GET api/tournament/enhanced-standings
// @desc    Get enhanced bracket standings with detailed score breakdowns
// @access  Public
router.get("/enhanced-standings", async (req, res) => {
  try {
    // Get tournament results first to calculate scores
    const tournament = await TournamentResults.findOne({
      year: new Date().getFullYear(),
    });
    
    if (!tournament) {
      return res.status(400).json({
        msg: "No tournament results available yet",
      });
    }
    
    // Get all brackets with scores
    const brackets = await Bracket.find().sort({
      score: -1,
      participantName: 1,
    });
    
    // Enhanced standings with round and region scores
    const enhancedStandings = await Promise.all(brackets.map(async (bracket, index) => {
      // Basic information from existing code
      let champion = null;
      let runnerUp = null;
      let finalFourTeams = [];
      let recalculatedScore = 0;
      let possibleScore = 0;
      let futureRoundPoints = {};
      const teamsStillAlive = [];

      // Get championship matchup
      if (bracket.picks && bracket.picks[6] && bracket.picks[6][0]) {
        // Champion is the winner of the championship matchup
        champion = bracket.picks[6][0].winner;
        // Runner-up is the other team in the championship matchup
        if (bracket.picks[6][0].teamA && bracket.picks[6][0].teamB && champion) {
          if (champion.name === bracket.picks[6][0].teamA.name) {
            runnerUp = bracket.picks[6][0].teamB;
          } else {
            runnerUp = bracket.picks[6][0].teamA;
          }
        }
      }

      // Extract Final Four teams (existing code...)
      if (bracket.picks && bracket.picks[5]) {
        // Get winners from the Final Four matchups
        finalFourTeams = bracket.picks[5]
          .filter((matchup) => matchup.winner)
          .map((matchup) => matchup.winner);
        // Also include teams that made it to Final Four but didn't win
        bracket.picks[5].forEach((matchup) => {
          if (matchup.teamA && !finalFourTeams.some((team) => team.name === matchup.teamA.name)) {
            finalFourTeams.push(matchup.teamA);
          }
          if (matchup.teamB && !finalFourTeams.some((team) => team.name === matchup.teamB.name)) {
            finalFourTeams.push(matchup.teamB);
          }
        });
      }

      // Initialize future round points tracking
      for (let round = 1; round <= 6; round++) {
        futureRoundPoints[round] = 0;
      }

      // Get detailed scores
      const { roundScores, regionScores } = calculateDetailedScores(bracket, tournament);

      // Calculate recalculated score and possible score (existing logic...)
      if (tournament.scoringConfig && tournament.results) {
        // Loop through all rounds
        for (let round = 1; round <= 6; round++) {
          // Check each matchup in the round
          if (bracket.picks[round]) {
            bracket.picks[round].forEach((matchup) => {
              // Skip if matchup doesn't have a winner picked
              if (!matchup.winner) return;
              
              // Find corresponding tournament matchup
              const tournamentMatchup = tournament.results[round]?.find(
                (m) => m.id === matchup.id
              );
              
              // CHECKING INDIVIDUAL GAMES instead of entire rounds
              if (tournamentMatchup?.winner) {
                // This individual game is complete - check if pick was correct
                if (
                  tournamentMatchup.winner.name === matchup.winner.name &&
                  tournamentMatchup.winner.seed === matchup.winner.seed
                ) {
                  // Correct pick! Add points
                  recalculatedScore += tournament.scoringConfig[round];
                  possibleScore += tournament.scoringConfig[round];
                }
                // Wrong pick - no points possible from this game
              } else {
                // Game not yet played - check if player's team is still alive
                if (
                  tournament.teams &&
                  !tournament.teams[matchup.winner.name]?.eliminated
                ) {
                  // Team still active, points still possible
                  possibleScore += tournament.scoringConfig[round];
                  // Track points by round for detailed breakdown
                  futureRoundPoints[round] += tournament.scoringConfig[round];
                  // Track this team as still alive for this participant
                  if (!teamsStillAlive.includes(matchup.winner.name)) {
                    teamsStillAlive.push(matchup.winner.name);
                  }
                }
                // Team eliminated - no points possible
              }
            });
          }
        }
      }

      return {
        position: index + 1,
        participantName: bracket.participantName,
        entryNumber: bracket.entryNumber || 1,
        score: bracket.score,
        recalculatedScore,
        userEmail: bracket.userEmail,
        id: bracket._id,
        possibleScore,
        champion,
        runnerUp,
        finalFourTeams,
        teamsStillAlive,
        futureRoundPoints,
        // Add the new score breakdowns
        roundScores,
        regionScores
      };
    }));

    // Sort by score (just to be sure)
    enhancedStandings.sort((a, b) => b.score - a.score);
    
    // Recalculate positions after sorting
    enhancedStandings.forEach((entry, index) => {
      entry.position = index + 1;
    });
    
    // Get some stats
    const stats = {
      totalBrackets: brackets.length,
      averageScore:
        brackets.reduce((acc, bracket) => acc + bracket.score, 0) /
        (brackets.length || 1), // Avoid division by zero
      highestScore: brackets.length > 0 ? brackets[0].score : 0,
      completedRounds: tournament ? tournament.completedRounds : [],
    };
    
    res.json({
      standings: enhancedStandings,
      stats,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

// @route   GET api/tournament/matchup-stats/:matchupId/:isTopSlot
// @desc    Get statistics for teams feeding into a specific matchup
// @access  Public
router.get("/matchup-stats/:matchupId/:isTopSlot", async (req, res) => {
  try {
    const matchupId = parseInt(req.params.matchupId);
    const isTopSlot = req.params.isTopSlot === "1"; // Convert to boolean

    // Get all brackets
    const brackets = await Bracket.find({ isLocked: true }); // Only consider locked brackets

    // Initialize stats object
    const stats = {
      totalPicks: 0,
      teamStats: {},
      matchupInfo: null,
      sourceMatchups: [],
    };

    // Find the matchup information from the tournament results
    const tournament = await TournamentResults.findOne({
      year: new Date().getFullYear(),
    });

    if (!tournament || !tournament.results) {
      return res.status(404).json({ message: "Tournament results not found" });
    }

    // Find the current matchup
    let currentMatchup = null;
    let currentRound = 0;
    for (let round = 1; round <= 6; round++) {
      const matchups = tournament.results[round];
      if (!matchups) continue;

      const foundMatchup = matchups.find((m) => m.id === matchupId);
      if (foundMatchup) {
        currentMatchup = foundMatchup;
        currentRound = round;
        break;
      }
    }

    if (!currentMatchup) {
      return res.status(404).json({ message: "Matchup not found" });
    }

    // Store the current matchup info
    stats.matchupInfo = {
      ...currentMatchup,
      round: currentRound,
    };

    // For round 1, just show the stats for this matchup
    if (currentRound === 1) {
      // Process each bracket for this matchup
      for (const bracket of brackets) {
        if (!bracket.picks || !bracket.picks[1]) continue;

        const matchup = bracket.picks[1].find((m) => m.id === matchupId);
        if (matchup && matchup.winner) {
          stats.totalPicks++;
          const teamName = matchup.winner.name;

          if (!stats.teamStats[teamName]) {
            stats.teamStats[teamName] = {
              count: 0,
              seed: matchup.winner.seed,
              percentage: 0,
              isWinner:
                currentMatchup.winner &&
                currentMatchup.winner.name === teamName,
              users: [],
            };
          }

          stats.teamStats[teamName].count++;
          stats.teamStats[teamName].users.push({
            name: bracket.participantName,
            entryNumber: bracket.entryNumber || 1,
            email: bracket.userEmail,
            bracketId: bracket._id,
          });
        }
      }
    }
    // For round 2+, find the source matchups and analyze those picks
    else {
      const prevRound = currentRound - 1;

      // Find the source matchups that feed into this one
      let sourceMatchups = tournament.results[prevRound].filter(
        (m) => m.nextMatchupId === matchupId
      );

      // Sort source matchups by ID so we can reliably select top (lowest ID) or bottom (highest ID)
      sourceMatchups.sort((a, b) => a.id - b.id);

      // Select only the relevant source matchup based on isTopSlot
      // Top slot (A) = first source matchup (lowest ID)
      // Bottom slot (B) = last source matchup (highest ID)
      const relevantSourceMatchup = isTopSlot
        ? sourceMatchups[0] // Top slot (A) - first matchup
        : sourceMatchups[sourceMatchups.length - 1]; // Bottom slot (B) - last matchup

      if (!relevantSourceMatchup) {
        return res.status(404).json({ message: "Source matchup not found" });
      }

      // Store only the relevant source matchup in response
      stats.sourceMatchups = [relevantSourceMatchup];

      const sourceMatchupId = relevantSourceMatchup.id;

      // Process each bracket for this specific source matchup
      for (const bracket of brackets) {
        if (!bracket.picks || !bracket.picks[prevRound]) continue;

        const matchup = bracket.picks[prevRound].find(
          (m) => m.id === sourceMatchupId
        );
        if (matchup && matchup.winner) {
          stats.totalPicks++;
          const teamName = matchup.winner.name;

          if (!stats.teamStats[teamName]) {
            stats.teamStats[teamName] = {
              count: 0,
              seed: matchup.winner.seed,
              percentage: 0,
              isWinner:
                relevantSourceMatchup.winner &&
                relevantSourceMatchup.winner.name === teamName,
              users: [],
            };
          }

          stats.teamStats[teamName].count++;
          stats.teamStats[teamName].users.push({
            name: bracket.participantName,
            entryNumber: bracket.entryNumber || 1,
            email: bracket.userEmail,
            bracketId: bracket._id,
          });
        }
      }
    }

    // Calculate percentages
    if (stats.totalPicks > 0) {
      for (const team in stats.teamStats) {
        stats.teamStats[team].percentage = parseFloat(
          ((stats.teamStats[team].count / stats.totalPicks) * 100).toFixed(1)
        );
      }
    }

    // Filter out teams with 0 picks
    const teamsWithPicks = {};
    for (const teamName in stats.teamStats) {
      if (stats.teamStats[teamName].count > 0) {
        teamsWithPicks[teamName] = stats.teamStats[teamName];
      }
    }
    stats.teamStats = teamsWithPicks;

    res.json(stats);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

// @route   POST api/tournament/generate-next-round
// @desc    Generate games for the next round
// @access  Private (admin only)
router.post("/generate-next-round", [auth, admin], async (req, res) => {
  try {
    const tournament = await TournamentResults.findOne({
      year: new Date().getFullYear(),
    });

    if (!tournament) {
      return res.status(404).json({ msg: "Tournament results not found" });
    }

    // Determine which round to generate games for
    const completedRounds = tournament.completedRounds || [];
    if (completedRounds.length === 0) {
      return res.status(400).json({ msg: "No rounds have been completed yet" });
    }

    // Sort completed rounds to find the latest
    const sortedRounds = [...completedRounds].sort((a, b) => a - b);
    const latestCompletedRound = sortedRounds[sortedRounds.length - 1];
    const nextRound = latestCompletedRound + 1;

    if (nextRound > 6) {
      return res
        .status(400)
        .json({ msg: "Tournament has reached the final round" });
    }

    // Get matchups from the bracket structure for the next round
    const nextRoundMatchups = tournament.results[nextRound];
    if (!nextRoundMatchups) {
      return res
        .status(400)
        .json({ msg: "No matchups found for the next round" });
    }

    // Create new games for matchups that have both teams defined
    const newGames = [];
    for (const matchup of nextRoundMatchups) {
      if (matchup.teamA && matchup.teamB) {
        // Check if a game already exists for this matchup
        const existingGame = tournament.games.find(
          (g) => g.matchupId === matchup.id
        );
        if (!existingGame) {
          newGames.push({
            matchupId: matchup.id,
            round: nextRound,
            teamA: matchup.teamA,
            teamB: matchup.teamB,
            winner: null,
            score: {
              teamA: 0,
              teamB: 0,
            },
            completed: false,
          });
        }
      }
    }

    if (newGames.length === 0) {
      return res.status(400).json({
        msg: "No new games could be generated. Make sure all previous round winners have been determined.",
      });
    }

    // Add new games to the tournament
    tournament.games = [...tournament.games, ...newGames];
    tournament.markModified("games");
    await tournament.save();

    res.json({
      msg: `Successfully generated ${newGames.length} games for round ${nextRound}`,
      newGames,
      nextRound,
    });
  } catch (err) {
    console.error("Error generating next round games:", err);
    res.status(500).send("Server error");
  }
});

module.exports = router;
