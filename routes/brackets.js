const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const Bracket = require('../models/Bracket');
const User = require('../models/User');
const { sendBracketConfirmation } = require('../utils/email');

// @route   POST api/brackets
// @desc    Create a new bracket
// @access  Public
router.post('/', async (req, res) => {
  const { userEmail, participantName, contact, picks } = req.body;

  try {
    // Create unique edit token
    const editToken = uuidv4();

    // Calculate the entry number by counting existing entries with the same name and email
    const firstName = participantName.split(' ')[0] || '';
    const lastName = participantName.split(' ').slice(1).join(' ') || '';
    
    // Count existing brackets with the same name and email
    const existingBrackets = await Bracket.find({ 
      userEmail: userEmail,
      participantName: participantName
    }).sort({ entryNumber: 1 });
    
    // Calculate the next entry number
    const entryNumber = existingBrackets.length > 0 ? existingBrackets.length + 1 : 1;

    const newBracket = new Bracket({
      userEmail,
      participantName,
      contact,
      editToken,
      entryNumber,
      picks,
      score: 0,
      isLocked: false
    });

    const bracket = await newBracket.save();
    
    // Get user data to include userToken in email
    const user = await User.findOne({ email: userEmail });
    const userToken = user ? user.userToken : null;
    
    // Send confirmation email
    try {
      const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      await sendBracketConfirmation(userEmail, {
        bracketId: bracket._id,
        editToken: bracket.editToken,
        participantName: bracket.participantName,
        userToken,
        entryNumber: bracket.entryNumber,
        totalEntries: entryNumber
      }, baseUrl);
    } catch (emailError) {
      console.error('Error sending confirmation email:', emailError);
      // Don't fail the request if email sending fails
    }
    
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

    // Count total entries for this user with same name
    const totalEntries = await Bracket.countDocuments({
      userEmail: bracket.userEmail,
      participantName: bracket.participantName
    });

    // Add totalEntries to the response
    const bracketResponse = bracket.toObject();
    bracketResponse.totalEntries = totalEntries;
    
    res.json(bracketResponse);
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
    
    // Count total entries for this user with same name
    const totalEntries = await Bracket.countDocuments({
      userEmail: bracket.userEmail,
      participantName: bracket.participantName
    });

    // Add totalEntries to the response
    const bracketResponse = bracket.toObject();
    bracketResponse.totalEntries = totalEntries;
    
    res.json(bracketResponse);
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

router.get('/user/:email', async (req, res) => {
    const { email } = req.params;
    const { userToken } = req.query;
    
    if (!email || !userToken) {
      return res.status(400).json({ msg: 'Email and userToken are required' });
    }
    
    try {
      // Verify the userToken belongs to this user
      const user = await User.findOne({ email });
      
      if (!user) {
        return res.status(404).json({ msg: 'User not found' });
      }
      
      if (user.userToken !== userToken) {
        return res.status(401).json({ msg: 'Invalid user token' });
      }
      
      // Get all brackets for this email
      const brackets = await Bracket.find({ userEmail: email });
      
      // Enhance bracket data with participant entry counts
      const enhancedBrackets = [];
      const participantCounts = {};
      
      // First pass: count entries per participant
      for (const bracket of brackets) {
        const participantName = bracket.participantName;
        if (!participantCounts[participantName]) {
          participantCounts[participantName] = 1;
        } else {
          participantCounts[participantName]++;
        }
      }
      
      // Second pass: enhance brackets with total entries
      for (const bracket of brackets) {
        const bracketObj = bracket.toObject();
        bracketObj.totalEntries = participantCounts[bracket.participantName];
        enhancedBrackets.push(bracketObj);
      }
      
      res.json(enhancedBrackets);
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Server error');
    }
  });

module.exports = router;