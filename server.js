const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
require('dotenv').config();

// Create Express app
const app = express();

// Connect to MongoDB
connectDB();

// CORS Configuration with more specific settings
const corsOptions = {
  // Define allowed origins - you can use an array for multiple origins
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  // Allow credentials (cookies, authorization headers)
  credentials: true,
  // Set which headers can be used in the request
  allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token'],
  // How long the results of a preflight request can be cached
  maxAge: 86400 // 24 hours
};

// Apply CORS middleware with options
app.use(cors(corsOptions));

// Parse JSON requests
app.use(express.json({ extended: false }));

// Define routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/brackets', require('./routes/brackets'));
app.use('/api/updates', require('./routes/updates'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/tournament', require('./routes/tournament'));

// NCAA Monitor routes
app.use('/api/admin', require('./routes/ncaaMonitor'));

// Add NCAA tournament scheduler
require('./ncaa-tournament-scheduler')(app);

// Basic route
app.get('/', (req, res) => {
  res.send('NCAA Bracket API is running...');
});

// Port configuration
const PORT = process.env.PORT || 5000;

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});