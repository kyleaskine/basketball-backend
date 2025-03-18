const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const Bracket = require('../models/Bracket');
const User = require('../models/User');

// @route   POST api/brackets
// @desc    Create a new bracket
// @access  Public
router.post('/', async (req, res) => {
  const { userEmail, participantName, contact, picks } = req.body;

  try {
    // Create unique edit token
    const editToken = uuidv4();

    const newBracket = new Bracket({
      userEmail,
      participantName,
      contact,
      editToken,
      picks,
      score: 0,
      isLocked: false
    });

    const bracket = await newBracket.save();
    res.json(bracket);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   GET api/brackets
// @desc    Get all brackets for the authenticated user
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const brackets = await Bracket.find({ userEmail: req.user.email });
    res.json(brackets);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   GET api/brackets/:id
// @desc    Get bracket by ID
// @access  Public (with edit token)
router.get('/:id', async (req, res) => {
  try {
    const bracket = await Bracket.findById(req.params.id);
    
    if (!bracket) {
      return res.status(404).json({ msg: 'Bracket not found' });
    }

    // If edit token is provided, verify it
    const { editToken } = req.query;
    const isAdmin = req.headers['x-auth-token'] ? true : false;
    
    if (!isAdmin && (!editToken || editToken !== bracket.editToken)) {
      return res.status(401).json({ msg: 'Not authorized to view this bracket' });
    }

    res.json(bracket);
  } catch (err) {
    console.error(err.message);
    if (err.kind === 'ObjectId') {
      return res.status(404).json({ msg: 'Bracket not found' });
    }
    res.status(500).send('Server error');
  }
});

// @route   PUT api/brackets/:id
// @desc    Update a bracket
// @access  Public (with edit token)
router.put('/:id', async (req, res) => {
  const { userEmail, participantName, contact, picks, editToken } = req.body;

  try {
    let bracket = await Bracket.findById(req.params.id);
    
    if (!bracket) {
      return res.status(404).json({ msg: 'Bracket not found' });
    }

    // Verify edit token or admin access
    const isAdmin = req.headers['x-auth-token'] ? true : false;
    
    if (!isAdmin && (!editToken || editToken !== bracket.editToken)) {
      return res.status(401).json({ msg: 'Not authorized to update this bracket' });
    }

    // Check if bracket is locked (tournament started)
    if (bracket.isLocked) {
      return res.status(400).json({ msg: 'Cannot update bracket after tournament has started' });
    }

    // Update bracket fields
    if (userEmail) bracket.userEmail = userEmail;
    if (participantName) bracket.participantName = participantName;
    if (contact) bracket.contact = contact;
    if (picks) bracket.picks = picks;

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

// @route   DELETE api/brackets/:id
// @desc    Delete a bracket
// @access  Private (admin only)
router.delete('/:id', auth, async (req, res) => {
  try {
    const bracket = await Bracket.findById(req.params.id);
    
    if (!bracket) {
      return res.status(404).json({ msg: 'Bracket not found' });
    }

    // Check if the user is the owner of this bracket
    if (bracket.userEmail !== req.user.email) {
      return res.status(401).json({ msg: 'Not authorized to delete this bracket' });
    }

    await bracket.remove();
    res.json({ msg: 'Bracket removed' });
  } catch (err) {
    console.error(err.message);
    if (err.kind === 'ObjectId') {
      return res.status(404).json({ msg: 'Bracket not found' });
    }
    res.status(500).send('Server error');
  }
});

// @route   POST api/brackets/lock
// @desc    Lock all brackets (when tournament starts)
// @access  Private (admin only)
router.post('/lock', auth, async (req, res) => {
  try {
    await Bracket.updateMany({}, { isLocked: true });
    res.json({ msg: 'All brackets locked' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   PUT api/brackets/:id/score
// @desc    Update bracket score
// @access  Private (admin only)
router.put('/:id/score', auth, async (req, res) => {
  const { score } = req.body;

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