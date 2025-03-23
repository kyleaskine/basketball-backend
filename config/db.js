const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    // Only connect if not already connected
    if (mongoose.connection.readyState === 0) {
      const conn = await mongoose.connect(process.env.MONGO_URI, {
        // These options ensure the connection is reliable
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000
        // Note: autoReconnect and maxPoolSize are no longer needed in newer versions of mongoose
      });

      console.log(`MongoDB Connected: ${conn.connection.host}`);
      
      // Set up event handlers to detect and handle connection issues
      mongoose.connection.on('disconnected', () => {
        console.log('MongoDB disconnected! Attempting to reconnect...');
      });
      
      mongoose.connection.on('error', (err) => {
        console.error('MongoDB connection error:', err);
      });
      
      mongoose.connection.on('reconnected', () => {
        console.log('MongoDB reconnected successfully');
      });
    } else {
      console.log('MongoDB already connected, reusing existing connection');
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
};

// Add a utility function to check connection status
const isConnected = () => {
  return mongoose.connection.readyState === 1;
};

// Add a function to safely close the connection when needed
// (but this should really only be used when the application is shutting down)
const disconnectDB = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    console.log('MongoDB disconnected safely');
  }
};

// For backward compatibility
module.exports = connectDB;

// Also export the object with all functions
module.exports.connectDB = connectDB;
module.exports.isConnected = isConnected;
module.exports.disconnectDB = disconnectDB;