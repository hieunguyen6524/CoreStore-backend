const Order = require('../models/orderModel');
const User = require('../models/userModel');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');

exports.checkout = catchAsync(async (req, res, next) => {
  const { cart } = await User.findById(req.user.id);

  if (!cart || cart.length === 0)
    return next(new AppError('This cart is empty', 400));

  const invalidItem = cart.find((item) => item.quantity > item.product.stock);

  if (invalidItem)
    return next(
      new AppError(
        `The product "${invalidItem.product.name}" only has ${invalidItem.product.stock} in stock`,
        400,
      ),
    );

  const total = cart.reduce(
    (sum, item) =>
      sum +
      item.quantity *
        Math.round(item.product.price * (1 - item.product.discount / 100)),
    0,
  );

  const order = await Order.create({
    user: req.user.id,
    items: cart.map((item) => ({
      product: item.product._id,
      quantity: item.quantity,
      price: Math.round(item.product.price * (1 - item.product.discount / 100)), // integer VNĐ
    })),
    total: Math.round(total), // integer VNĐ
    paymentId: `DH${Date.now()}`,
  });

  const qrUrl = `https://qr.sepay.vn/img?acc=${process.env.BANK_ACCOUNT}&bank=${process.env.BANK}&amount=${order.total}&des=${order.paymentId}`;

  res.status(200).json({
    status: 'success',
    data: {
      order,
      qrUrl,
    },
  });
});

exports.sepayWebhook = catchAsync(async (req, res, next) => {
  const { content, transferType, transferAmount } = req.body;

  const authHeader = req.headers.authorization;
  if (authHeader !== process.env.SEPAY_API_KEY) {
    return next(new AppError('API KEY not correct', 400));
  }

  const order = await Order.findOne({ paymentId: content.trim() });
  if (!order || order.status !== 'pending') {
    return next(new AppError('Order not found or already processed', 404));
  }

  if (transferType !== 'in') {
    return next(new AppError('Invalid transfer type', 400));
  }

  if (Number(order.total) !== Number(transferAmount)) {
    return next(new AppError('Amount mismatch', 400));
  }

  order.status = 'paid';
  await order.save();

  // Lưu transaction log
  // await Transaction.create({
  //   order: order._id,
  //   amount: Number(transferAmount),
  //   type: transferType,
  //   raw: req.body,
  // });

  res.status(200).json({ status: 'success' });
});
