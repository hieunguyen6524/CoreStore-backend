# Redis Cache Configuration

## Tổng quan

Hệ thống sử dụng Redis để cache các kết quả tìm kiếm sản phẩm, giúp tối ưu hiệu suất và giảm tải cho MongoDB.

## Cài đặt Redis

### Local Development

1. **Cài đặt Redis trên Windows:**
   - Download Redis từ: https://github.com/microsoftarchive/redis/releases
   - Hoặc sử dụng WSL2 với Redis
   - Hoặc sử dụng Docker: `docker run -d -p 6379:6379 redis:latest`

2. **Cài đặt Redis trên Linux/Mac:**
   ```bash
   # Ubuntu/Debian
   sudo apt-get install redis-server
   
   # Mac
   brew install redis
   ```

3. **Khởi động Redis:**
   ```bash
   # Windows (nếu cài đặt trực tiếp)
   redis-server
   
   # Linux/Mac
   sudo systemctl start redis
   # hoặc
   redis-server
   ```

## Cấu hình

Thêm các biến môi trường sau vào file `.env`:

```env
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Hoặc sử dụng Redis URL (nếu có)
# REDIS_URL=redis://localhost:6379
# REDIS_URL=redis://:password@host:port
```

## Các chức năng được cache

### 1. getAllProduct - Tìm kiếm sản phẩm
- **Cache key prefix:** `products:`
- **TTL:** 30 phút (1800 giây)
- **Cache dựa trên:** query parameters (keyword, brand, category, price range, sort, page, limit)
- **Ví dụ cache key:** `products:{"brand":"...","keyword":"laptop","page":"1","limit":"10"}`

### 2. getProduct - Lấy 1 sản phẩm
- **Cache key prefix:** `product:`
- **TTL:** 1 giờ (3600 giây)
- **Cache dựa trên:** route params (id)
- **Ví dụ cache key:** `product:{"id":"507f1f77bcf86cd799439011"}`

### 3. getProductsByCategory - Sản phẩm theo category
- **Cache key prefix:** `products:category:`
- **TTL:** 30 phút (1800 giây)
- **Cache dựa trên:** route params (slug) + query parameters (sort, page, limit)
- **Ví dụ cache key:** `products:category:{"slug":"laptop","page":"1","limit":"10"}`

## Cache Invalidation

Cache tự động được invalidate khi:

1. **Tạo sản phẩm mới** (`createProduct`)
   - Invalidate tất cả cache liên quan đến products

2. **Cập nhật sản phẩm** (`updateProduct`)
   - Invalidate cache của sản phẩm cụ thể
   - Invalidate tất cả cache danh sách sản phẩm

3. **Xóa sản phẩm** (`deleteProduct`)
   - Invalidate cache của sản phẩm cụ thể
   - Invalidate tất cả cache danh sách sản phẩm

## Cách hoạt động

### Cache Hit (Cache có sẵn)
1. Request đến API
2. Middleware kiểm tra Redis cache
3. Nếu có cache → trả về ngay lập tức (không query MongoDB)
4. Response time: ~1-5ms

### Cache Miss (Cache không có)
1. Request đến API
2. Middleware kiểm tra Redis cache
3. Không có cache → tiếp tục đến controller
4. Controller query MongoDB
5. Response được cache vào Redis
6. Trả về response cho client

## Monitoring

### Kiểm tra Redis connection
Khi server khởi động, bạn sẽ thấy:
- `✅ Redis connected successfully` - Redis đã kết nối
- `⚠️ Redis cache will be disabled` - Redis không kết nối được, app vẫn chạy bình thường (không có cache)

### Kiểm tra cache keys
```bash
# Kết nối Redis CLI
redis-cli

# Xem tất cả keys
KEYS *

# Xem keys của products
KEYS products:*

# Xem giá trị của một key
GET "products:{\"keyword\":\"laptop\"}"

# Xem TTL của key
TTL "products:{\"keyword\":\"laptop\"}"

# Xóa tất cả cache
FLUSHDB
```

## Troubleshooting

### Redis không kết nối được
1. Kiểm tra Redis đã chạy chưa:
   ```bash
   redis-cli ping
   # Nếu trả về PONG → Redis đang chạy
   ```

2. Kiểm tra port và host trong `.env`

3. App vẫn hoạt động bình thường, chỉ không có cache

### Cache không được invalidate
- Kiểm tra logs xem có thông báo `✅ Invalidated X cache keys`
- Nếu không có, có thể Redis không kết nối được

### Performance
- Cache hit rate cao → giảm tải MongoDB đáng kể
- Cache miss → query MongoDB như bình thường
- TTL ngắn (30 phút) để đảm bảo dữ liệu cập nhật

## Best Practices

1. **TTL phù hợp:**
   - Danh sách sản phẩm: 30 phút (dữ liệu thay đổi thường xuyên)
   - Chi tiết sản phẩm: 1 giờ (dữ liệu ít thay đổi)

2. **Cache invalidation:**
   - Luôn invalidate khi có thay đổi dữ liệu
   - Invalidate cả cache cụ thể và cache danh sách

3. **Error handling:**
   - Nếu Redis lỗi, app vẫn hoạt động bình thường
   - Không block request nếu cache fail

## Production

### Redis Cloud Services
- **Redis Cloud:** https://redis.com/cloud
- **AWS ElastiCache:** https://aws.amazon.com/elasticache/
- **Azure Cache for Redis:** https://azure.microsoft.com/services/cache/

### Environment Variables cho Production
```env
REDIS_URL=redis://:password@your-redis-host:6379
# hoặc
REDIS_HOST=your-redis-host
REDIS_PORT=6379
REDIS_PASSWORD=your-password
```

