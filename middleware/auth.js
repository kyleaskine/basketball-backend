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
    // TEMPORARY: Try to find user by userToken instead of verifying JWT
    const user = await User.findOne({ userToken: token });
    
    if (user) {
      req.user = user;
      return next();
    }
    
    // Original JWT verification as fallback
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    user = await User.findById(decoded.user.id);
    
    if (!user) {
      return res.status(401).json({ msg: 'User not found' });
    }
    
    req.user = user;
    next();
  } catch (err) {
    console.error('Auth error:', err);
    res.status(401).json({ msg: 'Token is not valid' });
  }
};