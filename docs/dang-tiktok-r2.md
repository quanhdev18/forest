# Cài đặt mục "Đăng TikTok" (Cloudflare R2 + Supabase + Vercel)

Cách hoạt động:

1. Trình duyệt tải video/ảnh **thẳng lên Cloudflare R2** (không đi qua Vercel, nên không bị giới hạn 4,5 MB).
2. Bài đăng được ghi vào bảng **Supabase** `tiktok_posts` (mỗi tài khoản chỉ thấy bài của mình).
3. Vercel Function `api/tiktok.ts` lấy file từ R2 và gửi sang **QPost** kèm giờ đăng. QPost tự đăng đúng giờ, máy bạn không cần bật.
4. Trạng thái và link bài được cập nhật mỗi khi mở trang Đăng TikTok.

Khi chạy ở máy (`npm run dev`), Vite chạy thẳng file `api/tiktok.ts`, nên **không cần** `npm run server` nữa.
Thư mục `server/` cũ không còn được dùng.

---

## Bước 1. Tạo bảng trên Supabase

1. Mở Supabase → project Forest → **SQL Editor** → **New query**.
2. Dán toàn bộ nội dung file `supabase/tiktok.sql` → **Run**.

## Bước 2. Tạo bucket Cloudflare R2

1. Đăng nhập [dash.cloudflare.com](https://dash.cloudflare.com) → **R2 Object Storage**. Lần đầu có thể phải bấm bật R2 (có thể được yêu cầu thêm phương thức thanh toán; gói miễn phí 10 GB không bị trừ tiền).
2. **Create bucket**, đặt tên, ví dụ `forest-tiktok`. Giữ mặc định (không bật Public access).
3. Vào bucket → **Settings** → **CORS Policy** → **Add CORS policy**, dán:

   ```json
   [
     {
       "AllowedOrigins": ["http://127.0.0.1:5173", "https://TEN-APP.vercel.app"],
       "AllowedMethods": ["GET", "PUT"],
       "AllowedHeaders": ["Content-Type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   Thay `https://TEN-APP.vercel.app` bằng địa chỉ Forest trên Vercel (thêm cả tên miền riêng nếu có).
4. Quay lại trang R2 → **Manage API tokens** (hoặc **API** → **Manage API Tokens**) → **Create API token**:
   - Permissions: **Object Read & Write**
   - Specify bucket: chọn bucket vừa tạo
   - Bấm **Create**, rồi chép lại **Access Key ID** và **Secret Access Key** (Secret chỉ hiện một lần).
5. **Account ID** nằm ở trang tổng quan R2 (cột bên phải), hoặc trong đường dẫn S3: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.

## Bước 3. Điền key vào `.env.local` (chạy ở máy)

Mở `.env.local`, điền 4 dòng:

```
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=forest-tiktok
```

`TIKTOK_ALLOWED_EMAILS` là email Google được phép dùng mục này (cách nhau dấu phẩy). Đổi lại nếu bạn đăng nhập Forest bằng email khác.
Sau khi sửa `.env.local`, tắt và chạy lại `npm run dev`.

## Bước 4. Khai báo biến môi trường trên Vercel

Vercel → project Forest → **Settings** → **Environment Variables**. Thêm (giá trị lấy từ `.env.local`):

| Biến | Ghi chú |
| --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | đã có nếu Forest đang chạy trên Vercel |
| `TIKTOK_ALLOWED_EMAILS` | email được dùng **key QPost chung trên server** (khi chưa nhập key riêng) và **AI viết caption**. Người khác vẫn dùng được mục Đăng TikTok bằng key QPost của riêng họ |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API Keys → khoá **secret** (`service_role`). Chỉ server dùng, để người được chia sẻ đăng được lên kênh của bạn mà không thấy key. **Không** thêm tiền tố `VITE_` |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | từ Bước 2 |
| `QPOST_API_KEY`, `QPOST_BASE_URL`, `QPOST_DRY_RUN` | `QPOST_DRY_RUN=false` để đăng thật |
| `AI_PROVIDER`, `GEMINI_API_KEY`, `GEMINI_MODEL` | AI viết caption (`ANTHROPIC_API_KEY` nếu dùng Claude) |
| `TIKTOK_PRIVACY`, `TIKTOK_ALLOW_COMMENT`, `TIKTOK_ALLOW_DUET`, `TIKTOK_ALLOW_STITCH`, `TIKTOK_AUTO_MUSIC`, `TIKTOK_PHOTO_AUTO_MUSIC`, `TIKTOK_COVER_MS`, `TIKTOK_IS_AIGC`, `TIKTOK_COMMERCIAL` | tuỳ chọn TikTok, giống `.env` cũ |

Các biến **không** có tiền tố `VITE_` chỉ server đọc được, không lộ ra trình duyệt.
Thêm xong thì **Redeploy**.

---

## Cài đặt và chia sẻ kênh (trong trang Đăng TikTok → nút ⚙ Cài đặt)

- **Mọi tài khoản** đều có kênh riêng: lần đầu vào, Forest hỏi *"Bạn đã có API key QPost chưa?"*, có thì nhập, chưa có thì hiện hướng dẫn tạo key.
- **Chủ kênh** nhập API key QPost, chọn tuỳ chọn mặc định khi đăng, và **thêm email** người cùng làm ở mục *Chia sẻ kênh*.
- **Người được chia sẻ** đăng nhập Forest bằng đúng email đó là thấy mục Đăng TikTok, đăng được lên kênh của chủ kênh, dùng được AI viết caption. Họ **không thấy API key** và không đổi được cài đặt.
- Ai được chia sẻ nhiều kênh thì chọn kênh ở ô *Kênh đang đăng lên*.
- Mỗi người chỉ thấy bài do chính mình đăng trong hàng đợi.
- Đăng nhập / đổi tài khoản TikTok vẫn làm trên trang Accounts của QPost (QPost không có API cho việc này).

## Giới hạn cần biết

- Video tối đa **500 MB**, ảnh tối đa **20 MB/ảnh**, tối đa **35 ảnh** mỗi bài.
- Function gửi QPost chạy tối đa **300 giây** (`vercel.json`). Video rất lớn trên mạng chậm có thể vượt mức này; khi đó bài báo lỗi và bạn bấm **Thử lại**.
- File được giữ trên R2 để xem ảnh thu nhỏ và thử lại khi lỗi. Xoá bài trong Forest sẽ xoá luôn file trên R2.
- Xoá bài trong Forest **không** huỷ lịch đăng đã gửi sang QPost.
- Hàng đợi cũ (SQLite trong `server/data/`) không được chuyển sang; các bài cũ đều đã đăng xong.
