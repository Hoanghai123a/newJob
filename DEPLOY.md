# Hướng dẫn Deploy lên Linux Server

## Yêu cầu hệ thống

- **OS**: Ubuntu 20.04+ hoặc CentOS 7+
- **Node.js**: v20+ (khuyến nghị v22)
- **RAM**: Tối thiểu 2GB
- **Disk**: Tối thiểu 2GB trống
- **PocketBase**: Đang chạy trên port 8290

## 1. Cài đặt Node.js trên Linux

### Ubuntu/Debian:
```bash
# Cài đặt Node.js 22.x
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Kiểm tra version
node -v
npm -v
```

### CentOS/RHEL:
```bash
# Cài đặt Node.js 22.x
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo yum install -y nodejs

# Kiểm tra version
node -v
npm -v
```

## 2. Cài đặt PM2

```bash
sudo npm install -g pm2
```

## 3. Setup thư mục project

```bash
# Tạo thư mục
sudo mkdir -p /var/www/newApp
sudo chown -R $USER:$USER /var/www/newApp

# Clone hoặc copy code vào thư mục
cd /var/www/newApp
# (upload code của bạn vào đây)
```

## 4. Cấu hình môi trường

```bash
cd /var/www/newApp

# Copy và chỉnh sửa file .env
cp .env.example .env
nano .env
```

**Nội dung .env cần thiết:**
```env
# PocketBase URL (local server)
PB_URL=http://127.0.0.1:8290
VITE_PB_URL=http://127.0.0.1:8290

# PocketBase admin credentials
PB_ADMIN_EMAIL=admin@example.com
PB_ADMIN_PASSWORD=your-password
# HOẶC dùng token
PB_ADMIN_TOKEN=your-admin-token

# Node environment
NODE_ENV=production
PORT=3200
```

## 5. Cấu hình PM2 (đã có sẵn)

File `ecosystem.config.cjs` đã được cấu hình:
- **App name**: jobconnect-frontend
- **Port**: 3200
- **PocketBase**: 8290
- **Working directory**: /var/www/newApp

**Lưu ý**: Nếu bạn đổi thư mục, cập nhật `cwd` trong file này.

## 6. Deploy lần đầu

```bash
cd /var/www/newApp

# Cấp quyền thực thi cho script
chmod +x deploy.sh

# Chạy deploy
./deploy.sh
```

Script sẽ tự động:
1. Kiểm tra Node.js và PM2
2. Cài đặt dependencies
3. Build project
4. Start/reload PM2

## 7. Quản lý PM2

### Xem danh sách apps:
```bash
pm2 list
```

### Xem logs:
```bash
# Tất cả logs
pm2 logs jobconnect-frontend

# Chỉ error logs
pm2 logs jobconnect-frontend --err

# Logs realtime
pm2 logs jobconnect-frontend --lines 100
```

### Monitor realtime:
```bash
pm2 monit
```

### Restart/Stop/Delete:
```bash
# Restart
pm2 restart jobconnect-frontend

# Stop
pm2 stop jobconnect-frontend

# Delete
pm2 delete jobconnect-frontend
```

### Lưu cấu hình PM2:
```bash
pm2 save
```

### Setup PM2 startup (tự động khởi động khi reboot):
```bash
pm2 startup
# Copy và chạy command được gợi ý
pm2 save
```

## 8. Cấu hình Firewall

### UFW (Ubuntu):
```bash
sudo ufw allow 3200/tcp
sudo ufw allow 8290/tcp
sudo ufw reload
```

### Firewalld (CentOS):
```bash
sudo firewall-cmd --permanent --add-port=3200/tcp
sudo firewall-cmd --permanent --add-port=8290/tcp
sudo firewall-cmd --reload
```

## 9. Setup Nginx Reverse Proxy (Khuyến nghị)

```bash
sudo apt-get install nginx  # Ubuntu
# hoặc
sudo yum install nginx      # CentOS
```

**Tạo file cấu hình:**
```bash
sudo nano /etc/nginx/sites-available/jobconnect
```

**Nội dung:**
```nginx
server {
    listen 80;
    server_name chamcongchua.com www.chamcongchua.com;

    location / {
        proxy_pass http://127.0.0.1:3200;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Enable site:**
```bash
sudo ln -s /etc/nginx/sites-available/jobconnect /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## 10. Setup SSL với Let's Encrypt

```bash
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d chamcongchua.com -d www.chamcongchua.com
```

## 11. Update code mới

```bash
cd /var/www/newApp

# Pull code mới (nếu dùng git)
git pull

# Hoặc upload code mới vào server

# Deploy
./deploy.sh
```

## 12. Troubleshooting

### App không chạy:
```bash
# Xem logs
pm2 logs jobconnect-frontend --err

# Kiểm tra port
netstat -tulpn | grep 3200

# Kiểm tra PocketBase
curl http://127.0.0.1:8290/api/health
```

### Build lỗi:
```bash
# Xóa node_modules và build lại
rm -rf node_modules .output
npm install
npm run build
```

### PM2 không tự động khởi động:
```bash
# Setup lại startup
pm2 unstartup
pm2 startup
# Copy và chạy command được gợi ý
pm2 save
```

### Lỗi permission:
```bash
# Fix ownership
sudo chown -R $USER:$USER /var/www/newApp

# Fix permissions
chmod -R 755 /var/www/newApp
```

## 13. Monitoring & Performance

### Check CPU/Memory:
```bash
pm2 monit
```

### Enable PM2 Web Dashboard (optional):
```bash
pm2 install pm2-server-monit
```

### Logs rotation:
```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

## 14. Ports Summary

| Service | Port | Description |
|---------|------|-------------|
| JobConnect Frontend | 3200 | App chính (internal) |
| PocketBase | 8290 | Database API |
| Nginx | 80/443 | Reverse proxy (public) |

## 15. Architecture Flow

```
Internet → Nginx (80/443) → JobConnect (3200) → PocketBase (8290)
             chamcongchua.com
```

---

## Quick Commands Reference

```bash
# Deploy
./deploy.sh

# Logs
pm2 logs jobconnect-frontend

# Restart
pm2 restart jobconnect-frontend

# Status
pm2 status

# Monitor
pm2 monit
```
