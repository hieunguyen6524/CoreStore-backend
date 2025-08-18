const Product = require('../models/productModel');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const { getTopProducts } = require('../utils/helper');

exports.getHomeProducts = catchAsync(async (req, res, next) => {
  const [
    topDiscount,
    topPcDiscount,
    topLaptopDiscount,
    topKeyboardDiscount,
    topMouseDiscount,
  ] = await Promise.all([
    // Top 5 discount
    getTopProducts(Product, {
      filter: { discount: { $gt: 0 } },
      select: '_id name price discount thumbnail slug',
    }),
    // Top 5 PC
    getTopProducts(Product, {
      filter: { category: '66ad7c1f2b3e4a001f8b4572', discount: { $gt: 0 } },
      select: '_id name price discount thumbnail slug',
    }),
    // Top 5 laptop
    getTopProducts(Product, {
      filter: { category: '66ad7c1f2b3e4a001f8b4571', discount: { $gt: 0 } },
      select: '_id name price discount thumbnail slug',
    }),
    // Top 5 keyboard
    getTopProducts(Product, {
      filter: { category: '4344a767a53bda40e3ab78ea', discount: { $gt: 0 } },
      select: '_id name price discount thumbnail slug',
    }),
    // Top 5 mouse
    getTopProducts(Product, {
      filter: { category: 'dca8d41ca84cba43b7a86d8a', discount: { $gt: 0 } },
      select: '_id name price discount thumbnail slug',
    }),
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      topDiscount,
      topPcDiscount,
      topLaptopDiscount,
      topKeyboardDiscount,
      topMouseDiscount,
    },
  });
});

exports.getProductBySlug = catchAsync(async (req, res, next) => {
  const product = await Product.findOne({ slug: req.params.slug });
  if (!product) return next(new AppError('This product was not found!', 404));

  res.status(200).json({
    status: 'success',
    data: {
      product,
    },
  });
});
