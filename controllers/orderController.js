const mongoose = require('mongoose');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');

// Helper function to get MongoDB database instance
const getDb = () => mongoose.connection.db;

// Helper function to convert ObjectId string to ObjectId
const toObjectId = (id) => {
  if (mongoose.Types.ObjectId.isValid(id)) {
    return new mongoose.Types.ObjectId(id);
  }
  throw new AppError('Invalid ID format', 400);
};

exports.checkout = catchAsync(async (req, res, next) => {
  const db = getDb();
  const usersCollection = db.collection('users');
  const ordersCollection = db.collection('orders');
  const productsCollection = db.collection('products');

  const userId = toObjectId(req.user.id);

  // 1. Lấy user với cart
  const user = await usersCollection.findOne(
    { _id: userId },
    { projection: { cart: 1 } },
  );

  if (!user || !user.cart || user.cart.length === 0) {
    return next(new AppError('This cart is empty', 400));
  }

  // 2. Populate products trong cart
  const productIds = user.cart.map((item) => toObjectId(item.product));
  const products = await productsCollection
    .find({ _id: { $in: productIds } })
    .toArray();

  // 3. Tạo map để truy cập product nhanh
  const productMap = {};
  products.forEach((product) => {
    productMap[product._id.toString()] = product;
  });

  // 4. Validate cart items và tính tổng tiền
  // Validate tất cả products tồn tại
  const missingProduct = user.cart.find((item) => {
    const productId = item.product.toString();
    return !productMap[productId];
  });

  if (missingProduct) {
    return next(new AppError('One or more products no longer exist', 400));
  }

  let total = 0;
  const orderItems = user.cart.map((item) => {
    const product = productMap[item.product.toString()];
    const priceAfterDiscount = product.price * (1 - product.discount / 100);
    const itemTotal = priceAfterDiscount * item.quantity;
    total += itemTotal;

    return {
      product: item.product,
      quantity: item.quantity,
      price: priceAfterDiscount,
    };
  });

  // 5. Tạo order
  const order = {
    user: userId,
    items: orderItems,
    total: Math.round(total),
    status: 'pending',
    paymentId: `DH${Date.now()}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const result = await ordersCollection.insertOne(order);

  // 6. Xóa cart của user
  await usersCollection.updateOne(
    { _id: userId },
    { $set: { cart: [], updatedAt: new Date() } },
  );

  // 7. Populate order với product data để trả về
  const createdOrder = await ordersCollection.findOne({
    _id: result.insertedId,
  });

  // 8. Tạo QR code URL cho SePay
  const accountNumber = process.env.BANK_ACCOUNT;
  const bankCode = process.env.BANK;
  const amount = createdOrder.total;
  const content = createdOrder.paymentId;

  const qrUrl = `https://qr.sepay.vn/img?acc=${accountNumber}&bank=${bankCode}&amount=${amount}&des=${encodeURIComponent(content)}`;

  res.status(201).json({
    status: 'success',
    data: {
      order: createdOrder,
      qrUrl,
      bankAccount: accountNumber,
      bankCode,
    },
  });
});

exports.sepayWebhook = catchAsync(async (req, res, next) => {
  const db = getDb();
  const ordersCollection = db.collection('orders');

  // SePay webhook payload format:
  // {
  //   "gateway": "MBBank",
  //   "transactionDate": "2025-08-26 07:21:21",
  //   "accountNumber": "0789745259",
  //   "code": "DH1763879919407",
  //   "content": "DH1763879919407",
  //   "transferType": "in",
  //   "transferAmount": 3000,
  //   ...
  // }

  const { code, transferAmount, transferType } = req.body;

  if (!code || !transferAmount) {
    return next(new AppError('Missing payment code or amount', 400));
  }

  // Chỉ xử lý giao dịch chuyển vào (in)
  if (transferType !== 'in') {
    return res.status(200).json({
      status: 'success',
      message: 'Ignored non-incoming transaction',
    });
  }

  // Tìm order theo paymentId (code từ SePay)
  const order = await ordersCollection.findOne({ paymentId: code });

  if (!order) {
    return next(new AppError('Order not found with this payment code', 404));
  }

  // Kiểm tra số tiền có khớp không
  if (order.total !== transferAmount) {
    return next(
      new AppError(
        `Amount mismatch: expected ${order.total}, received ${transferAmount}`,
        400,
      ),
    );
  }

  // Cập nhật trạng thái đơn hàng thành 'paid'
  const result = await ordersCollection.findOneAndUpdate(
    { _id: order._id },
    {
      $set: {
        status: 'paid',
        updatedAt: new Date(),
      },
    },
    { returnDocument: 'after' },
  );

  // Emit socket event để thông báo cho frontend
  const io = req.app.get('io');
  if (io) {
    io.to(`order:${order._id.toString()}`).emit('orderPaid', {
      orderId: order._id.toString(),
      status: 'paid',
    });
  }

  res.status(200).json({
    status: 'success',
    data: {
      order: result.value,
    },
  });
});

/**
 * Get orders by user
 * Sử dụng MongoDB native queries với aggregation pipeline
 * Độ phức tạp: ⭐⭐⭐⭐ (4/5)
 * - Sử dụng aggregation pipeline phức tạp với $unwind, $lookup, $group
 * - Populate nested data (products, brands, categories) trong items array
 * - Hỗ trợ filtering, sorting, pagination
 */
exports.getOrdersByUser = catchAsync(async (req, res, next) => {
  const db = getDb();
  const ordersCollection = db.collection('orders');

  const userId = toObjectId(req.user.id);

  // 1. Parse query parameters
  const queryObj = JSON.parse(JSON.stringify(req.query));
  const excludedFields = ['page', 'limit', 'sort', 'fields'];
  excludedFields.forEach((el) => delete queryObj[el]);

  // 2. Build filter query - luôn filter theo user
  const mongoQuery = { user: userId };

  // Add status filter nếu có
  if (queryObj.status) {
    mongoQuery.status = queryObj.status;
  }

  // 3. Build aggregation pipeline
  const pipeline = [
    // Match stage
    { $match: mongoQuery },

    // Unwind items để populate từng product
    { $unwind: '$items' },

    // Lookup product cho mỗi item
    {
      $lookup: {
        from: 'products',
        localField: 'items.product',
        foreignField: '_id',
        as: 'items.productData',
      },
    },
    {
      $unwind: {
        path: '$items.productData',
        preserveNullAndEmptyArrays: true,
      },
    },

    // Lookup brand cho product
    {
      $lookup: {
        from: 'brands',
        localField: 'items.productData.brand',
        foreignField: '_id',
        as: 'items.productData.brandData',
      },
    },
    {
      $unwind: {
        path: '$items.productData.brandData',
        preserveNullAndEmptyArrays: true,
      },
    },

    // Lookup category cho product
    {
      $lookup: {
        from: 'categories',
        localField: 'items.productData.category',
        foreignField: '_id',
        as: 'items.productData.categoryData',
      },
    },
    {
      $unwind: {
        path: '$items.productData.categoryData',
        preserveNullAndEmptyArrays: true,
      },
    },

    // Reshape product data
    {
      $addFields: {
        'items.product': {
          _id: '$items.productData._id',
          name: '$items.productData.name',
          slug: '$items.productData.slug',
          price: '$items.productData.price',
          discount: '$items.productData.discount',
          thumbnail: '$items.productData.thumbnail',
          brand: {
            name: '$items.productData.brandData.name',
            slug: '$items.productData.brandData.slug',
          },
          category: {
            name: '$items.productData.categoryData.name',
            slug: '$items.productData.categoryData.slug',
          },
        },
      },
    },

    // Remove temporary fields
    {
      $project: {
        'items.productData': 0,
      },
    },

    // Group lại để restore items array
    {
      $group: {
        _id: '$_id',
        user: { $first: '$user' },
        items: { $push: '$items' },
        total: { $first: '$total' },
        status: { $first: '$status' },
        paymentId: { $first: '$paymentId' },
        createdAt: { $first: '$createdAt' },
        updatedAt: { $first: '$updatedAt' },
      },
    },
  ];

  // 4. Add sort
  let sortBy = '-createdAt'; // default sort (mới nhất trước)
  if (req.query.sort) {
    sortBy = req.query.sort.split(',').join(' ');
  }

  const sortObj = {};
  sortBy.split(' ').forEach((field) => {
    if (field.startsWith('-')) {
      sortObj[field.substring(1)] = -1;
    } else {
      sortObj[field] = 1;
    }
  });
  pipeline.push({ $sort: sortObj });

  // 5. Add pagination
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  pipeline.push({ $skip: skip });
  pipeline.push({ $limit: limit });

  // 6. Project fields (limit fields) nếu có
  if (req.query.fields) {
    const fields = req.query.fields.split(',').join(' ');
    const projection = {};
    fields.split(' ').forEach((field) => {
      if (field.startsWith('-')) {
        projection[field.substring(1)] = 0;
      } else {
        projection[field] = 1;
      }
    });
    if (!projection._id && !fields.includes('-_id')) {
      projection._id = 1;
    }
    pipeline.push({ $project: projection });
  }

  // 7. Execute aggregation
  const orders = await ordersCollection.aggregate(pipeline).toArray();

  res.status(200).json({
    status: 'success',
    results: orders.length,
    data: {
      orders,
    },
  });
});

// Get all orders (Admin only) - tương tự getOrdersByUser nhưng không filter theo user
exports.getAllOrders = catchAsync(async (req, res, next) => {
  const db = getDb();
  const ordersCollection = db.collection('orders');

  // 1. Parse query parameters
  const queryObj = JSON.parse(JSON.stringify(req.query));
  const excludedFields = ['page', 'limit', 'sort', 'fields'];
  excludedFields.forEach((el) => delete queryObj[el]);

  // 2. Build filter query - không filter theo user, chỉ filter theo status nếu có
  const mongoQuery = {};
  if (queryObj.status) {
    mongoQuery.status = queryObj.status;
  }

  // 3. Build aggregation pipeline
  const pipeline = [
    // Match stage
    { $match: mongoQuery },

    // Unwind items để populate từng product
    { $unwind: '$items' },

    // Lookup product cho mỗi item
    {
      $lookup: {
        from: 'products',
        localField: 'items.product',
        foreignField: '_id',
        as: 'items.productData',
      },
    },
    {
      $unwind: {
        path: '$items.productData',
        preserveNullAndEmptyArrays: true,
      },
    },

    // Lookup brand cho product
    {
      $lookup: {
        from: 'brands',
        localField: 'items.productData.brand',
        foreignField: '_id',
        as: 'items.productData.brandData',
      },
    },
    {
      $unwind: {
        path: '$items.productData.brandData',
        preserveNullAndEmptyArrays: true,
      },
    },

    // Lookup category cho product
    {
      $lookup: {
        from: 'categories',
        localField: 'items.productData.category',
        foreignField: '_id',
        as: 'items.productData.categoryData',
      },
    },
    {
      $unwind: {
        path: '$items.productData.categoryData',
        preserveNullAndEmptyArrays: true,
      },
    },

    // Lookup user để lấy thông tin người đặt hàng
    {
      $lookup: {
        from: 'users',
        localField: 'user',
        foreignField: '_id',
        as: 'userData',
      },
    },
    {
      $unwind: {
        path: '$userData',
        preserveNullAndEmptyArrays: true,
      },
    },

    // Reshape product data
    {
      $addFields: {
        'items.product': {
          _id: '$items.productData._id',
          name: '$items.productData.name',
          slug: '$items.productData.slug',
          price: '$items.productData.price',
          discount: '$items.productData.discount',
          thumbnail: '$items.productData.thumbnail',
          brand: {
            name: '$items.productData.brandData.name',
            slug: '$items.productData.brandData.slug',
          },
          category: {
            name: '$items.productData.categoryData.name',
            slug: '$items.productData.categoryData.slug',
          },
        },
      },
    },

    // Remove temporary fields
    {
      $project: {
        'items.productData': 0,
      },
    },

    // Group lại để restore items array
    {
      $group: {
        _id: '$_id',
        user: { $first: '$user' },
        userInfo: {
          $first: {
            name: '$userData.name',
            email: '$userData.email',
          },
        },
        items: { $push: '$items' },
        total: { $first: '$total' },
        status: { $first: '$status' },
        paymentId: { $first: '$paymentId' },
        createdAt: { $first: '$createdAt' },
        updatedAt: { $first: '$updatedAt' },
      },
    },
  ];

  // 4. Add sort
  let sortBy = '-createdAt'; // default sort (mới nhất trước)
  if (req.query.sort) {
    sortBy = req.query.sort.split(',').join(' ');
  }

  const sortObj = {};
  sortBy.split(' ').forEach((field) => {
    if (field.startsWith('-')) {
      sortObj[field.substring(1)] = -1;
    } else {
      sortObj[field] = 1;
    }
  });
  pipeline.push({ $sort: sortObj });

  // 5. Add pagination
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 100;
  const skip = (page - 1) * limit;

  pipeline.push({ $skip: skip });
  pipeline.push({ $limit: limit });

  // 6. Project fields (limit fields) nếu có
  if (req.query.fields) {
    const fields = req.query.fields.split(',').join(' ');
    const projection = {};
    fields.split(' ').forEach((field) => {
      if (field.startsWith('-')) {
        projection[field.substring(1)] = 0;
      } else {
        projection[field] = 1;
      }
    });
    if (!projection._id && !fields.includes('-_id')) {
      projection._id = 1;
    }
    pipeline.push({ $project: projection });
  }

  // 7. Execute aggregation
  const orders = await ordersCollection.aggregate(pipeline).toArray();

  res.status(200).json({
    status: 'success',
    results: orders.length,
    data: {
      orders,
    },
  });
});

// Cancel order (Admin only) - chỉ hủy được đơn hàng đang pending
exports.cancelOrder = catchAsync(async (req, res, next) => {
  const db = getDb();

  if (!db) {
    return next(new AppError('Database connection not available', 500));
  }

  const ordersCollection = db.collection('orders');

  let orderId;
  try {
    orderId = toObjectId(req.params.id);
  } catch (error) {
    return next(new AppError('Invalid order ID format', 400));
  }

  // 1. Kiểm tra đơn hàng tồn tại và đang pending
  const order = await ordersCollection.findOne({ _id: orderId });

  if (!order) {
    return next(new AppError('No order found with that ID', 404));
  }

  if (order.status !== 'pending') {
    return next(
      new AppError(
        `Only pending orders can be cancelled. Current status: ${order.status}`,
        400,
      ),
    );
  }

  // 2. Cập nhật status thành 'cancelled'
  // Sử dụng updateOne thay vì findOneAndUpdate để tránh lỗi
  const updateResult = await ordersCollection.updateOne(
    { _id: orderId, status: 'pending' },
    { $set: { status: 'cancelled', updatedAt: new Date() } },
  );

  if (updateResult.matchedCount === 0) {
    return next(new AppError('Order not found or already processed', 404));
  }

  if (updateResult.modifiedCount === 0) {
    return next(new AppError('Failed to cancel order', 500));
  }

  // 3. Lấy đơn hàng đã cập nhật
  const updatedOrder = await ordersCollection.findOne({ _id: orderId });

  res.status(200).json({
    status: 'success',
    data: {
      order: updatedOrder,
    },
  });
});

// Cancel my order (User) - user hủy đơn hàng của chính mình
exports.cancelMyOrder = catchAsync(async (req, res, next) => {
  const db = getDb();

  if (!db) {
    return next(new AppError('Database connection not available', 500));
  }

  const ordersCollection = db.collection('orders');
  const userId = toObjectId(req.user.id);

  let orderId;
  try {
    orderId = toObjectId(req.params.id);
  } catch (error) {
    return next(new AppError('Invalid order ID format', 400));
  }

  // 1. Kiểm tra đơn hàng tồn tại, thuộc về user và đang pending
  const order = await ordersCollection.findOne({
    _id: orderId,
    user: userId,
  });

  if (!order) {
    return next(
      new AppError('No order found with that ID or not authorized', 404),
    );
  }

  if (order.status !== 'pending') {
    return next(
      new AppError(
        `Only pending orders can be cancelled. Current status: ${order.status}`,
        400,
      ),
    );
  }

  // 2. Cập nhật status thành 'cancelled'
  const updateResult = await ordersCollection.updateOne(
    { _id: orderId, user: userId, status: 'pending' },
    { $set: { status: 'cancelled', updatedAt: new Date() } },
  );

  if (updateResult.matchedCount === 0) {
    return next(new AppError('Order not found or already processed', 404));
  }

  if (updateResult.modifiedCount === 0) {
    return next(new AppError('Failed to cancel order', 500));
  }

  // 3. Lấy đơn hàng đã cập nhật
  const updatedOrder = await ordersCollection.findOne({ _id: orderId });

  res.status(200).json({
    status: 'success',
    data: {
      order: updatedOrder,
    },
  });
});


// Auto cancel pending orders after 1 day
// Hàm này không dùng catchAsync vì được gọi trực tiếp từ scheduled task
exports.autoCancelPendingOrders = async () => {
  try {
    const db = getDb();
    const ordersCollection = db.collection('orders');

    // Tính thời gian 1 ngày trước
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Tìm tất cả đơn hàng pending được tạo hơn 1 ngày trước
    const result = await ordersCollection.updateMany(
      {
        status: 'pending',
        createdAt: { $lt: oneDayAgo },
      },
      {
        $set: {
          status: 'cancelled',
          updatedAt: new Date(),
        },
      },
    );

    if (result.modifiedCount > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `Auto-cancelled ${result.modifiedCount} pending orders older than 1 day`,
      );
    }

    return result;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error in autoCancelPendingOrders:', error);
    throw error;
  }
};
