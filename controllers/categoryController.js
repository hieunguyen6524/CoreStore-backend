const factoryController = require('./factoryController');
const Category = require('../models/categoryModel');

exports.getAllCategory = factoryController.getAll(Category);
exports.getCategory = factoryController.getOne(Category);
exports.createCategory = factoryController.createOne(Category);
exports.updateCategory = factoryController.updateOne(Category);
exports.deleteCategory = factoryController.deleteOne(Category);
