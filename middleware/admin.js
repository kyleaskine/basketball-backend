const jwt = require('jsonwebtoken');
const User = require('../models/User');

module.exports = async function(req, res, next) {
  // Get token from header
  const token = req.header('x-auth-token');

  // Check if no token
  if (!token) {
    return res.status(401).json({ msg: 'No token, authorization denied' });
  }

  try {
    // First try JWT verification
    let userData;
    let user;
    
    try {
      // Verify token with JWT
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userData = decoded.user;
      
      // Find the user by id from JWT
      user = await User.findById(userData.id);
    } catch (jwtError) {
      // If JWT verification fails, try finding by userToken
      // This is our fallback for development or if using the userToken directly
      user = await User.findOne({ userToken: token });
      
      if (!user) {
        // If we still can't find a user, throw original error
        throw jwtError;
      }
    }
    
    // If user not found
    if (!user) {
      return res.status(401).json({ msg: 'User not found' });
    }
    
    // Set user data on request
    req.user = user;
    next();
  } catch (err) {
    console.error('Auth error:', err);
    res.status(401).json({ msg: 'Token is not valid' });
  }
};