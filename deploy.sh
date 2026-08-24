#!/bin/bash
# Deploy script cho JobConnect Frontend trên Linux server

set -e

echo "🚀 Bắt đầu deploy JobConnect..."

# Kiểm tra Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js chưa được cài đặt"
    exit 1
fi

# Kiểm tra PM2
if ! command -v pm2 &> /dev/null; then
    echo "📦 Cài đặt PM2..."
    npm install -g pm2
fi

# Kiểm tra file .env
if [ ! -f .env ]; then
    echo "⚠️  File .env chưa tồn tại. Copy từ .env.example..."
    cp .env.example .env
    echo "📝 Vui lòng cập nhật thông tin trong .env trước khi tiếp tục"
    exit 1
fi

# Install dependencies
echo "📦 Cài đặt dependencies..."
npm install --production=false

# Build project
echo "🔨 Build project..."
npm run build

# Kiểm tra build output
if [ ! -f .output/server/index.mjs ]; then
    echo "❌ Build thất bại - không tìm thấy .output/server/index.mjs"
    exit 1
fi

# Deploy với PM2
echo "🚀 Deploy với PM2..."
if pm2 list | grep -q "jobconnect-frontend"; then
    echo "♻️  Reload ứng dụng..."
    pm2 reload ecosystem.config.cjs --env production --update-env
else
    echo "▶️  Start ứng dụng lần đầu..."
    pm2 start ecosystem.config.cjs --env production
fi

# Save PM2 process list
pm2 save

echo "✅ Deploy thành công!"
echo ""
echo "📊 Trạng thái PM2:"
pm2 list
echo ""
echo "📝 Xem logs: pm2 logs jobconnect-frontend"
echo "📊 Monitor: pm2 monit"
echo "🔄 Restart: pm2 restart jobconnect-frontend"
echo "🛑 Stop: pm2 stop jobconnect-frontend"
