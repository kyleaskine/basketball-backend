const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const Update = require('../models/Update');

// @route   GET api/updates
// @desc    Get active updates for public display
// @access  Public
router.get('/', async (req, res) => {
  try {
    const updates = await Update.find({
      activeUntil: { $gte: new Date() }
    })
    .sort({ importance: -1, createdAt: -1 })
    .limit(10); // Limit to 10 most recent/important updates
    
    res.json(updates);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   GET api/updates/all
// @desc    Get all updates (including inactive) for admin management
// @access  Private (admin only)
router.get('/all', [auth, admin], async (req, res) => {
  try {
    const updates = await Update.find()
      .sort({ createdAt: -1 });
    
    res.json(updates);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   POST api/updates
// @desc    Create a new update
// @access  Private (admin only)
router.post('/', [auth, admin], async (req, res) => {
  const { title, content, type, importance, activeUntil } = req.body;

  try {
    const newUpdate = new Update({
      title,
      content,
      type: type || 'news',
      importance: importance || 0,
      activeUntil: activeUntil || undefined
    });

    const update = await newUpdate.save();
    res.json(update);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   GET api/updates/:id
// @desc    Get an update by ID
// @access  Private (admin only)
router.get('/:id', [auth, admin], async (req, res) => {
  try {
    const update = await Update.findById(req.params.id);
    
    if (!update) {
      return res.status(404).json({ msg: 'Update not found' });
    }

    res.json(update);
  } catch (err) {
    console.error(err.message);
    if (err.kind === 'ObjectId') {
      return res.status(404).json({ msg: 'Update not found' });
    }
    res.status(500).send('Server error');
  }
});

// @route   PUT api/updates/:id
// @desc    Update an existing update
// @access  Private (admin only)
router.put('/:id', [auth, admin], async (req, res) => {
  const { title, content, type, importance, activeUntil } = req.body;

  try {
    const update = await Update.findById(req.params.id);
    
    if (!update) {
      return res.status(404).json({ msg: 'Update not found' });
    }

    // Update fields if provided
    if (title) update.title = title;
    if (content) update.content = content;
    if (type) update.type = type;
    if (importance !== undefined) update.importance = importance;
    if (activeUntil) update.activeUntil = activeUntil;
    
    update.updatedAt = Date.now();

    await update.save();
    res.json(update);
  } catch (err) {
    console.error(err.message);
    if (err.kind === 'ObjectId') {
      return res.status(404).json({ msg: 'Update not found' });
    }
    res.status(500).send('Server error');
  }
});

// @route   DELETE api/updates/:id
// @desc    Delete an update
// @access  Private (admin only)
router.delete('/:id', [auth, admin], async (req, res) => {
  try {
    const update = await Update.findById(req.params.id);
    
    if (!update) {
      return res.status(404).json({ msg: 'Update not found' });
    }

    await update.remove();
    res.json({ msg: 'Update removed' });
  } catch (err) {
    console.error(err.message);
    if (err.kind === 'ObjectId') {
      return res.status(404).json({ msg: 'Update not found' });
    }
    res.status(500).send('Server error');
  }
});

module.exports = router;