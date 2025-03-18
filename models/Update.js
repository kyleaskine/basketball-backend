const mongoose = require('mongoose');

const UpdateSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  content: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['news', 'announcement', 'reminder'],
    default: 'news'
  },
  importance: {
    type: Number,
    default: 0,  // Higher number = more important
    min: 0,
    max: 10
  },
  activeUntil: {
    type: Date,
    default: () => new Date(new Date().setFullYear(new Date().getFullYear() + 1)) // Default 1 year
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Update', UpdateSchema);