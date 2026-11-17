# Forest — Kế hoạch dự án

Một web "all-in-one" cho người làm nội dung (review sản phẩm, booking, affiliate) kiêm quản lý cuộc sống,
thay cho Google Calendar + app Reminder + Note + Habit tracker + app tiếng ồn trắng.

## 1. Phân tích từ ảnh & video mẫu

| Màn hình | Thấy gì trong mẫu | Ý nghĩa nghiệp vụ |
|---|---|---|
| **Công việc** | Lịch tháng; cột trái "Kho sản phẩm / Booking"; nhóm *Chờ nhận → Trong kho → Đã đăng*; chip màu trên từng ngày; ô "Hạn đăng" có dấu `!`; "+N mục khác"; lọc *Sản phẩm / Booking / Tất cả* | Pipeline nội dung: hàng gửi về → quay → đăng. Booking có **deadline đăng** → cần cảnh báo |
| **Project** (video) | Các thẻ dự án nổi trên nền, quanh 1 chấm trung tâm; ô nhập ở dưới | Bản đồ dự án/kênh (Web Forest, Vlog decor, Tiktok affiliate, Threads…), kéo thả tự do |
| Sidebar | Dashboard, Công việc, Reminder, Finance, Quick Note, Project, Relax, Màu & kính, Lưu trữ, Cài đặt, ô Quick note | Điều hướng + ghi chú nhanh ở mọi trang |
| Phong cách | Nền rừng sương mờ, kính mờ (glassmorphism), chữ đậm, chip đỏ rượu / đen / xanh xám | Giao diện "chill", tập trung |

## 2. Phạm vi MVP (bản code lần này)

1. **Dashboard** – hôm nay có gì: việc cần quay/đăng, deadline sắp tới, reminder, thói quen hôm nay, số dư tháng.
2. **Công việc (lịch nội dung)** – lịch tháng, thêm/sửa/xoá mục, 2 loại *Sản phẩm* & *Booking*, trạng thái, ngày lên lịch, hạn đăng, lọc, "+N mục khác", cảnh báo quá hạn.
3. **Reminder** – nhắc việc có giờ, lặp (không / ngày / tuần), thông báo trình duyệt + âm báo khi đến giờ.
4. **Thói quen** – danh sách thói quen, lưới 7/30 ngày để tick, chuỗi (streak), % hoàn thành.
5. **Finance** – thu/chi, gắn nguồn (booking, affiliate…), tổng theo tháng.
6. **Quick Note** – trang ghi chú + ô ghi chú nhanh ở sidebar, ghim, tìm kiếm.
7. **Project** – canvas kéo thả thẻ dự án, mỗi thẻ có mô tả + trạng thái.
8. **Relax** – tiếng ồn trắng / hồng / nâu / mưa / sóng tổng hợp bằng Web Audio (không cần file mp3), trộn nhiều âm, hẹn giờ Pomodoro.
9. **Cài đặt / Màu & kính** – chỉnh độ mờ kính, màu nhấn, ảnh nền; **xuất/nhập JSON** để sao lưu.

## 3. Kiến trúc

- **Vite + React + TypeScript** – nhẹ, chạy nhanh, dễ deploy tĩnh (Vercel/Netlify).
- **Zustand + persist** – toàn bộ dữ liệu lưu `localStorage` (offline, không cần server).
- **date-fns** (locale `vi`) cho lịch; **lucide-react** cho icon; CSS thuần với biến màu (glassmorphism).
- Cấu trúc:
  ```
  src/
    store/       // 1 store/1 module: content, reminders, habits, finance, notes, projects, settings
    components/  // Sidebar, Modal, Glass, ...
    pages/       // Dashboard, Work, Reminders, Habits, Finance, Notes, Projects, Relax, Settings
    lib/         // noise engine (Web Audio), notifier, date utils
  ```

### Mô hình dữ liệu chính
```ts
ContentItem { id, kind: 'product'|'booking', title, brand, status: 'waiting'|'stock'|'posted',
              date /*ngày quay/đăng*/, deadline?, fee?, platform?, note?, archived? }
Reminder    { id, title, at /*ISO*/, repeat: 'none'|'daily'|'weekly', done }
Habit       { id, name, color, log: { [yyyy-MM-dd]: true } }
Transaction { id, type: 'in'|'out', amount, category, date, note }
Note        { id, text, pinned, updatedAt }
Project     { id, title, desc, status, x, y }
```

## 4. Giới hạn cần biết

- Dữ liệu nằm trong trình duyệt → đổi máy/xoá cache là mất ⇒ dùng **Xuất JSON** để sao lưu.
- Reminder chỉ báo khi tab đang mở (trình duyệt chặn chạy nền nếu không có server push).

## 5. Lộ trình sau MVP

- **Giai đoạn 2:** đăng nhập + đồng bộ đám mây (Supabase/Neon), PWA cài lên điện thoại, push notification thật.
- **Giai đoạn 3:** kéo thả mục trên lịch, nhập file `.ics` từ Google Calendar, thống kê hiệu suất đăng bài, tự tạo giao dịch thu khi booking "Đã đăng".
