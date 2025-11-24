const mongoose = require('mongoose');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const { invalidateProductCache } = require('../utils/redisClient');

const getDb = () => mongoose.connection.db;
const toObjectId = (id) => {
  if (mongoose.Types.ObjectId.isValid(id)) {
    return new mongoose.Types.ObjectId(id);
  }
  throw new AppError('Invalid ID format', 400);
};

exports.submitReview = catchAsync(async (req, res, next) => {
  const db = getDb();
  const reviewsCollection = db.collection('reviews');
  const ordersCollection = db.collection('orders');
  const productsCollection = db.collection('products');

  const userId = toObjectId(req.user.id);
  const productId = toObjectId(req.params.productId || req.body.productId);
  const rating = Number(req.body.rating);
  const comment = req.body.comment ? req.body.comment.trim() : '';

  if (!rating || Number.isNaN(rating)) {
    return next(new AppError('Rating is required and must be a number', 400));
  }

  if (rating < 1 || rating > 5) {
    return next(new AppError('Rating must be between 1 and 5', 400));
  }

  // Ensure product exists
  const product = await productsCollection.findOne({ _id: productId });
  if (!product) {
    return next(new AppError('Product not found', 404));
  }

  // Ensure the user purchased the product
  const purchase = await ordersCollection.findOne({
    user: userId,
    status: { $in: ['paid', 'delivered'] },
    'items.product': productId,
  });

  if (!purchase) {
    return next(
      new AppError('You can only review products you have purchased', 403),
    );
  }

  // Upsert review (one review per user per product)
  const reviewDoc = {
    product: productId,
    user: userId,
    rating,
    comment,
    updatedAt: new Date(),
  };

  const reviewResult = await reviewsCollection.findOneAndUpdate(
    { product: productId, user: userId },
    {
      $set: reviewDoc,
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true, returnDocument: 'after' },
  );

  // Recalculate rating stats using aggregation
  const stats = await reviewsCollection
    .aggregate([
      { $match: { product: productId } },
      {
        $group: {
          _id: '$product',
          avgRating: { $avg: '$rating' },
          ratingCount: { $sum: 1 },
        },
      },
    ])
    .toArray();

  const ratingStats = stats[0] || { avgRating: 4.5, ratingCount: 1 };

  await productsCollection.updateOne(
    { _id: productId },
    {
      $set: {
        ratingsAvergage: Math.round(ratingStats.avgRating * 10) / 10,
        ratingsQuantity: ratingStats.ratingCount,
        updatedAt: new Date(),
      },
    },
  );

  if (invalidateProductCache) {
    await invalidateProductCache();
  }

  res.status(201).json({
    status: 'success',
    data: {
      review: reviewResult.value,
      ratings: {
        average: Math.round(ratingStats.avgRating * 10) / 10,
        quantity: ratingStats.ratingCount,
      },
    },
  });
});
