const mongoose = require('mongoose');
require('dotenv').config();

const connectToMongoDB = async () => {
  try {
    await mongoose.connect('mongodb://localhost:27017/ncaa_bracket');
    console.log('Connected to MongoDB successfully!');
    
    // Create a simple test model
    const TestSchema = new mongoose.Schema({
      name: String,
      date: { type: Date, default: Date.now }
    });
    
    const Test = mongoose.model('Test', TestSchema);
    
    // Insert a test document
    const testDoc = new Test({ name: 'MongoDB Test' });
    await testDoc.save();
    console.log('Test document created:', testDoc);
    
    // Find and display the document
    const foundDoc = await Test.findOne({ name: 'MongoDB Test' });
    console.log('Found document:', foundDoc);
    
    // Clean up by removing the test document
    await Test.deleteOne({ _id: testDoc._id });
    console.log('Test document deleted');
    
    mongoose.connection.close();
    console.log('MongoDB connection closed');
  } catch (error) {
    console.error('MongoDB connection error:', error);
  }
};

connectToMongoDB();