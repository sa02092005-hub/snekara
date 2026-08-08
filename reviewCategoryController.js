const { Review } = require('../models/Other');
const Product = require('../models/Product');
const Category = require('../models/Category');

// ─── Review Controller ────────────────────────────────────────────────────────
exports.createReview = async (req, res) => {
  try {
    const { productId, rating, title, comment } = req.body;
    const existing = await Review.findOne({ user: req.user._id, product: productId });
    if (existing) return res.status(400).json({ success: false, message: 'You already reviewed this product.' });

    const review = await Review.create({ user: req.user._id, product: productId, rating, title, comment });

    // Recalculate average rating
    const stats = await Review.aggregate([{ $match: { product: review.product, isApproved: true } }, { $group: { _id: null, avgRating: { $avg: '$rating' }, count: { $sum: 1 } } }]);
    if (stats.length > 0) {
      await Product.findByIdAndUpdate(productId, { averageRating: Math.round(stats[0].avgRating * 10) / 10, numReviews: stats[0].count });
    }

    res.status(201).json({ success: true, message: 'Review submitted for approval.', review });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.approveReview = async (req, res) => {
  try {
    const review = await Review.findByIdAndUpdate(req.params.id, { isApproved: true }, { new: true });
    // Recalculate
    const stats = await Review.aggregate([{ $match: { product: review.product, isApproved: true } }, { $group: { _id: null, avgRating: { $avg: '$rating' }, count: { $sum: 1 } } }]);
    if (stats.length > 0) {
      await Product.findByIdAndUpdate(review.product, { averageRating: Math.round(stats[0].avgRating * 10) / 10, numReviews: stats[0].count });
    }
    res.json({ success: true, review });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getAllReviews = async (req, res) => {
  try {
    const reviews = await Review.find().populate('user', 'name').populate('product', 'name').sort({ createdAt: -1 });
    res.json({ success: true, reviews });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Category Controller ──────────────────────────────────────────────────────
exports.getCategories = async (req, res) => {
  try {
    const { type } = req.query;
    const query = { isActive: true };
    if (type) query.type = type;
    const categories = await Category.find(query).sort({ sortOrder: 1 });
    res.json({ success: true, categories });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.createCategory = async (req, res) => {
  try {
    const category = await Category.create(req.body);
    res.status(201).json({ success: true, category });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

exports.updateCategory = async (req, res) => {
  try {
    const category = await Category.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, category });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

exports.deleteCategory = async (req, res) => {
  try {
    await Category.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ success: true, message: 'Category removed.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
