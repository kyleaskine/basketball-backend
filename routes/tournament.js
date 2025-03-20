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
          teams: {},  // Add empty teams object
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
    const previousWinner = currentGame.winner ? { ...currentGame.winner } : null;
    
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
      const loser = winner.name === currentGame.teamA.name 
        ? { ...currentGame.teamB } 
        : { ...currentGame.teamA };
      
      // If loser exists in teams, mark as eliminated
      if (tournament.teams[loser.name]) {
        tournament.teams[loser.name] = {
          ...tournament.teams[loser.name],
          eliminated: true,
          eliminationRound: currentGame.round,
          eliminationMatchupId: matchupId
        };
      } else {
        // Create the team entry if it doesn't exist
        tournament.teams[loser.name] = {
          seed: loser.seed,
          eliminated: true,
          eliminationRound: currentGame.round,
          eliminationMatchupId: matchupId
        };
      }
      
      // Initialize winner entry if needed
      if (!tournament.teams[winner.name]) {
        tournament.teams[winner.name] = {
          seed: winner.seed,
          eliminated: false,
          eliminationRound: null,
          eliminationMatchupId: null
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

      // Get a fresh copy of the tournament data to return
      const updatedTournament = await TournamentResults.findOne({
        year: new Date().getFullYear(),
      });

      return res.json({
        tournament: updatedTournament,
        scoresUpdated: true,
        bracketsUpdated: updatedBrackets,
      });
    }

    res.json(tournament);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

// @route   GET api/tournament/enhanced-standings
// @desc    Get enhanced bracket standings with Final Four picks and possible scores
// @access  Public
router.get("/enhanced-standings", async (req, res) => {
  try {
    // Get tournament results first to calculate possible scores
    const tournament = await TournamentResults.findOne({
      year: new Date().getFullYear()
    });

    if (!tournament) {
      return res.status(400).json({ 
        msg: 'No tournament results available yet' 
      });
    }

    // Get all brackets with scores
    const brackets = await Bracket.find().sort({
      score: -1,
      participantName: 1
    });

    // Calculate possible score and extract Final Four picks for each bracket
    const enhancedStandings = brackets.map((bracket, index) => {
      // Extract champion and runner-up picks
      let champion = null;
      let runnerUp = null;
      let finalFourTeams = [];

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

      // Extract Final Four teams
      if (bracket.picks && bracket.picks[5]) {
        // Get winners from the Final Four matchups
        finalFourTeams = bracket.picks[5]
          .filter(matchup => matchup.winner)
          .map(matchup => matchup.winner);

        // Also include teams that made it to Final Four but didn't win
        bracket.picks[5].forEach(matchup => {
          if (matchup.teamA && !finalFourTeams.some(team => team.name === matchup.teamA.name)) {
            finalFourTeams.push(matchup.teamA);
          }
          if (matchup.teamB && !finalFourTeams.some(team => team.name === matchup.teamB.name)) {
            finalFourTeams.push(matchup.teamB);
          }
        });
      }

      // Calculate maximum possible score
      let recalculatedScore = 0;
      let possibleScore = 0;
      let futureRoundPoints = {};
      
      // Calculate which teams are still alive for each participant
      const teamsStillAlive = [];
      
      // We need to recalculate from scratch for accuracy
      if (tournament.scoringConfig && tournament.results) {
        // Initialize future round points tracking
        for (let round = 1; round <= 6; round++) {
          futureRoundPoints[round] = 0;
        }
        
        // Loop through all rounds
        for (let round = 1; round <= 6; round++) {
          // Check each matchup in the round
          if (bracket.picks[round]) {
            bracket.picks[round].forEach(matchup => {
              // Skip if matchup doesn't have a winner picked
              if (!matchup.winner) return;
              
              // Find corresponding tournament matchup
              const tournamentMatchup = tournament.results[round]?.find(m => m.id === matchup.id);
              
              // CHECKING INDIVIDUAL GAMES instead of entire rounds
              if (tournamentMatchup?.winner) {
                // This individual game is complete - check if pick was correct
                if (tournamentMatchup.winner.name === matchup.winner.name &&
                    tournamentMatchup.winner.seed === matchup.winner.seed) {
                  // Correct pick! Add points
                  recalculatedScore += tournament.scoringConfig[round];
                  possibleScore += tournament.scoringConfig[round];
                }
                // Wrong pick - no points possible from this game
              } 
              else {
                // Game not yet played - check if player's team is still alive
                if (tournament.teams && !tournament.teams[matchup.winner.name]?.eliminated) {
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
        
        // Log the difference for debugging if scores don't match
        if (recalculatedScore !== bracket.score) {
          console.log(`Score mismatch for ${bracket.participantName}: DB=${bracket.score}, Calculated=${recalculatedScore}`);
        }
      }

      return {
        position: index + 1,
        participantName: bracket.participantName,
        entryNumber: bracket.entryNumber || 1,
        score: bracket.score,  // Keep using the database score for consistency
        recalculatedScore: recalculatedScore, // Include the recalculated score for reference
        userEmail: bracket.userEmail,
        id: bracket._id,
        possibleScore,
        champion,
        runnerUp,
        finalFourTeams,
        // Include additional useful data for UI
        teamsStillAlive,
        futureRoundPoints
      };
    });

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
      completedRounds: tournament ? tournament.completedRounds : []
    };

    res.json({
      standings: enhancedStandings,
      stats
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

module.exports = router;
