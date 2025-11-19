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

exports.getUserCart = catchAsync(async (req, res, next) => {
  const db = getDb();
  const usersCollection = db.collection('users');
  const productsCollection = db.collection('products');

  const userId = toObjectId(req.user.id);

  // 1. Lấy user với cart
  const user = await usersCollection.findOne(
    { _id: userId },
    { projection: { cart: 1 } },
  );

  if (!user || !user.cart || user.cart.length === 0) {
    return next(new AppError('Cart is empty', 404));
  }

  // 2. Lấy tất cả product IDs từ cart
  const productIds = user.cart.map((item) => toObjectId(item.product));

  // 3. Query products với populate brand và category
  const products = await productsCollection
    .aggregate([
      { $match: { _id: { $in: productIds } } },
      // Lookup brand
      {
        $lookup: {
          from: 'brands',
          localField: 'brand',
          foreignField: '_id',
          as: 'brandData',
        },
      },
      {
        $unwind: {
          path: '$brandData',
          preserveNullAndEmptyArrays: true,
        },
      },
      // Lookup category
      {
        $lookup: {
          from: 'categories',
          localField: 'category',
          foreignField: '_id',
          as: 'categoryData',
        },
      },
      {
        $unwind: {
          path: '$categoryData',
          preserveNullAndEmptyArrays: true,
        },
      },
      // Add virtual field
      {
        $addFields: {
          priceAfterDiscount: {
            $round: {
              $multiply: [
                '$price',
                { $subtract: [1, { $divide: ['$discount', 100] }] },
              ],
            },
          },
          brand: {
            name: '$brandData.name',
            slug: '$brandData.slug',
          },
          category: {
            name: '$categoryData.name',
            slug: '$categoryData.slug',
          },
        },
      },
      {
        $project: {
          brandData: 0,
          categoryData: 0,
          __v: 0,
        },
      },
    ])
    .toArray();

  // 4. Tạo map để truy cập product nhanh
  const productMap = {};
  products.forEach((product) => {
    productMap[product._id.toString()] = product;
  });

  // 5. Map cart items với populated products
  const populatedCart = user.cart.map((item) => {
    const productId = item.product.toString();
    const product = productMap[productId] || null;

    return {
      _id: item._id,
      product: product
        ? {
            _id: product._id,
            name: product.name,
            slug: product.slug,
            price: product.price,
            discount: product.discount,
            priceAfterDiscount: product.priceAfterDiscount,
            thumbnail: product.thumbnail,
            stock: product.stock,
            brand: product.brand,
            category: product.category,
          }
        : null,
      quantity: item.quantity,
    };
  });

  res.status(200).json({
    status: 'success',
    data: {
      cart: populatedCart,
    },
  });
});

exports.addCart = catchAsync(async (req, res, next) => {
  const db = getDb();
  const usersCollection = db.collection('users');
  const productsCollection = db.collection('products');

  const { product, quantity } = req.body;
  const userId = toObjectId(req.user.id);
  const productId = toObjectId(product);
  const itemQuantity = quantity || 1;

  // 1. Validate product tồn tại
  const productDoc = await productsCollection.findOne({ _id: productId });
  if (!productDoc) {
    return next(new AppError('Product not found', 404));
  }

  // 2. Lấy user với cart
  const user = await usersCollection.findOne(
    { _id: userId },
    { projection: { cart: 1 } },
  );

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  // 3. Tìm xem product đã có trong cart chưa
  const existingCartItem = user.cart.find(
    (item) => item.product.toString() === productId.toString(),
  );

  let updatedCart;

  if (existingCartItem) {
    // 4a. Nếu đã có, tăng quantity
    const newQuantity = existingCartItem.quantity + itemQuantity;

    updatedCart = user.cart.map((item) => {
      if (item.product.toString() === productId.toString()) {
        return {
          ...item,
          quantity: newQuantity,
        };
      }
      return item;
    });

    // Update cart với quantity mới
    await usersCollection.updateOne(
      { _id: userId, 'cart._id': existingCartItem._id },
      { $set: { 'cart.$.quantity': newQuantity } },
    );
  } else {
    // 4b. Nếu chưa có, thêm mới vào cart
    const newCartItem = {
      _id: new mongoose.Types.ObjectId(),
      product: productId,
      quantity: itemQuantity,
    };

    updatedCart = [...user.cart, newCartItem];

    // Push item mới vào cart array
    await usersCollection.updateOne(
      { _id: userId },
      { $push: { cart: newCartItem } },
    );
  }

  // 5. Lấy lại user với cart đã update để return
  const updatedUser = await usersCollection.findOne(
    { _id: userId },
    { projection: { cart: 1 } },
  );

  res.status(200).json({
    status: 'success',
    cart: updatedUser.cart,
  });
});

exports.deleteCartItem = catchAsync(async (req, res, next) => {
  const db = getDb();
  const usersCollection = db.collection('users');

  const userId = toObjectId(req.user.id);
  const cartItemId = toObjectId(req.params.id);

  // 1. Check if user exists
  const user = await usersCollection.findOne(
    { _id: userId },
    { projection: { cart: 1 } },
  );

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  // 2. Check if cart item exists
  const cartItem = user.cart.find(
    (item) => item._id.toString() === cartItemId.toString(),
  );

  if (!cartItem) {
    return next(new AppError('Cart item not found', 404));
  }

  // 3. Remove item from nested array - Query phức tạp với $pull
  // Query này phức tạp vì phải remove element trong nested array
  await usersCollection.updateOne(
    { _id: userId },
    { $pull: { cart: { _id: cartItemId } } },
  );

  res.status(200).json({
    status: 'success',
    data: null,
  });
});

exports.updateItemQuantity = catchAsync(async (req, res, next) => {
  const db = getDb();
  const usersCollection = db.collection('users');

  const userId = toObjectId(req.user.id);
  const cartItemId = toObjectId(req.params.id);
  const newQuantity = Number(req.body.quantity);

  // 1. Validate quantity
  if (Number.isNaN(newQuantity) || newQuantity < 1) {
    return next(new AppError('Quantity must be a positive number', 400));
  }

  // 2. Update nested array với positional operator $ - Query phức tạp
  // Query này phức tạp vì phải match cả user ID và cart item ID trong nested array
  const result = await usersCollection.findOneAndUpdate(
    { _id: userId, 'cart._id': cartItemId },
    { $set: { 'cart.$.quantity': newQuantity } },
    { returnDocument: 'after', projection: { cart: 1 } },
  );

  if (!result) {
    return next(new AppError('User or cart item not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      cart: result.cart,
    },
  });
});
