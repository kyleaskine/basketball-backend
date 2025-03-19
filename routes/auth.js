const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const User = require('../models/User');
const { sendMagicLink } = require('../utils/email');

// @route   POST api/auth/login
// @desc    Login user & get token
// @access  Public
router.post('/login', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ msg: 'Email is required' });
  }

  try {
    let user = await User.findOne({ email });

    if (!user) {
      // Create new user with magic link token
      const authToken = uuidv4();
      const userToken = uuidv4();
      
      user = new User({
        email,
        authToken,
        userToken,
        lastLoginAt: Date.now()
      });

      await user.save();
    } else {
      // Update existing user's token
      user.authToken = uuidv4();
      user.lastLoginAt = Date.now();
      
      // Make sure user has a userToken (for older users)
      if (!user.userToken) {
        user.userToken = uuidv4();
      }
      
      await user.save();
    }

    // Send magic link email
    // Get base URL from request or env variable
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    
    try {
      await sendMagicLink(email, user.authToken, baseUrl);
      
      // For development, we can still return the token in response
      if (process.env.NODE_ENV === 'development') {
        return res.json({ 
          message: 'Magic link sent successfully',
          success: true,
          magicLink: `${baseUrl}/auth/verify?token=${user.authToken}&email=${encodeURIComponent(email)}`,
          token: user.authToken
        });
      }
      
      res.json({ 
        message: 'Magic link sent successfully',
        success: true
      });
    } catch (emailError) {
      console.error('Email sending error:', emailError);
      res.status(500).json({ 
        msg: 'Error sending magic link email. Please try again.',
        success: false
      });
    }
  } catch (err) {
    console.error('Auth error:', err.message);
    res.status(500).send('Server error');
  }
});

// @route   GET api/auth/verify
// @desc    Verify magic link token
// @access  Public
router.get('/verify', async (req, res) => {
  const { token, email } = req.query;

  if (!token || !email) {
    return res.status(400).json({ msg: 'Token and email are required' });
  }

  try {
    const user = await User.findOne({ email, authToken: token });

    if (!user) {
      return res.status(400).json({ msg: 'Invalid token' });
    }

    // Create JWT token
    const payload = {
      user: {
        id: user.id,
        email: user.email,
        role: user.role || 'user'
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

// @route   GET api/auth/is-admin
// @desc    Check if current user is an admin
// @access  Private
router.get('/is-admin', auth, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    res.json({ isAdmin });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   POST api/auth/make-admin
// @desc    Make a user an admin (only admins can do this)
// @access  Private (admin only)
router.post('/make-admin', [auth, admin], async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ msg: 'Email is required' });
  }
  
  try {
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }
    
    // Set user role to admin
    user.role = 'admin';
    await user.save();
    
    res.json({ msg: 'User promoted to admin' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   POST api/auth/check-create
// @desc    Check if user exists and create if not
// @access  Public
router.post('/check-create', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ msg: 'Email is required' });
  }

  try {
    let user = await User.findOne({ email });
    let isNewUser = false;

    if (!user) {
      // Create new user with a user token
      const userToken = uuidv4();
      
      user = new User({
        email,
        authToken: uuidv4(), // Auth token for login
        userToken, // User token for accessing brackets
        lastLoginAt: Date.now()
      });

      await user.save();
      isNewUser = true;
    }

    // Make sure user has a userToken (older users might not have one)
    if (!user.userToken) {
      user.userToken = uuidv4();
      await user.save();
    }
    
    // Create JWT token for automatic login
    const payload = {
      user: {
        id: user.id,
        email: user.email,
        role: user.role || 'user'
      }
    };

    // Sign and return JWT token
    const jwtToken = jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({ 
      token: user.userToken,
      jwtToken, // Add JWT token to response
      isNewUser
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   POST api/auth/refresh
// @desc    Refresh JWT token
// @access  Private
router.post('/refresh', auth, async (req, res) => {
  try {
    // Get fresh user data
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }
    
    // Update last login time
    user.lastLoginAt = Date.now();
    await user.save();
    
    // Create new JWT payload
    const payload = {
      user: {
        id: user.id,
        email: user.email,
        role: user.role || 'user'
      }
    };

    // Sign and return new JWT token
    const token = jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({ token });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

module.exports = router;