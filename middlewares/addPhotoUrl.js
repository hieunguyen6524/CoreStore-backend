module.exports = (req, res, next) => {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const oldJson = res.json;
  const visited = new WeakSet();

  const addUrlRecursively = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;

    if (visited.has(obj)) return obj;
    visited.add(obj);

    if (Array.isArray(obj)) {
      return obj.map((item) => {
        if (typeof item === 'string') {
          // Xử lý mảng tên file ảnh
          return `${baseUrl}/img/products/${item}`;
        }
        return addUrlRecursively(item);
      });
    }

    Object.keys(obj).forEach((key) => {
      if (['avatar', 'thumbnail'].includes(key) && obj[key]) {
        obj[key] =
          `${baseUrl}/img/${key === 'avatar' ? 'users' : 'products'}/${obj[key]}`;
      } else if (key === 'images' && Array.isArray(obj[key])) {
        obj[key] = obj[key].map((file) => `${baseUrl}/img/products/${file}`);
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        obj[key] = addUrlRecursively(obj[key]);
      }
    });

    return obj;
  };

  res.json = function (data) {
    const newData = addUrlRecursively(data);
    return oldJson.call(this, newData);
  };

  next();
};
