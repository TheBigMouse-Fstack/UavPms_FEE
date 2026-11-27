# UAV-PMS — Tài liệu Hiện trạng MVP, Danh sách Vấn đề & Kế hoạch Hành động (v2.0 — Zero-Context Ready)

> **Mục đích**: Tài liệu gọn, dễ hiểu theo góc nhìn **BA/PO & Điều phối nhóm** (đọc nhanh 5 phút), giúp cả nhóm (**FE, BE, QA**) và **bất kỳ AI Agent mới nào chưa có ngữ cảnh** nắm ngay:
> 1. Hiện trạng mới nhất của FE & BE.
> 2. Toàn bộ vấn đề thực tế đang phát hiện + hướng sửa rõ ràng ở cả 2 đầu.
> 3. Các phần đã cắt bỏ / hoãn khỏi MVP.
> 4. Quy tắc Commit, Mở PR, Test tay (Manual Test) và **Mẫu Prompt Zero-Context** để giao việc không bị lan man.
>
> **Nguồn đặc tả chi tiết kỹ thuật**: [MASTER_SYSTEM_SPEC.md](./MASTER_SYSTEM_SPEC.md) (v2.0 — khóa ngày `2026-11-27`).

---

## 1. Hiện trạng mới nhất (Tính đến `2026-11-27`)

### Frontend (Angular 21 — `d:\UavPms_FEE`)
- **Nền tảng & Chất lượng**: Sạch `0` lỗi lint/A11y, đã gom hàm dùng chung vào `src/app/shared/utils/` (ngày giờ Việt Nam `UTC+7`), 400/400 unit tests xanh.
- **Đã dọn sạch khỏi MVP**: Gỡ *Bàn giao Drone thủ công*, gỡ *Cảnh báo khẩn cấp riêng* (giữ nguyên mức ưu tiên **Khẩn cấp / Bình thường**), và **ẩn Active Learning**.
- **Bản đồ nội bộ (Offline GIS)**: Đã chuyển **4/6 màn hình bản đồ** (Giám sát GIS + Tạo/Chi tiết/Thực hiện Nhiệm vụ) sang `evnspc-south-z12.pmtiles` + sơ đồ lưới nội bộ (`0` gọi Google/OSM).
- **Đang chờ chốt**: Re-review bản sửa Check-in realtime & đồng nhất Kết quả giám định AI (`FE-REQ-005`), sửa 2 lỗi nhỏ PR lên Vercel (`A1`).

### Backend (.NET 9 — `D:\UavPms_BEE`)
- **Đã khóa an toàn ở bản local**: Đóng đường công khai `/ai-service` & `/hangfire` trên Gateway; gỡ 5 hàm tự phát SignalR của client trên `NotificationHub`.
- **Hạ tầng kiểm tra**: Đã có GitHub Actions CI cô lập, preflight không auto-migrate khi deploy, khóa 5 workflow migration cũ.
- **Lưu ý môi trường**: Server `uavpms.ddns.net` đang giữ bản ổn định cũ để test/demo; các bản vá mới ở local sẽ đẩy lên sau khi bổ sung 3 biến `.env` trên VPS.

---

## 2. Toàn bộ Vấn đề đang có & Hướng sửa (FE + BE)

### Nhóm A — Sửa NGAY để thông Luồng chính & Demo

| # | Vấn đề thực tế / Yêu cầu chốt | Phía FE (`d:\UavPms_FEE`) | Phía BE (`D:\UavPms_BEE`) |
|---|---|---|---|
| **A1** | **PR FE lên Vercel báo 2 lỗi CI khi ghép `main`** | Sửa 1 lỗi `any` ở `drone-management.spec.ts:144` và gỡ 1 tham chiếu `EmergencyAlertsApi` còn sót ở dòng 40 → push lại. | Không cần sửa. |
| **A2** | **Đang dùng bị văng đăng xuất khi hết hạn Access Token** | Bổ sung **Silent Refresh Token** chạy ngầm trước khi token hết hạn + tự xếp hàng retry request khi gặp `401`; chỉ out khi Refresh Token hết hạn/bị thu hồi. | Bảo đảm endpoint `refresh-token` ổn định và cho phép `SystemAdmin` cấu hình thời lượng phiên trong `SystemSettings`. |
| **A3** | **Check-in chưa realtime (phải F5) & phải check GPS bán kính 50m tại Cột 1** | *(Đã sửa phần reload & polling ở `FE-REQ-005`)* Bổ sung gửi tọa độ GPS thiết bị khi Check-in và chỉ cho **`Inspector`** (cùng `SystemAdmin`) bấm Check-in. | `CheckInAsync` bắt buộc đối chiếu GPS hiện tại với **Cột thứ tự 1** trong **bán kính `50m`** (đọc từ `SystemSettings`) và **phát SignalR realtime** ngay khi Check-in xong. |
| **A4** | **Xem Kết quả giám định báo 403, lệch giữa các role, nhiều chữ `N/A` và vẫn còn chữ `"AI Review"` sau khi duyệt** | *(Đã đồng bộ trạng thái/cột/BBox ở `FE-REQ-005`)* **Bỏ chữ `"AI Review"`** sau khi đã duyệt (`Đã xác nhận`/`Đã loại bỏ`/`Đã khắc phục`); **xóa sạch `N/A`** (hiện ngày giờ `UTC+7` / `"Chưa gắn cột"` / ẩn dòng trống); **đồng nhất UI** cho mọi role. | Mở quyền **Xem** defect cho mọi thành viên có trong Mission (`Manager`, `Inspector`, `Analyst`, `Technician`) + `SystemAdmin`; chỉ **`Analyst` trong Mission đó** (và `SystemAdmin`) mới được **Duyệt**. |
| **A5** | **Danh sách không tự đưa mục mới nhất lên đầu** | Mặc định mọi List/Table/Grid (Defects `/ai-review`, Missions, Tickets, Notifications, Reports...) sắp xếp **mới nhất, gần nhất lên trên**. | API danh sách mặc định `OrderByDescending` theo thời gian mới nhất (`DetectedAt` / `CreatedAt` DESC). |
| **A6** | **Deploy BE lên VPS bị dừng ở bước kiểm Compose** | Không ảnh hưởng. | Thêm 3 biến `RABBITMQ_USER`, `RABBITMQ_PASSWORD`, `REDIS_PASSWORD` vào file `.env` trên VPS `uavpms.ddns.net`. |

### Nhóm B — Hoàn thiện Nghiệp vụ Chuẩn & Vận hành (MVP Đợt 1–3)

| # | Hạng mục nghiệp vụ đã chốt | Phía FE | Phía BE |
|---|---|---|---|
| **B1** | **`SystemAdmin` toàn quyền tuyệt đối + `SystemSettings`** | Mở toàn bộ chức năng & bỏ lọc vùng trên UI cho `SystemAdmin`; làm màn hình `SystemSettings` cho `SystemAdmin` chỉnh bán kính Check-in (`50m`), ngưỡng Pre-Mission, lịch Hangfire, dung lượng upload (`20MB`/`200MB`), TTL phiên. | Bỏ giới hạn `UserGeographicScopes` với `SystemAdmin` và cho phép `SystemAdmin` đi qua mọi quyền của 4 role còn lại; hoàn thiện `/api/v1/system-settings`. |
| **B2** | **Tách BIST/FC sang Chi tiết Drone; bỏ khỏi Pre-Mission; MF01 chọn số lượng → MF02 chọn 3 role** | Trong **Chi tiết Drone**: mở nút BIST, sức khỏe Drone, đọc FC & **nhập thủ công BIST** cho **`Technician` / `SystemAdmin`**. Trong **Pre-Mission (MF01)**: bỏ phần kiểm tra Drone, chỉ chọn Drone đạt chuẩn + **số lượng nhân sự từng role**. Sang **MF02**: chọn đích danh **3 role (`Inspector`, `Analyst`, `Technician`)** và cả 3 phải bấm **Xác nhận (`Accept`)**. | Lưu trạng thái kỹ thuật từ Chi tiết Drone; MF01 chỉ lưu số lượng nhân sự theo role; MF02 ép đủ 3 role `Accept` mới chuyển `Confirmed` (còn Check-in thì chỉ `Inspector` + `SystemAdmin`). |
| **B3** | **Ảnh EXIF GPS + Video live GPS (không ép chọn cột khi upload)** | Form upload ảnh/video **không bắt buộc chọn cột**; màn hình chi tiết cho phép `Analyst` đổi cột thủ công sau khi AI gắn cột gần nhất. | Đọc **EXIF GPS** ảnh và **chụp frame lỗi từ video GPS live** → AI xử lý xong tự gắn với cột gần nhất trong Mission (`TowerId` nullable). |
| **B4** | **Tự động gán Phiếu Bảo trì + Notification chia Role + Chống Duplicate Popup** | Khử trùng lặp Toast/Popup theo ID/sự kiện để không bao giờ nhảy 2 popup; hiển thị rõ thông báo theo từng vai trò. | Khi `Analyst` `Approve` defect thuộc Mission → tự tạo Phiếu bảo trì và **tự gán thẳng cho `Technician` của Mission đó (`Assigned`)**. Chia đúng người nhận thông báo (giao việc, trả lời nhận việc, kết quả AI, bảo trì 2 chiều `Technician` ↔ `Manager`) + mỗi sự kiện phát đúng 1 event SignalR + Hangfire cron đọc từ `SystemSettings`. |
| **B5** | **Telemetry MF03 (RAM/SignalR, delay ≤ 10s) & Bản đồ Offline 100%** | Nhận telemetry qua SignalR `/hubs/telemetry` lên bản đồ Local GIS; chuyển nốt **2 màn Tiền nhiệm vụ** sang PMTiles offline (`6/6`). | Trung chuyển telemetry thật từ phần cứng/Mission Planner qua SignalR `/hubs/telemetry` (delay `≤ 10s`), **không script giả lập**, **không ghi DB** (DROP hoặc để trống bảng `DroneTelemetry`). |
| **B6** | **Bảo mật P0 còn lại, Dọn DB & Chuẩn Code sạch** | Gom hết helper/utils về `src/app/shared/utils/`, không duplicate, không code 1 dòng khó đọc, comment ngắn đúng chỗ quan trọng. | Hoàn thiện `P0-4` (Notification IDOR/Relay/Allowlist), `P0-1` (ChangePassword + thu hồi phiên), `P0-2` (OTP Redis + SMTP thật, bỏ `"123456"`), `CreateUser`, DROP 4 bảng thừa & xuất `openapi.json` v1.0. |

---

## 3. Những gì CẮT BỎ / HOÃN khỏi MVP

- **Cắt bỏ hoàn toàn**: Phân hệ *Emergency Alerts & Edge Device riêng* (chỉ giữ mức ưu tiên `Emergency` | `Normal`), *Bàn giao Drone thủ công (`drone-handover`)*, *Lịch kiểm tra định kỳ (`InspectionSchedules`)*, *Màn hình kiểm tra kỹ thuật Drone trong Pre-Mission*, và *Ghi lịch sử Telemetry xuống Database*.
- **Tạm hoãn sau MVP**: *Active Learning* (đã ẩn khỏi UI vận hành), *tự động hóa hạ tầng SRE phức tạp* (như tự sửa `pg_hba.conf` hay dựng cluster DB thứ 2).

---

## 4. Quy tắc Commit, Mở PR & Test Manual (Cả nhóm tuân thủ)

### Khi nào Commit?
1. **1 đầu việc gọn xong = 1 commit ngay** (build & unit test mục tiêu đã xanh).
2. **Working tree phải sạch**: Code làm dở (WIP) không thuộc việc hiện tại **bắt buộc cất sang nhánh `wip/<tên>`** trước khi bắt đầu việc mới.
3. **Không dùng `git add .` bừa bãi**: Chỉ stage đúng các file của đầu việc đó.

### Khi nào Mở PR vào `main`?
1. **1 PR = 1 lát nghiệp vụ/lỗi trọn vẹn (~250–450 dòng)** — trừ refactor cơ học hoặc xóa dead code có thể gom theo phân hệ.
2. **Điều kiện ghép PR**: CI GitHub xanh 100% + đã qua **1 lượt Independent Review Judge** (chỉ chặn lỗi thật, không soi SRE ngân hàng, tối đa 1 vòng sửa) + đã test tay trên **Vercel Preview** (với FE).
3. **An toàn Demo**: Không deploy BE lên server thật sát giờ Demo khi bản cũ đang ổn định.

### 4 Thời điểm BẮT BUỘC phải tự Test Manual (trên trình duyệt)
| Thời điểm | Việc cần kiểm tra bằng mắt |
|---|---|
| **1. Trước khi giao AI sửa lỗi** (5–10 phút) | Chạy luồng thật trên trình duyệt, chụp ảnh UI + tab `Network`/`Console` để giao đúng gốc lỗi cho AI. |
| **2. Ngay sau khi AI sửa xong** (5 phút) | Test chéo trên **đủ tài khoản vai trò liên quan** (`SystemAdmin`, `Manager`, `Inspector`, `Analyst`, `Technician`) để bảo đảm đồng nhất UI & đúng quyền. |
| **3. Trước khi bấm Merge PR (Vercel Preview)** (5 phút) | Mở thử các màn hình vừa chạm + kiểm tra `Console`/`Network` sạch lỗi đỏ. |
| **4. Trước giờ Demo ít nhất 60 phút** (15–20 phút) | **Freeze code hoàn toàn**, chạy nháp trọn kịch bản từ Login → GIS offline → Check-in → Upload → Duyệt → Bảo trì. |

---

## 5. Mẫu Prompt Zero-Context (Dán cho AI Agent Mới Làm Việc Ngay, Không Lan Man)

> Dùng mẫu này mỗi khi mở một phiên **Antigravity / Claude / Codex** mới chưa có ngữ cảnh:

### Mẫu A — Giao việc cho FE / BE Coding Agent
```markdown
Vai trò: [Frontend Engineer (d:\UavPms_FEE) / Backend Engineer (D:\UavPms_BEE)].
Nhiệm vụ duy nhất lượt này: [<Mã REQ / Lỗi A2, B2...> — mô tả đúng 1 việc cần làm].
Mốc cần xong: [<VD: Demo 14h / Chốt Đợt X>].

Đọc BẮT BUỘC trước khi sửa code (CHỈ đọc đúng 4 tài liệu này, không quét lan man):
1. `docs/MASTER_SYSTEM_SPEC.md` (v2.0 — chỉ đọc đúng mục liên quan nhiệm vụ trên)
2. `docs/contracts/HANDOFF.md`
3. `AGENTS.md`
4. `.agents/skills/readable-code-defense/SKILL.md`

Ràng buộc bắt buộc:
- Chỉ sửa đúng 1 Vertical Slice gọn, tuyệt đối không đụng file WIP hay màn hình không liên quan; không tự ý sửa vùng Human-Approval-Required (`core/auth/**`, `features/gis/**`, `IdentityService/Auth`, `.github/workflows/**`) nếu chưa xin phép.
- Tái sử dụng helper/utils có sẵn (`src/app/shared/utils/` hoặc `Shared`), KHÔNG copy-paste hàm trùng lặp, KHÔNG tạo class dư thừa, KHÔNG viết one-liner khó đọc, KHÔNG comment tràn lan (chỉ comment ngắn chỗ nghiệp vụ quan trọng).
- Mọi danh sách mặc định mới nhất lên đầu; mọi UI đồng nhất giữa các role; không để chữ `N/A` vô nghĩa hoặc chữ `"AI Review"` sau khi đã duyệt.
- Khi lặp chỉ chạy test đúng spec/project đang sửa; chạy full gate (`npm run verify:all` hoặc `dotnet test`) đúng 1 lần chốt cuối, rồi ghi 2 dòng cập nhật vào `docs/contracts/HANDOFF.md` + **"Tóm tắt luồng để bảo vệ code"** (5 dòng) rồi DỪNG.
```

### Mẫu B — Giao việc cho Independent Review Judge (nên dùng model khác chấm chéo cho Tier 1)
```markdown
Vai trò: Independent PR Review Judge (READ-ONLY, tuyệt đối không sửa code).
Đọc `.agents/skills/pr-review-judge/SKILL.md` và `docs/MASTER_SYSTEM_SPEC.md` (chỉ phần liên quan slice này).
Kiểm tra `git diff` hiện tại theo đúng trần thực dụng (MVP / đồ án tốt nghiệp — KHÔNG soi mức Banking SRE):
- Chỉ đánh Blocking cho: sai nghiệp vụ trong `MASTER_SYSTEM_SPEC.md` v2.0, hở bảo mật P0/RBAC/PII/Local GIS thật, lỗi runtime/compile, test giả xanh, duplicate helper hoặc code quá khó trace.
- Tối đa 3 gợi ý Non-blocking; trả Verdict `APPROVE_FOR_HUMAN_REVIEW` hoặc `CHANGES_REQUESTED`.
```
