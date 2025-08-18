const factoryController = require('./factoryController');
const Brand = require('../models/brandModel');

exports.getAllBrand = factoryController.getAll(Brand);
exports.getBrand = factoryController.getOne(Brand);
exports.createBrand = factoryController.createOne(Brand);
exports.upateBrand = factoryController.updateOne(Brand);
exports.deleteBrand = factoryController.deleteOne(Brand);
