<p align="center">
  <img src="assets/banner.svg" alt="AI Pulse — GitHub AI/LLM Radar" width="100%"/>
</p>

# AI Pulse

**Dự án cá nhân của [@TienQuangPP](https://github.com/TienQuangPP).**

Theo dõi các công nghệ AI/LLM được nhắc tới trong sự kiện công khai của GitHub. Ứng dụng nhận diện từ khoá trong commit, PR, issue và các loại sự kiện khác, rồi hiển thị xu hướng, radar trực tiếp và đồ thị công nghệ.

![Giao diện AI Pulse trong chế độ demo](assets/overview.png)

## Chạy ứng dụng

Cần Node.js 18.17 trở lên.

```bash
git clone https://github.com/TienQuangPP/ai-pulse.git
cd ai-pulse
npm start
```

Mở **http://localhost:8787**. Windows có thể chạy `AI-Pulse.bat`; macOS/Linux dùng `sh ai-pulse.sh`.

```bash
npm run demo          # demo ngoại tuyến, dữ liệu mới được sinh khi chạy
npm test              # kiểm thử
docker compose up -d  # chạy bằng Docker
```

## Tính năng

- Tổng quan, radar và luồng sự kiện trực tiếp qua SSE; lọc theo công nghệ, kho mã và người dùng.
- So sánh xu hướng, phát lại cuộc đua công nghệ, đồ thị đồng xuất hiện và cảnh báo theo ngưỡng.
- Phân tích repository, so sánh hai kho mã, danh sách theo dõi và thử bộ nhận diện trên văn bản.
- Nhận định tự động bằng tiếng Việt/Anh; chat Claude tuỳ chọn khi có API key và SDK.
- Nhập/xuất JSON, xuất CSV, báo cáo in/PDF; giao diện sáng/tối, phím tắt và PWA.

Các biểu đồ phản ánh sự kiện được thu thập và từ khoá được nhận diện, không phải toàn bộ mức sử dụng AI trên GitHub. Dữ liệu demo được đánh dấu riêng và có thể xoá trong Cài đặt.

## Cấu hình và dữ liệu

Sao chép `.env.example` thành `.env` hoặc nhập cấu hình trong **Cài đặt**.

| Tuỳ chọn | Công dụng |
|---|---|
| `GITHUB_TOKEN` | Xác thực GitHub API nếu cần |
| `ANTHROPIC_API_KEY` | Chat Claude; chạy `npm install` để cài SDK tuỳ chọn |
| `AIPULSE_MODE` | `live` hoặc `demo`; `npm run demo` luôn chọn demo |
| `AIPULSE_DATA_DIR` | Thư mục dữ liệu khi chạy; mặc định `.runtime/` |
| `HOST`, `PORT` | Mặc định `127.0.0.1:8787` |

Mã nguồn không kèm bộ dữ liệu hay báo cáo dự án cũ. Cấu hình và sự kiện mới được tạo trong `.runtime/`, đã loại khỏi Git; Docker dùng volume riêng. Không đưa `.env`, API key hay dữ liệu cá nhân lên repository.

## Cấu trúc

```text
server/       HTTP, GitHub collector, detector, store, insights và chat
public/       Giao diện PWA, biểu đồ và bản dịch VI/EN
tests/        Kiểm thử bằng node:test
assets/       Banner và ảnh giao diện hiện tại
```

## API chính

| Endpoint | Nội dung |
|---|---|
| `GET /api/status`, `GET /api/summary?range=1h` | Trạng thái và thống kê |
| `GET /api/events`, `GET /api/repos`, `GET /api/developers` | Sự kiện, kho mã, nhà phát triển |
| `GET /api/insights`, `GET /api/ecosystem`, `GET /api/race` | Nhận định và trực quan hoá |
| `GET /api/analyze?repo=owner/name` | Phân tích repository |
| `GET /api/export?format=csv`, `POST /api/import` | Xuất và nhập dữ liệu |
| `GET /api/stream` | SSE |
| `POST /api/ask` | Chat Claude, cần cấu hình API |

Phát triển và duy trì: **[TienQuangPP](https://github.com/TienQuangPP)**. Báo lỗi qua [GitHub Issues](https://github.com/TienQuangPP/ai-pulse/issues).
