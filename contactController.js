const { ContactMessage } = require('../models/Other');

exports.submitContact = async (req, res) => {
  try {
    const { name, email, phone, subject, message } = req.body;
    const msg = await ContactMessage.create({ name, email, phone, subject, message });
    res.status(201).json({ success: true, message: 'Message sent! We will get back to you within 24 hours.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
