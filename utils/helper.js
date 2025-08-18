// helpers/productHelper.js
exports.getTopProducts = async (
  Model,
  { filter = {}, sort = { discount: -1 }, limit = 5, select = '' },
) => Model.find(filter).sort(sort).limit(limit).select(select);
