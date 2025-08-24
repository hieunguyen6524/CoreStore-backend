const Product = require('../models/productModel');
const Category = require('../models/categoryModel');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');

const factoryController = require('./factoryController');

exports.getAllProduct = factoryController.getAll(Product);
exports.getProduct = factoryController.getOne(Product);
exports.createProduct = factoryController.createOne(Product);
exports.updateProduct = factoryController.updateOne(Product);
exports.deleteProduct = factoryController.deleteOne(Product);

exports.getProductsByCategory = catchAsync(async (req, res, next) => {
  const { slug } = req.params;
  const category = await Category.findOne({ slug });

  if (!category) {
    return next(new AppError('No category found with that slug', 404));
  }

  const products = await Product.find({ category: category._id });

  if (!products || products.length === 0) {
    return next(new AppError('No products found with that category', 404));
  }

  res.status(200).json({
    status: 'success',
    results: products.length,
    data: {
      products,
    },
  });
});
