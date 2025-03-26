const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const admin = require("../middleware/admin");
const mongoose = require("mongoose");

// Import the analysis module
const {
  analyzeTournamentPossibilities,
} = require("../tournament-possibilities-analyzer");

// @route   GET api/tournament/possibilities
// @desc    Get tournament possibility analysis (retrieves from database, never saves)
// @access  Public
router.get("/possibilities", async (req, res) => {
  try {
    // Check the database for the requested analysis
    const TournamentAnalysis = require("../models/TournamentAnalysis");
    
    // Get the requested stage from query params
    const requestedStage = req.query.stage;
    
    let dbAnalysis;
    
    if (requestedStage) {
      // If a specific stage is requested (by totalPossibleOutcomes)
      dbAnalysis = await TournamentAnalysis.findOne({
        totalPossibleOutcomes: parseInt(requestedStage)
      }).sort({ timestamp: -1 });
    } else {
      // Otherwise get the most recent analysis
      dbAnalysis = await TournamentAnalysis.findOne()
        .sort({ timestamp: -1 })
        .limit(1);
    }

    if (dbAnalysis) {
      console.log("Using analysis from", dbAnalysis.timestamp, 
                 requestedStage ? "(historical)" : "(current)");
      
      // Sort podiumContenders by podium percentage in descending order
      if (dbAnalysis.podiumContenders && Array.isArray(dbAnalysis.podiumContenders)) {
        dbAnalysis.podiumContenders.sort((a, b) => 
          (b.placePercentages?.podium || 0) - (a.placePercentages?.podium || 0)
        );
      }
      
      return res.json(dbAnalysis);
    }

    // Get current tournament to check if we're at Sweet 16 or beyond
    const TournamentResults = require("../models/TournamentResults");

    const tournament = await TournamentResults.findOne({
      year: new Date().getFullYear(),
    });

    if (!tournament) {
      return res.status(404).json({
        message: "No tournament data found",
        error: true,
      });
    }

    return res.status(404).json({
      message: "No tournament analysis data found",
      error: true,
    });

  } finally {
  }
});

// @route   POST api/tournament/possibilities/generate
// @desc    Force generation of fresh tournament possibilities analysis and save to DB
// @access  Private (admin only)
router.post("/possibilities/generate", [auth, admin], async (req, res) => {
  try {
    console.log(
      "Admin triggered fresh tournament possibilities analysis with database save"
    );

    // Connect to database if not already connected
    let needToCloseConnection = false;
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(process.env.MONGO_URI);
      needToCloseConnection = true;
    }

    let analysisData;
    try {
      // Generate the analysis WITH database saving enabled
      analysisData = await analyzeTournamentPossibilities(true);

      // If analysis returned an error (e.g., too many teams)
      if (analysisData.error) {
        return res.status(400).json({
          success: false,
          message: analysisData.message,
          activeTeamCount: analysisData.activeTeamCount,
        });
      }

      res.json({
        success: true,
        message:
          "Tournament analysis generated and saved to database successfully",
        timestamp: analysisData.timestamp,
        stage: analysisData.stage,
        roundName: analysisData.roundName,
        totalBrackets: analysisData.totalBrackets,
        totalPossibleOutcomes: analysisData.totalPossibleOutcomes,
        roundProgress: analysisData.roundProgress,
      });
    } finally {
      // Close connection if we opened it
      if (needToCloseConnection) {
        await mongoose.connection.close();
      }
    }
  } catch (err) {
    console.error("Error generating tournament possibilities:", err);
    res.status(500).json({
      success: false,
      message: "Error generating tournament analysis",
      error: err.message,
    });
  }
});

// @route   GET api/tournament/podium-contenders
// @desc    Get brackets with podium chances
// @access  Public
router.get("/podium-contenders", async (req, res) => {
  try {
    const TournamentAnalysis = require("../models/TournamentAnalysis");

    // Get the most recent analysis
    const analysis = await TournamentAnalysis.findOne()
      .sort({ timestamp: -1 })
      .limit(1);

    if (!analysis) {
      return res.status(404).json({ message: "No analysis available" });
    }

    // Get sort field and direction from query parameters
    const sortField = req.query.sort || "podium";
    const sortDirection = req.query.dir === "asc" ? 1 : -1;

    // Create a sorted copy of the podium contenders
    let sortedContenders = [...analysis.podiumContenders];

    // Apply sorting
    if (sortField === "name") {
      sortedContenders.sort((a, b) => {
        return (
          sortDirection * a.participantName.localeCompare(b.participantName)
        );
      });
    } else if (sortField === "score") {
      sortedContenders.sort((a, b) => {
        return sortDirection * (a.currentScore - b.currentScore);
      });
    } else if (sortField === "first") {
      sortedContenders.sort((a, b) => {
        return (
          sortDirection * (a.placePercentages["1"] - b.placePercentages["1"])
        );
      });
    } else if (sortField === "second") {
      sortedContenders.sort((a, b) => {
        return (
          sortDirection * (a.placePercentages["2"] - b.placePercentages["2"])
        );
      });
    } else if (sortField === "third") {
      sortedContenders.sort((a, b) => {
        return (
          sortDirection * (a.placePercentages["3"] - b.placePercentages["3"])
        );
      });
    } else {
      // Default: sort by podium chance
      sortedContenders.sort((a, b) => {
        return (
          sortDirection *
          (a.placePercentages.podium - b.placePercentages.podium)
        );
      });
    }

    res.json({
      timestamp: analysis.timestamp,
      stage: analysis.stage,
      roundName: analysis.roundName,
      roundProgress: analysis.roundProgress,
      podiumContenders: sortedContenders,
      playersWithNoPodiumChance: analysis.playersWithNoPodiumChance,
    });
  } catch (err) {
    console.error("Error fetching podium contenders:", err);
    res.status(500).send("Server error");
  }
});

// @route   GET api/tournament/rare-picks
// @desc    Get rare correct picks
// @access  Public
router.get("/rare-picks", async (req, res) => {
  try {
    const TournamentAnalysis = require("../models/TournamentAnalysis");

    // Get the most recent analysis
    const analysis = await TournamentAnalysis.findOne()
      .sort({ timestamp: -1 })
      .limit(1);

    if (!analysis) {
      return res.status(404).json({ message: "No analysis available" });
    }

    res.json({
      timestamp: analysis.timestamp,
      rareCorrectPicks: analysis.rareCorrectPicks || [],
    });
  } catch (err) {
    console.error("Error fetching rare picks:", err);
    res.status(500).send("Server error");
  }
});

// @route   GET api/tournament/path-analysis
// @desc    Get path-specific analysis
// @access  Public
router.get("/path-analysis", async (req, res) => {
  try {
    const TournamentAnalysis = require("../models/TournamentAnalysis");

    // Get the most recent analysis
    const analysis = await TournamentAnalysis.findOne()
      .sort({ timestamp: -1 })
      .limit(1);

    if (!analysis) {
      return res.status(404).json({ message: "No analysis available" });
    }

    res.json({
      timestamp: analysis.timestamp,
      stage: analysis.stage,
      roundName: analysis.roundName,
      pathAnalysis: analysis.pathAnalysis || {},
    });
  } catch (err) {
    console.error("Error fetching path analysis:", err);
    res.status(500).send("Server error");
  }
});

// @route   GET api/tournament/analysis-history
// @desc    Get available historical analysis stages
// @access  Public
router.get("/analysis-history", async (req, res) => {
  try {
    const TournamentAnalysis = require("../models/TournamentAnalysis");

    // Find all distinct stages and timestamps
    // First find all analyses sorted by timestamp
    const allAnalyses = await TournamentAnalysis.find()
      .sort({ timestamp: -1 })
      .select("stage roundName timestamp totalPossibleOutcomes");
      
    // Create a map to track unique totalPossibleOutcomes values
    const uniqueAnalysesMap = new Map();
    
    // Only keep the most recent analysis for each unique totalPossibleOutcomes
    allAnalyses.forEach(analysis => {
      const key = analysis.totalPossibleOutcomes.toString();
      if (!uniqueAnalysesMap.has(key)) {
        uniqueAnalysesMap.set(key, analysis);
      }
    });
    
    // Convert Map to array and format the response
    const analysisHistory = Array.from(uniqueAnalysesMap.values()).map(analysis => {
      // Calculate log base 2 in JavaScript instead of MongoDB
      // This gives us the number of games remaining
      const gamesRemaining = Math.round(Math.log2(analysis.totalPossibleOutcomes));
      
      // Format the date for the label
      const date = new Date(analysis.timestamp);
      const formattedDate = `${date.toLocaleString('default', { month: 'long' })} ${date.getDate()}`;
      
      return {
        value: analysis.totalPossibleOutcomes.toString(),
        label: `${analysis.roundName} (${formattedDate})`,
        gamesRemaining,
        timestamp: analysis.timestamp
      };
    });
    
    // Sort by timestamp descending
    analysisHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({
      success: true,
      stages: analysisHistory
    });
  } catch (err) {
    console.error("Error fetching analysis history:", err);
    res.status(500).json({
      success: false,
      message: "Error fetching analysis history",
      error: err.message
    });
  }
});

module.exports = router;
