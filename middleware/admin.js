const User = require('../models/User');

// Middleware to check if user is an admin
module.exports = async function(req, res, next) {
  try {
    // The auth middleware should have already verified the token and set req.user
    if (!req.user) {
      return res.status(401).json({ msg: 'Not authorized' });
    }
    
    // Check if the user has admin role
    if (req.user.role !== 'admin') {
      return res.status(403).json({ msg: 'Admin access required' });
    }
    
    next();
  } catch (err) {
    console.error('Admin middleware error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};