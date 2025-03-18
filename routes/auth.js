const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const auth = require('../middleware/auth');
const User = require('../models/User');

// @route   POST api/auth/login
// @desc    Login user & get token
// @access  Public
router.post('/login', async (req, res) => {
  const { email } = req.body;

  try {
    let user = await User.findOne({ email });

    if (!user) {
      // Create new user with magic link token
      const authToken = uuidv4();
      
      user = new User({
        email,
        authToken,
        lastLoginAt: Date.now()
      });

      await user.save();
    } else {
      // Update existing user's token
      user.authToken = uuidv4();
      user.lastLoginAt = Date.now();
      await user.save();
    }

    // Here you'd normally send the magic link via email
    // For development, we'll just return it in the response
    
    res.json({ 
      message: 'Magic link created',
      magicLink: `http://localhost:3000/auth/verify?token=${user.authToken}&email=${email}`,
      // In production, remove the token from the response
      token: user.authToken
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   GET api/auth/verify
// @desc    Verify magic link token
// @access  Public
router.get('/verify', async (req, res) => {
  const { token, email } = req.query;

  try {
    const user = await User.findOne({ email, authToken: token });

    if (!user) {
      return res.status(400).json({ msg: 'Invalid token' });
    }

    // Create JWT token
    const payload = {
      user: {
        id: user.id,
        email: user.email
      }
    };

    jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: '7d' },
      (err, jwtToken) => {
        if (err) throw err;
        res.json({ token: jwtToken });
      }
    );
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   GET api/auth/me
// @desc    Get current user
// @access  Private
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-authToken');
    res.json(user);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

module.exports = router;