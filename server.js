const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
require('dotenv').config();

// Create Express app
const app = express();

// Connect to MongoDB
connectDB();

// Middleware
app.use(cors());
app.use(express.json({ extended: false }));

// Define routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/brackets', require('./routes/brackets'));
app.use('/api/updates', require('./routes/updates'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/tournament', require('./routes/tournament'));

// NCAA Monitor routes (add these)
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