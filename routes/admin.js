const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const User = require('../models/User');
const Bracket = require('../models/Bracket');
const { Parser } = require('json2csv');
const fs = require('fs');
const path = require('path');

// @route   GET api/admin/users
// @desc    Get all users with bracket counts
// @access  Private (admin only)
router.get('/users', [auth, admin], async (req, res) => {
  try {
    // Get all users
    const users = await User.find().sort({ createdAt: -1 });
    
    // Get bracket counts for each user
    const userIds = users.map(user => user._id);
    const bracketCounts = await Bracket.aggregate([
      { $match: { userEmail: { $in: users.map(u => u.email) } } },
      { $group: { _id: '$userEmail', count: { $sum: 1 } } }
    ]);
    
    // Create a map of email to count
    const countsMap = {};
    bracketCounts.forEach(item => {
      countsMap[item._id] = item.count;
    });
    
    // Add bracket count to each user
    const usersWithCounts = users.map(user => {
      const userObj = user.toObject();
      userObj.bracketCount = countsMap[user.email] || 0;
      return userObj;
    });
    
    res.json(usersWithCounts);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   GET api/admin/users/:id
// @desc    Get user by ID
// @access  Private (admin only)
router.get('/users/:id', [auth, admin], async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }
    
    res.json(user);
  } catch (err) {
    console.error(err.message);
    if (err.kind === 'ObjectId') {
      return res.status(404).json({ msg: 'User not found' });
    }
    res.status(500).send('Server error');
  }
});

// @route   GET api/admin/users/:id/brackets
// @desc    Get all brackets for a specific user
// @access  Private (admin only)
router.get('/users/:id/brackets', [auth, admin], async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }
    
    const brackets = await Bracket.find({ userEmail: user.email });
    
    res.json(brackets);
  } catch (err) {
    console.error(err.message);
    if (err.kind === 'ObjectId') {
      return res.status(404).json({ msg: 'User not found' });
    }
    res.status(500).send('Server error');
  }
});

// @route   GET api/admin/brackets
// @desc    Get all brackets
// @access  Private (admin only)
router.get('/brackets', [auth, admin], async (req, res) => {
  try {
    const brackets = await Bracket.find().sort({ createdAt: -1 });
    res.json(brackets);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   GET api/admin/brackets/export/csv
// @desc    Export all brackets as CSV
// @access  Private (admin only)
router.get('/brackets/export/csv', [auth, admin], async (req, res) => {
  try {
    let brackets;
    
    if (req.query.userId) {
      const user = await User.findById(req.query.userId);
      if (!user) {
        return res.status(404).json({ msg: 'User not found' });
      }
      brackets = await Bracket.find({ userEmail: user.email });
    } else {
      brackets = await Bracket.find();
    }
    
    // Prepare data for CSV
    const bracketsForExport = brackets.map(bracket => {
      // Extract champion
      let champion = 'Not selected';
      if (bracket.picks && bracket.picks[6] && bracket.picks[6][0] && bracket.picks[6][0].winner) {
        champion = `${bracket.picks[6][0].winner.name} (${bracket.picks[6][0].winner.seed})`;
      }
      
      // Extract Final Four teams
      let finalFourTeams = [];
      if (bracket.picks && bracket.picks[5]) {
        finalFourTeams = bracket.picks[5]
          .filter(matchup => matchup.winner)
          .map(matchup => `${matchup.winner.name} (${matchup.winner.seed})`)
          .join(', ');
      }
      
      return {
        id: bracket._id,
        participantName: bracket.participantName,
        entryNumber: bracket.entryNumber || 1,
        userEmail: bracket.userEmail,
        contact: bracket.contact || '',
        createdAt: new Date(bracket.createdAt).toLocaleString(),
        isLocked: bracket.isLocked ? 'Yes' : 'No',
        score: bracket.score,
        champion,
        finalFourTeams,
        editLink: `${process.env.FRONTEND_URL}/bracket/edit/${bracket._id}?token=${bracket.editToken}`,
        viewLink: `${process.env.FRONTEND_URL}/bracket/view/${bracket._id}?token=${bracket.editToken}`
      };
    });
    
    // Define fields for the CSV
    const fields = [
      'id',
      'participantName',
      'entryNumber',
      'userEmail',
      'contact',
      'createdAt',
      'isLocked',
      'score',
      'champion',
      'finalFourTeams',
      'editLink',
      'viewLink'
    ];
    
    // Create CSV
    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(bracketsForExport);
    
    // Set headers for CSV download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=brackets.csv');
    
    res.send(csv);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   GET api/admin/brackets/export/json
// @desc    Export all brackets as JSON
// @access  Private (admin only)
router.get('/brackets/export/json', [auth, admin], async (req, res) => {
  try {
    let brackets;
    
    if (req.query.userId) {
      const user = await User.findById(req.query.userId);
      if (!user) {
        return res.status(404).json({ msg: 'User not found' });
      }
      brackets = await Bracket.find({ userEmail: user.email });
    } else {
      brackets = await Bracket.find();
    }
    
    // Set headers for JSON download
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=brackets.json');
    
    res.json(brackets);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   PUT api/admin/brackets/:id/score
// @desc    Update a bracket's score
// @access  Private (admin only)
router.put('/brackets/:id/score', [auth, admin], async (req, res) => {
  const { score } = req.body;
  
  if (score === undefined || isNaN(score)) {
    return res.status(400).json({ msg: 'Valid score is required' });
  }
  
  try {
    const bracket = await Bracket.findById(req.params.id);
    
    if (!bracket) {
      return res.status(404).json({ msg: 'Bracket not found' });
    }
    
    bracket.score = score;
    await bracket.save();
    
    res.json(bracket);
  } catch (err) {
    console.error(err.message);
    if (err.kind === 'ObjectId') {
      return res.status(404).json({ msg: 'Bracket not found' });
    }
    res.status(500).send('Server error');
  }
});

module.exports = router;