const mongoose = require('mongoose');
const slugify = require('slugify');

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      unique: true,
      required: [true, 'A product must have a name'],
      trim: true,
    },
    slug: String,
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: [true, 'Product must belong to a category'],
    },
    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Brand',
      required: [true, 'Product must belong to a brand'],
    },
    price: {
      type: Number,
      required: [true, 'A product must have a price'],
    },
    discount: {
      type: Number,
      default: 0,
      min: [0, 'Discount must be at least 0%'],
      max: [100, 'Discount cannot exceed 100%'],
    },
    // priceDiscount: {
    //   type: Number,
    //   validate: {
    //     validator: function (val) {
    //       return val < this.price;
    //     },
    //     message: 'Discount price ({VALUE}) should be below regular price',
    //   },
    // },
    attributes: [
      {
        key: {
          type: String,
          required: true,
          // enum: ['RAM', 'CPU', 'Storage', 'GPU', 'Screen', 'RefreshRate'], // Danh sách các key hợp lệ
        },
        value: { type: String, required: true },
      },
    ],
    stock: {
      type: Number,
      default: 1,
    },
    thumbnail: {
      type: String,
      required: [true, 'A product must have a thumbnail'],
    },
    images: [String],
    description: {
      type: String,
      trim: true,
      required: [true, ' A product must have a description'],
    },
    ratingsAvergage: {
      type: Number,
      default: 4.5,
      min: [1, 'Rating must be above 1.0'],
      max: [5, 'Rating must be below 5.0'],
      set: (val) => Math.round(val * 10) / 10,
    },
    ratingsQuantity: {
      type: Number,
      default: 0,
    },
    createdAt: {
      type: Date,
      default: Date.now(),
      select: false,
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'out of stock'],
      default: 'active',
    },
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

productSchema.pre('save', function (next) {
  this.slug = slugify(this.name, { lower: true });
  this.priceDiscount = this.price * (1 - this.discount / 100);
  next();
});

productSchema.pre(/^find/, function (next) {
  this.populate([
    { path: 'brand', select: 'name' },
    { path: 'category', select: 'name' },
  ]);
  next();
});

productSchema.virtual('priceAfterDiscount').get(function () {
  return this.price * (1 - this.discount / 100);
});

const Product = mongoose.model('Product', productSchema);
module.exports = Product;
