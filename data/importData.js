const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config('./.env');

const mongoose = require('mongoose');
const Product = require('../models/productModel');
const Brand = require('../models/brandModel');
const Category = require('../models/categoryModel');

const DB = process.env.DATABASE.replace(
  '<PASSWORD>',
  process.env.DATABASE_PASSWORD,
);

mongoose
  .connect(DB, {
    useNewUrlParser: true,
  })
  .then(() => {
    console.log('DB connecttion successful!');
  });

const products = JSON.parse(
  fs.readFileSync(`${__dirname}/products.json`, 'utf-8'),
);
const brands = JSON.parse(fs.readFileSync(`${__dirname}/brands.json`, 'utf-8'));
const categories = JSON.parse(
  fs.readFileSync(`${__dirname}/categories.json`, 'utf-8'),
);

const importData = async () => {
  try {
    await Product.create(products);
    await Brand.create(brands);
    await Category.create(categories);
    console.log('Data successfully loaded!');
  } catch (error) {
    console.log(error);
  }
  process.exit();
};

const deleteData = async () => {
  try {
    await Product.deleteMany({});
    await Brand.deleteMany({});
    await Category.deleteMany({});
    console.log('Data successfully deleted!');
  } catch (error) {
    console.log(error);
  }
  process.exit();
};

if (process.argv[2] === '--import') {
  importData();
} else if (process.argv[2] === '--delete') {
  deleteData();
}
