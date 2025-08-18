const Product = require('../models/productModel');

const factoryController = require('./factoryController');

exports.getAllProduct = factoryController.getAll(Product);
exports.getProduct = factoryController.getOne(Product);
exports.createProduct = factoryController.createOne(Product);
exports.updateProduct = factoryController.updateOne(Product);
exports.deleteProduct = factoryController.deleteOne(Product);
