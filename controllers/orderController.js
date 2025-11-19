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
    return next(
      new AppError(
        `Product with ID ${missingProduct.product.toString()} not found`,
        404,
      ),
    );
  }

  // Validate stock cho tất cả items
  const invalidStockItem = user.cart.find((item) => {
    const productId = item.product.toString();
    const product = productMap[productId];
    return item.quantity > product.stock;
  });

  if (invalidStockItem) {
    const productId = invalidStockItem.product.toString();
    const product = productMap[productId];
    return next(
      new AppError(
        `The product "${product.name}" only has ${product.stock} in stock`,
        400,
      ),
    );
  }

  // Tính tổng tiền và build cartItems
  const { cartItems, total } = user.cart.reduce(
    (acc, item) => {
      const productId = item.product.toString();
      const product = productMap[productId];
      const priceAfterDiscount = Math.round(
        product.price * (1 - product.discount / 100),
      );
      const itemTotal = item.quantity * priceAfterDiscount;

      acc.cartItems.push({
        product: toObjectId(productId),
        quantity: item.quantity,
        price: priceAfterDiscount,
      });
      acc.total += itemTotal;

      return acc;
    },
    { cartItems: [], total: 0 },
  );

  // 5. Tạo order
  const paymentId = `DH${Date.now()}`;
  const order = {
    user: userId,
    items: cartItems,
    total: Math.round(total),
    status: 'pending',
    paymentId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const result = await ordersCollection.insertOne(order);
  const createdOrder = await ordersCollection.findOne({
    _id: result.insertedId,
  });

  // 6. Tạo QR URL
  const qrUrl = `https://qr.sepay.vn/img?acc=${process.env.BANK_ACCOUNT}&bank=${process.env.BANK}&amount=${createdOrder.total}&des=${createdOrder.paymentId}`;

  res.status(200).json({
    status: 'success',
    data: {
      order: createdOrder,
      qrUrl,
    },
  });
});

exports.sepayWebhook = catchAsync(async (req, res, next) => {
  const db = getDb();
  const ordersCollection = db.collection('orders');
  const usersCollection = db.collection('users');

  const { code, transferType, transferAmount, content } = req.body;

  // 1. Validate API Key
  const authHeader = req.headers.authorization?.split(' ')[1];
  if (authHeader !== process.env.SEPAY_API_KEY) {
    return next(new AppError('API KEY not correct', 400));
  }

  // 2. Extract paymentId từ content hoặc code
  const paymentId = (content && content.match(/DH\d+/)?.[0]) || code;

  // 3. Tìm order theo paymentId
  const order = await ordersCollection.findOne({ paymentId });

  if (!order || order.status !== 'pending') {
    return next(new AppError('Order not found or already processed', 404));
  }

  // 4. Validate transfer type
  if (transferType !== 'in') {
    return next(new AppError('Invalid transfer type', 400));
  }

  // 5. Validate amount
  if (Number(order.total) !== Number(transferAmount)) {
    return next(new AppError('Amount mismatch', 400));
  }

  // 6. Update user cart (clear cart)
  await usersCollection.updateOne(
    { _id: toObjectId(order.user) },
    { $set: { cart: [] } },
  );

  // 7. Update order status
  await ordersCollection.updateOne(
    { _id: order._id },
    {
      $set: {
        status: 'paid',
        updatedAt: new Date(),
      },
    },
  );

  // 8. Emit socket event
  const io = req.app.get('io');
  io.to(`order:${order._id}`).emit('orderPaid', {
    orderId: order._id,
    paymentId: order.paymentId,
    status: 'paid',
  });

  res.status(200).json({ status: 'success' });
});

/**
 * GET ORDERS BY USER - Lấy danh sách đơn hàng của user
 * Chức năng phức tạp: Filtering, sorting, pagination, populate products trong items array
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
