const mongoose = require('mongoose');
const slugify = require('slugify');
const sharp = require('sharp');
const multer = require('multer');
const Product = require('../models/productModel');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const {
  invalidateProductCache,
  invalidateCache,
  getCacheKey,
} = require('../utils/redisClient');

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

const EXCLUDED_QUERY_FIELDS = ['page', 'limit', 'sort', 'fields', 'keyword'];
const RANGE_QUERY_REGEX = /^(.+)\[(gte|gt|lte|lt)\]$/;

const normalizeRangeQuery = (query) => {
  const normalized = {};
  Object.entries(query || {}).forEach(([key, value]) => {
    const match = key.match(RANGE_QUERY_REGEX);
    if (match) {
      const field = match[1];
      const operator = `$${match[2]}`;
      const numericValue = Number(value);
      const finalValue = Number.isNaN(numericValue) ? value : numericValue;
      normalized[field] = {
        ...(normalized[field] || {}),
        [operator]: finalValue,
      };
    } else {
      const numericValue = Number(value);
      normalized[key] = Number.isNaN(numericValue) ? value : numericValue;
    }
  });
  return normalized;
};

const buildMongoQuery = (query, extraExcluded = []) => {
  const queryObj = JSON.parse(JSON.stringify(query || {}));
  const excludedFields = [...EXCLUDED_QUERY_FIELDS, ...extraExcluded];
  excludedFields.forEach((el) => delete queryObj[el]);

  const queryStr = JSON.stringify(queryObj);
  const parsedQuery = JSON.parse(
    queryStr.replace(/\b(gte|gt|lte|lt)\b/g, (match) => `$${match}`),
  );

  return normalizeRangeQuery(parsedQuery);
};

// Multer configuration for product images
const multerStorage = multer.memoryStorage();

const multerFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image')) {
    cb(null, true);
  } else {
    cb(new AppError('Not an image! Please upload only images', 400), false);
  }
};

const upload = multer({
  storage: multerStorage,
  fileFilter: multerFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

// Upload middleware - handle thumbnail and multiple images
exports.uploadProductImages = upload.fields([
  { name: 'thumbnail', maxCount: 1 },
  { name: 'images', maxCount: 10 },
]);

// Resize and save product images
exports.resizeProductImages = catchAsync(async (req, res, next) => {
  if (!req.files) return next();

  // Process thumbnail
  if (req.files.thumbnail && req.files.thumbnail[0]) {
    const thumbnailFile = req.files.thumbnail[0];
    const thumbnailFilename = `product-${Date.now()}-${Math.round(
      Math.random() * 1e9,
    )}.jpeg`;

    await sharp(thumbnailFile.buffer)
      .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
      .toFormat('jpeg')
      .jpeg({ quality: 90 })
      .toFile(`public/img/products/${thumbnailFilename}`);

    req.body.thumbnail = thumbnailFilename;
  }

  // Process images array
  if (req.files.images && req.files.images.length > 0) {
    const imageFilenames = [];
    const processPromises = req.files.images.map(async (file, index) => {
      const filename = `product-${Date.now()}-${index}-${Math.round(
        Math.random() * 1e9,
      )}.jpeg`;

      await sharp(file.buffer)
        .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
        .toFormat('jpeg')
        .jpeg({ quality: 90 })
        .toFile(`public/img/products/${filename}`);

      return filename;
    });

    const filenames = await Promise.all(processPromises);
    req.body.images = filenames;
  }

  next();
});

exports.getAllProduct = catchAsync(async (req, res, next) => {
  const db = getDb();
  const productsCollection = db.collection('products');

  // 1-2. Build filter query
  let mongoQuery = buildMongoQuery(req.query);

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
  console.log(mongoQuery);
  console.log(123);
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
        __v: 0,
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

  // 8. Execute aggregation
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

  // Build aggregation pipeline
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

exports.getProductsByCategory = catchAsync(async (req, res, next) => {
  const db = getDb();
  const productsCollection = db.collection('products');
  const categoriesCollection = db.collection('categories');

  const categorySlug = req.params.slug;

  // 1. Find category by slug
  const category = await categoriesCollection.findOne({ slug: categorySlug });
  if (!category) {
    return next(new AppError('Category not found', 404));
  }

  const filters = buildMongoQuery(req.query, ['slug']);

  if (req.query.keyword) {
    filters.name = { $regex: req.query.keyword, $options: 'i' };
  }

  if (filters.brand && typeof filters.brand === 'string') {
    filters.brand = toObjectId(filters.brand);
  }
  delete filters.category;

  // 2. Build aggregation pipeline
  const pipeline = [
    // Match products by category
    { $match: { category: category._id, ...filters } },

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
          name: category.name,
          slug: category.slug,
        },
      },
    },

    // Remove temporary fields
    {
      $project: {
        brandData: 0,
        __v: 0,
      },
    },
  ];

  // 3. Add sort
  let sortBy = '-createdAt';
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

  // 4. Add pagination
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 100;
  const skip = (page - 1) * limit;

  pipeline.push({ $skip: skip });
  pipeline.push({ $limit: limit });

  // 5. Execute aggregation
  const products = await productsCollection.aggregate(pipeline).toArray();

  res.status(200).json({
    status: 'success',
    results: products.length,
    data: {
      data: products,
    },
  });
});

exports.createProduct = catchAsync(async (req, res, next) => {
  const db = getDb();
  const productsCollection = db.collection('products');

  // 1. Validate required fields
  const { name, category, brand, price, description, thumbnail } =
    req.body || {};

  if (!name || !category || !brand || !price || !description || !thumbnail) {
    return next(
      new AppError(
        'Missing required fields: name, category, brand, price, description, and thumbnail are required',
        400,
      ),
    );
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
  const discount = Number(req.body.discount) || 0;
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
    attributes: Array.isArray(req.body.attributes) ? req.body.attributes : [],
    stock: Number(req.body.stock) || 1,
    thumbnail: req.body.thumbnail || '',
    images: Array.isArray(req.body.images) ? req.body.images : [],
    description: description.trim(),
    ratingsAvergage: Number(req.body.ratingsAvergage) || 4.5,
    ratingsQuantity: Number(req.body.ratingsQuantity) || 0,
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

  // Invalidate product cache after creation
  await invalidateProductCache();

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
  const categoriesCollection = db.collection('categories');
  const brandsCollection = db.collection('brands');

  const productId = toObjectId(req.params.id);

  // 1. Check product exists
  const existingProduct = await productsCollection.findOne({ _id: productId });
  if (!existingProduct) {
    return next(new AppError('No product found with that ID', 404));
  }

  const updateFields = { ...req.body };
  updateFields.updatedAt = new Date();

  // 2. Handle name and slug update
  if (updateFields.name && updateFields.name !== existingProduct.name) {
    const existingName = await productsCollection.findOne({
      name: updateFields.name.trim(),
    });
    if (existingName && existingName._id.toString() !== productId.toString()) {
      return next(new AppError('Product name already exists', 400));
    }
    updateFields.name = updateFields.name.trim();
    updateFields.slug = slugify(updateFields.name, { lower: true });
  }

  // 3. Validate category if provided
  if (updateFields.category) {
    const categoryDoc = await categoriesCollection.findOne({
      _id: toObjectId(updateFields.category),
    });
    if (!categoryDoc) {
      return next(new AppError('Category not found', 404));
    }
    updateFields.category = toObjectId(updateFields.category);
  }

  // 4. Validate brand if provided
  if (updateFields.brand) {
    const brandDoc = await brandsCollection.findOne({
      _id: toObjectId(updateFields.brand),
    });
    if (!brandDoc) {
      return next(new AppError('Brand not found', 404));
    }
    updateFields.brand = toObjectId(updateFields.brand);
  }

  // 5. Validate discount range
  if (updateFields.discount !== undefined) {
    const parsedDiscount = Number(updateFields.discount);
    if (
      Number.isNaN(parsedDiscount) ||
      parsedDiscount < 0 ||
      parsedDiscount > 100
    ) {
      return next(new AppError('Discount must be between 0 and 100', 400));
    }
    updateFields.discount = parsedDiscount;
  }

  // 6. Validate ratingsAvergage range
  if (updateFields.ratingsAvergage !== undefined) {
    const parsedRatings = Number(updateFields.ratingsAvergage);
    if (Number.isNaN(parsedRatings) || parsedRatings < 1 || parsedRatings > 5) {
      return next(new AppError('Rating must be between 1.0 and 5.0', 400));
    }
    updateFields.ratingsAvergage = Math.round(parsedRatings * 10) / 10;
  }

  // 7. Convert attributes if provided
  if (updateFields.attributes && Array.isArray(updateFields.attributes)) {
    updateFields.attributes = updateFields.attributes.filter(
      (attr) => attr.key && attr.value,
    );
  }

  // 8. Update product
  const result = await productsCollection.findOneAndUpdate(
    { _id: productId },
    { $set: updateFields },
    { returnDocument: 'after' },
  );

  if (!result.value) {
    return next(new AppError('Failed to update product', 500));
  }

  // Invalidate cache for this specific product and all product lists
  await invalidateProductCache();
  // Invalidate specific product cache using the same key format as middleware
  const productCacheKey = getCacheKey('product', {}, { id: req.params.id });
  await invalidateCache(productCacheKey);

  res.status(200).json({
    status: 'success',
    data: {
      data: result.value,
    },
  });
});

exports.deleteProduct = catchAsync(async (req, res, next) => {
  const db = getDb();
  const productsCollection = db.collection('products');
  const productId = toObjectId(req.params.id);

  const result = await productsCollection.deleteOne({ _id: productId });

  if (result.deletedCount === 0) {
    return next(new AppError('No product found with that ID', 404));
  }

  // Invalidate cache for this specific product and all product lists
  await invalidateProductCache();
  // Invalidate specific product cache using the same key format as middleware
  const productCacheKey = getCacheKey('product', {}, { id: req.params.id });
  await invalidateCache(productCacheKey);

  res.status(204).json({
    status: 'success',
    data: null,
  });
});
