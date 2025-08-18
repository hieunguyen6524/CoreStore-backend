const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const inputFolder = path.join(__dirname, 'images'); // Thư mục chứa ảnh gốc
const outputFolder = path.join(__dirname, 'images-png'); // Thư mục lưu ảnh PNG

// Tạo folder output nếu chưa có
if (!fs.existsSync(outputFolder)) {
  fs.mkdirSync(outputFolder);
}

fs.readdirSync(inputFolder).forEach((file) => {
  const ext = path.extname(file).toLowerCase();
  const fileName = path.basename(file, ext);

  // Bỏ qua file nếu không phải ảnh
  if (!['.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext)) {
    console.log(`❌ Bỏ qua: ${file}`);
    return;
  }

  const inputPath = path.join(inputFolder, file);
  const outputPath = path.join(outputFolder, `${fileName}.png`);

  sharp(inputPath)
    .png()
    .toFile(outputPath)
    .then(() => console.log(`✅ Đã convert: ${file} -> ${fileName}.png`))
    .catch((err) => console.error(`Lỗi khi convert ${file}:`, err));
});
