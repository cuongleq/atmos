# ATMOS · Phòng dự báo thời tiết đa tham số

Trang dự báo thời tiết chính thức, chạy hoàn toàn trên trình duyệt, không cần máy chủ.

**Có gì trong trang:**
- Dự báo **16 biến × 7 hệ thống mô hình** (GFS, ECMWF IFS, ICON, JMA, GEM, Météo-France, UKMO), hiệu chỉnh EMOS kèm dải tin cậy 10–90% và xác suất vượt ngưỡng
- Dự báo hằng ngày **16 ngày**, lịch tháng bấm từng ngày xem chi tiết từng giờ
- Radar mưa thời gian thực, chất lượng không khí (AQI), cảnh báo thiên tai theo vị trí
- Bản tin chính thức NCHMF (thu thập tự động) + kiểm thử độ chính xác trên tập đóng băng

## Đưa trang lên GitHub cho mọi người xem (miễn phí)

**Cách 1 — tự động (đã soạn sẵn, khuyên dùng):**

1. Tạo tài khoản GitHub (nếu chưa có) tại `github.com`, rồi tạo repository mới, ví dụ tên `atmos` (để Public để Pages miễn phí).
2. Trên máy này, mở PowerShell trong thư mục dự án và chạy:
   ```powershell
   git init
   git add .
   git commit -m "ATMOS official site"
   git branch -M main
   git remote add origin https://github.com/TEN-CUA-BAN/atmos.git
   git push -u origin main
   ```
   (Thay `TEN-CUA-BAN` bằng tên tài khoản GitHub của bạn. Lần đầu GitHub sẽ hỏi đăng nhập — dùng trình duyệt xác nhận.)
3. Vào repository trên GitHub → **Settings → Pages** → mục **Build and deployment**, chọn **GitHub Actions**.
4. Quay lại tab **Actions** → chờ workflow `Deploy ATMOS to GitHub Pages` chạy xong (đèn xanh, khoảng 1–2 phút).
5. Địa chỉ trang của bạn hiện ở đó, dạng `https://TEN-CUA-BAN.github.io/atmos/` — gửi link này cho mọi người xem.

Từ nay mỗi lần sửa code rồi `git push`, trang tự build và cập nhật theo.

**Cách 2 — thủ công (không cần Actions):** chạy `node build.mjs`, lấy file `dist/index.html` duy nhất, tải lên bất kỳ host tĩnh nào (Netlify Drop, Cloudflare Pages, hosting thường). Mở file trực tiếp bằng trình duyệt cũng xem được phần kiểm thử, nhưng phần dự báo trực tiếp cần mạng.

## Làm mới số liệu

```powershell
node collect.mjs        # dữ liệu kiểm thử 1 năm (lâu, chạy 1 lần)
node collect-nchmf.mjs  # bản tin NCHMF mới nhất (nên chạy mỗi ngày)
node bench.mjs          # chạy kiểm thử, sinh benchmark.json
node build.mjs          # ráp thành dist/index.html
node test.mjs           # kiểm tra toàn bộ
```

## Cấu trúc

- `dist/index.template.html` — khung trang · `dist/app.js` — giao diện · `dist/engine.js` — mô hình EMOS
- `dist/benchmark.json` — kết quả kiểm thử · `dist/nchmf.json` — bản tin NCHMF
- `dist/index.html` — file duy nhất để đăng web (do `build.mjs` sinh ra)
- `collect*.mjs`, `bench.mjs`, `test.mjs` — pipeline dữ liệu và kiểm thử

## Giấy phép dữ liệu

Dữ liệu khí tượng Open-Meteo/ERA5/CAMS theo CC BY 4.0 (ghi công nguồn khi dùng lại). Bản tin NCHMF hiển thị nguyên văn kèm link gốc.
