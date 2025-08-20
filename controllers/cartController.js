const User = require('../models/userModel');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');

exports.getUserCart = catchAsync(async (req, res, next) => {
  const { cart } = await User.findById(req.user.id);

  if (!cart) return next(new AppError('Cart is empty', 404));

  res.status(200).json({
    status: 'success',
    data: {
      cart,
    },
  });
});

exports.addCart = catchAsync(async (req, res, next) => {
  const { product, quantity } = req.body;
  const user = await User.findById(req.user.id);

  if (!user) return next(new AppError('User not found', 404));

  const productIndex = user.cart.findIndex(
    (item) => item.product.id === product,
  );

  if (productIndex > -1) {
    user.cart[productIndex].quantity += 1;
  } else {
    user.cart.push({ product, quantity });
  }

  await user.save({ validateBeforeSave: false });
  // await user.populate('cart.product');

  res.status(200).json({
    status: 'success',
    cart: user.cart,
  });
});

exports.deleteCartItem = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id);

  if (!user) return next(new AppError('User not found', 404));

  user.cart = user.cart.filter((item) => item._id.toString() !== req.params.id);

  await user.save({ validateBeforeSave: false });

  res.status(200).json({
    status: 'success',
    data: null,
  });
});

exports.updateItemQuantity = catchAsync(async (req, res, next) => {
  const newQuantity = Number(req.body.quantity);
  if (Number.isNaN(newQuantity) || newQuantity < 1) {
    return next(new AppError('Quantity must be a positive number', 400));
  }

  const user = await User.findOneAndUpdate(
    { _id: req.user.id, 'cart._id': req.params.id },
    { $set: { 'cart.$.quantity': newQuantity } },
    { new: true, runValidators: true },
  );

  if (!user) return next(new AppError('User or cart item not found', 404));

  res.status(200).json({
    status: 'success',
    data: {
      cart: user.cart,
    },
  });
});
