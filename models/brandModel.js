const mongoose = require('mongoose');
const slugify = require('slugify');

const brandSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
  },
  logo: String,
  slug: String,
});

brandSchema.pre('save', function (next) {
  this.slug = slugify(this.name, { lower: true });
  next();
});

const Brand = mongoose.model('Brand', brandSchema);
module.exports = Brand;
