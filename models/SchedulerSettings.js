const mongoose = require('mongoose');

const SchedulerSettingsSchema = new mongoose.Schema({
  enabled: {
    type: Boolean,
    default: true
  },
  nextRunTime: {
    type: Date,
    default: null
  },
  autoDisabled: {
    type: Boolean,
    default: false
  },
  disabledReason: {
    type: String,
    default: null
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('SchedulerSettings', SchedulerSettingsSchema);