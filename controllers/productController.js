const mongoose = require('mongoose');
const slugify = require('slugify');
const Product = require('../models/productModel');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');

const factoryController = require('./factoryController');

// Helper function to get MongoDB database instance
const getDb = () => mongoose.connection.db;

// Helper function to convert ObjectId string to ObjectId
const toObjectId = (id) => {
  if (mongoose.Types.ObjectId.isValid(id)) {
    return new mongoose.Types.ObjectId(id);
  }
  throw new AppError('Invalid ID format', 400);
};

exports.getAllProduct = catchAsync(async (req, res, next) => {
  const db = getDb();
  const productsCollection = db.collection('products');

  // 1. Parse query parameters
  const queryObj = JSON.parse(JSON.stringify(req.query));
  const excludedFields = ['page', 'limit', 'sort', 'fields', 'keyword'];
  excludedFields.forEach((el) => delete queryObj[el]);

  // 2. Build filter query
  let mongoQuery = {};

  // Convert query string operators (gte, gt, lte, lt)
  const queryStr = JSON.stringify(queryObj);
  const parsedQuery = JSON.parse(
    queryStr.replace(/\b(gte|gt|lte|lt)\b/g, (match) => `$${match}`),
  );

  mongoQuery = parsedQuery;

  // 3. Add keyword search (search by name)
  if (req.query.keyword) {
    mongoQuery.name = { $regex: req.query.keyword, $options: 'i' };
  }

  // 4. Convert ObjectId strings in query to ObjectId for brand and category
  if (mongoQuery.brand && typeof mongoQuery.brand === 'string') {
    mongoQuery.brand = toObjectId(mongoQuery.brand);
  }
  if (mongoQuery.category && typeof mongoQuery.category === 'string') {
    mongoQuery.category = toObjectId(mongoQuery.category);
  }

  // 5. Build aggregation pipeline
  const pipeline = [
    // Match stage
    { $match: mongoQuery },

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

    // Add virtual field: priceAfterDiscount
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

    // Remove temporary fields
    {
      $project: {
        brandData: 0,
        categoryData: 0,
      },
    },
  ];

  // 6. Add sort
  let sortBy = '-createdAt'; // default sort
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

  // 7. Add pagination
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 100;
  const skip = (page - 1) * limit;

  pipeline.push({ $skip: skip });
  pipeline.push({ $limit: limit });

  // 8. Project fields (limit fields)
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
    // Always include _id unless explicitly excluded
    if (!projection._id && !fields.includes('-_id')) {
      projection._id = 1;
    }
    pipeline.push({ $project: projection });
  } else {
    // Default: exclude __v
    pipeline.push({ $project: { __v: 0 } });
  }

  // 9. Execute aggregation
  const products = await productsCollection.aggregate(pipeline).toArray();

  res.status(200).json({
    status: 'success',
    results: products.length,
    data: {
      data: products,
    },
  });
});
exports.getProduct = catchAsync(async (req, res, next) => {
  const db = getDb();
  const productsCollection = db.collection('products');

  const productId = toObjectId(req.params.id);

  // Build aggregation pipeline để populate brand và category
  const pipeline = [
    // Match stage
    { $match: { _id: productId } },

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

    // Add virtual field: priceAfterDiscount
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

    // Remove temporary fields
    {
      $project: {
        brandData: 0,
        categoryData: 0,
        __v: 0,
      },
    },
  ];

  // Execute aggregation
  const products = await productsCollection.aggregate(pipeline).toArray();

  if (!products || products.length === 0) {
    return next(new AppError('No document found with that ID', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      data: products[0],
    },
  });
});
exports.createProduct = catchAsync(async (req, res, next) => {
  const db = getDb();
  const productsCollection = db.collection('products');

  // 1. Validate required fields
  const { name, category, brand, price, thumbnail, description } = req.body;

  if (!name || !category || !brand || !price || !thumbnail || !description) {
    return next(new AppError('Missing required fields', 400));
  }

  // 2. Check if product name already exists (unique constraint)
  const existingProduct = await productsCollection.findOne({ name });
  if (existingProduct) {
    return next(new AppError('Product name already exists', 400));
  }

  // 3. Validate category và brand tồn tại
  const categoriesCollection = db.collection('categories');
  const brandsCollection = db.collection('brands');

  const categoryObj = await categoriesCollection.findOne({
    _id: toObjectId(category),
  });
  if (!categoryObj) {
    return next(new AppError('Category not found', 404));
  }

  const brandObj = await brandsCollection.findOne({ _id: toObjectId(brand) });
  if (!brandObj) {
    return next(new AppError('Brand not found', 404));
  }

  // 4. Generate slug từ name
  const slug = slugify(name, { lower: true });

  // 5. Validate discount range
  const discount = req.body.discount || 0;
  if (discount < 0 || discount > 100) {
    return next(new AppError('Discount must be between 0 and 100', 400));
  }

  // 6. Prepare product document
  const product = {
    name: name.trim(),
    slug,
    category: toObjectId(category),
    brand: toObjectId(brand),
    price: Number(price),
    discount: Number(discount),
    attributes: req.body.attributes || [],
    stock: req.body.stock || 1,
    thumbnail,
    images: req.body.images || [],
    description: description.trim(),
    ratingsAvergage: req.body.ratingsAvergage || 4.5,
    ratingsQuantity: req.body.ratingsQuantity || 0,
    status: req.body.status || 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // 7. Validate ratingsAvergage range
  if (product.ratingsAvergage < 1 || product.ratingsAvergage > 5) {
    return next(new AppError('Rating must be between 1.0 and 5.0', 400));
  }

  // 8. Round ratingsAvergage
  product.ratingsAvergage = Math.round(product.ratingsAvergage * 10) / 10;

  // 9. Insert product
  const result = await productsCollection.insertOne(product);
  const createdProduct = await productsCollection.findOne({
    _id: result.insertedId,
  });

  res.status(201).json({
    status: 'success',
    data: {
      data: createdProduct,
    },
  });
});
exports.updateProduct = catchAsync(async (req, res, next) => {
  const db = getDb();
  const productsCollection = db.collection('products');

  const productId = toObjectId(req.params.id);

  // 1. Check if product exists
  const existingProduct = await productsCollection.findOne({ _id: productId });
  if (!existingProduct) {
    return next(new AppError('No document found with that id', 404));
  }

  // 2. Prepare update object
  const updateData = JSON.parse(JSON.stringify(req.body));

  // 3. If name is being updated, check unique constraint and generate slug
  if (updateData.name) {
    const nameExists = await productsCollection.findOne({
      name: updateData.name.trim(),
      _id: { $ne: productId },
    });
    if (nameExists) {
      return next(new AppError('Product name already exists', 400));
    }
    updateData.slug = slugify(updateData.name, { lower: true });
    updateData.name = updateData.name.trim();
  }

  // 4. Convert category và brand to ObjectId nếu có
  if (updateData.category) {
    const categoriesCollection = db.collection('categories');
    const categoryObj = await categoriesCollection.findOne({
      _id: toObjectId(updateData.category),
    });
    if (!categoryObj) {
      return next(new AppError('Category not found', 404));
    }
    updateData.category = toObjectId(updateData.category);
  }

  if (updateData.brand) {
    const brandsCollection = db.collection('brands');
    const brandObj = await brandsCollection.findOne({
      _id: toObjectId(updateData.brand),
    });
    if (!brandObj) {
      return next(new AppError('Brand not found', 404));
    }
    updateData.brand = toObjectId(updateData.brand);
  }

  // 5. Validate discount range nếu có
  if (updateData.discount !== undefined) {
    const discount = Number(updateData.discount);
    if (discount < 0 || discount > 100) {
      return next(new AppError('Discount must be between 0 and 100', 400));
    }
    updateData.discount = discount;
  }

  // 6. Validate ratingsAvergage nếu có
  if (updateData.ratingsAvergage !== undefined) {
    const rating = Number(updateData.ratingsAvergage);
    if (rating < 1 || rating > 5) {
      return next(new AppError('Rating must be between 1.0 and 5.0', 400));
    }
    updateData.ratingsAvergage = Math.round(rating * 10) / 10;
  }

  // 7. Add updatedAt
  updateData.updatedAt = new Date();

  // 8. Update product - Query đơn giản: findOneAndUpdate
  const updatedProduct = await productsCollection.findOneAndUpdate(
    { _id: productId },
    { $set: updateData },
    { returnDocument: 'after' },
  );

  if (!updatedProduct) {
    return next(new AppError('No document found with that id', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      data: updatedProduct,
    },
  });
});
exports.deleteProduct = factoryController.deleteOne(Product);

exports.getProductsByCategory = catchAsync(async (req, res, next) => {
  const db = getDb();
  const categoriesCollection = db.collection('categories');
  const productsCollection = db.collection('products');

  const { slug } = req.params;

  // 1. Tìm category theo slug
  const category = await categoriesCollection.findOne({ slug });

  if (!category) {
    return next(new AppError('No category found with that slug', 404));
  }

  // 2. Build aggregation pipeline để lấy products với populate brand và category
  const pipeline = [
    // Match stage - filter by category
    { $match: { category: category._id } },

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

    // Add virtual field: priceAfterDiscount
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

    // Remove temporary fields
    {
      $project: {
        brandData: 0,
        categoryData: 0,
        __v: 0,
      },
    },
  ];

  // 3. Execute aggregation
  const products = await productsCollection.aggregate(pipeline).toArray();

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
