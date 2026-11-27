# [FE-REQ-003] Decommission Removed Modules (Emergency Alerts, Drone Handover & Hide Active Learning)

- **Req ID**: `FE-REQ-003`
- **Phase / Batch**: Đợt 1 FE (chạy song song với BE Đợt 0, **không phụ thuộc `openapi.json` v1.0**)
- **Status**: `confirmed` *(Gate 5 đã khóa ngày 2026-11-27 bởi Human Owner; chọn Phương án 2A cho PR-3: chỉ ẩn hoàn toàn nút/tab/route Active Learning, giữ an toàn mã nền/WIP nghiên cứu)*
- **Owner (BA/PO)**: Control Tower / Frontend Owner
- **Named Approver (Tech/Security)**: Independent PR Review Judge + Human Approver
- **Data Classification** *(per `docs/AI_SECURITY_AND_GOVERNANCE.md`)*: `Internal` (gỡ route/menu/UI thừa; giữ nguyên chuẩn bảo vệ dữ liệu nhạy cảm GIS/UAV/ticket)

## 1. Problem & Goal (What & Why)

Theo [docs/MASTER_SYSTEM_SPEC.md](../../docs/MASTER_SYSTEM_SPEC.md) v1.0 (Mục 2 & Mục 7 — Đợt 1 FE), ba phân hệ cũ đã chính thức bị **loại bỏ hoặc tạm hoãn** trên toàn hệ thống (DB → BE → FE):
1. **Phân hệ Emergency Alert & Edge Device riêng biệt**: Gỡ hoàn toàn (không còn `/api/v1/alerts*`, Escalate riêng hay Vision Edge Webhook). Tính chất "khẩn cấp" chỉ còn là mức độ ưu tiên (`Emergency` | `Normal`) trên khuyết tật (`DetectedAnomalies`) và phiếu bảo trì (`MaintenanceTickets`).
2. **Bàn giao / Trả Drone thủ công (`drone-handover`)**: Gỡ hoàn toàn. Khi Mission chuyển `Completed` hoặc `Cancelled`, Backend tự động trả Drone về trạng thái `Available` và giải phóng `ResourceBookings`.
3. **Active Learning (sửa khung nhãn gửi train lại AI)**: Tạm coi như chưa có (đưa vào backlog nghiên cứu sau), cần **ẩn hoàn toàn khỏi giao diện vận hành** để tránh nút chết/404 và giữ giao diện `Analyst` nhất quán với Đặc tả tổng thể.

**Goal**: Gỡ sạch các điểm vào UI, route, menu, component và API client của `Emergency Alerts` và `drone-handover`, đồng thời ẩn hoàn toàn UI/route `Active Learning` khỏi luồng vận hành — giữ `npm run verify:all` xanh 100%, không gây link gãy (broken route/nav), và bảo toàn 100% nhãn ưu tiên `Emergency` | `Normal` trên khuyết tật/phiếu bảo trì.

## 2. Scope & Non-Goals

- **In Scope**:
  1. **Gỡ `drone-handover` (`PR-1: FE-REQ-003a`)**:
     - Gỡ route, mục điều hướng/menu, nút kích hoạt, dialog/page/component và API calls phục vụ bàn giao/trả Drone thủ công.
     - Cập nhật/gỡ unit test cũ chỉ test `drone-handover`; giữ nguyên toàn bộ màn hình quản lý tài sản Drone (`UAVs`, `Flight Controllers`, `Technical Inspection`).
  2. **Gỡ `Emergency Alerts` (`PR-2: FE-REQ-003b`)**:
     - Gỡ route, mục menu/sidebar, widget dashboard cũ (`analyst-home`, `tower-detail`, `mission-detail`, `standalone-upload`, `analyst-review` callers), pages/components và data-access (`src/app/features/emergency-alerts/`, `emergency-alerts-api.ts`, models chỉ phục vụ `EmergencyAlerts`).
     - Gỡ các lời gọi API `/api/v1/alerts*` (không còn request chết tới endpoint sẽ bị BE gỡ ở Đợt 1) và gỡ mục `EmergencyAlerts` khỏi bộ lọc bảng `AUDIT_TABLE_OPTIONS`.
     - Bảo toàn nguyên vẹn mức độ ưu tiên `Emergency` | `Normal` trên khuyết tật (`DetectedAnomalies`) và phiếu bảo trì (`MaintenanceTickets`), cũng như hệ thống thông báo tổng hợp (`Notifications` / `/hubs/notifications`, gồm `ActiveAlertsPanel` & `PersonalAlertsCard` đọc `/monitor/alerts` và mở `/ai-review?priority=emergency`).
     - *(Ghi nhận phê duyệt Human Owner 2026-11-27)*: Đã duyệt sửa tối thiểu 3 file trong `src/app/core/auth/**` (`roles.ts`, `route-access.ts`, `route-access.spec.ts` — chỉ gỡ `ROUTE_ROLES.emergencyAlerts`); giữ nguyên 100% `src/app/features/gis/**` (Phương án A, xử lý ở Đợt 2 `FE-REQ-004`).
  3. **Ẩn `Active Learning` (`PR-3: FE-REQ-003c`)**:
     - Ẩn toàn bộ điểm vào UI (nút sửa khung nhãn gửi train lại AI, tab/panel/route `Active Learning`) khỏi màn hình `Analyst Review` và điều hướng; bảo đảm không phát sinh request API Active Learning nào từ luồng vận hành.
     - Không hiển thị mục menu hoặc điều khiển bị vô hiệu hóa gây nhầm lẫn cho người dùng/hội đồng bảo vệ.
  4. **Tài liệu & Truy vết**: `specs/FE-REQ-003-decommission-removed-modules/*` và `specs/RTM.md`.
- **Small Batch Split Rule (≤ 350–400 dòng sửa/thêm mỗi PR)**:
  - **PR-1 (`FE-REQ-003a`)**: Gỡ `drone-handover` (routes, menu, UI, API, tests).
  - **PR-2 (`FE-REQ-003b`)**: Gỡ `Emergency Alerts` (tách riêng nếu cần: PR-2a gỡ dây nối route/menu/widget + PR-2b xóa thư mục dead code `emergency-alerts/` để người review dễ đọc).
  - **PR-3 (`FE-REQ-003c`)**: Ẩn `Active Learning` khỏi UI/route vận hành (sau khi Human chốt cách xử lý WIP `analyst-review/`).
- **Non-Goals (Explicitly Out of Scope)**:
  - Không thay đổi hợp đồng API của các phân hệ còn lại (chờ `docs/contracts/openapi.json` v1.0 từ BE ở Đợt 1).
  - Không xóa hoặc đổi ngữ nghĩa mức độ ưu tiên `Emergency` | `Normal` trên `DetectedAnomalies` và `MaintenanceTickets`.
  - Không sửa 9 chỗ bản đồ online → PMTiles (thuộc `FE-REQ-004`).
  - Không bỏ dropdown `preferredModel` hay đổi ràng buộc upload media (thuộc `FE-REQ-005`).
  - **Human-Approval-Required Zones**: Trong bước khảo sát đầu tiên, nếu Coding Agent phát hiện điểm import/hiển thị `Emergency Alerts` hoặc `drone-handover` nằm trong `src/app/core/auth/**` hoặc `src/app/features/gis/**`, Coding Agent **phải DỪNG và báo danh sách file/dòng cụ thể để Human phê duyệt** trước khi sửa các file đó.
  - **Ranh giới WIP unstaged**: Không tự ý `git checkout`/xóa mất các file WIP unstaged đang có trong `src/app/features/analyst-review/*`, `maintenance-detail.*`, `standalone-upload.html` khi chưa có chỉ thị rõ từ Human Owner.

## 3. Navigation, Routing & Fallback Contract

- Mọi URL cũ của phân hệ đã gỡ (`/alerts`, `/emergency-alerts`, `/drone-handover`, hoặc route riêng của `active-learning` nếu có) không còn tồn tại trong cấu hình router (truy cập trực tiếp rơi về trang fallback/404 hoặc redirect chuẩn của app mà không throw console error).
- Thanh điều hướng (`Sidebar` / `Header` / `Dashboard` quick links) không còn hiển thị mục `Cảnh báo khẩn cấp (Alerts)`, `Bàn giao Drone`, hay `Active Learning` cho bất kỳ role nào trong 5 role chuẩn (`SystemAdmin`, `Manager`, `Inspector`, `Analyst`, `Technician`).
- Kiểm tra không còn tham chiếu chuỗi route hoặc endpoint `/api/v1/alerts`, `drone-handover` trong `src/app/` (ngoại trừ các nhãn mức độ ưu tiên `Emergency` hợp lệ của khuyết tật và phiếu bảo trì).

## 4. Security, Privacy, Readability & NFRs

- [x] `npm run check:policy` pass (không phát sinh URL bản đồ/AI/analytics bên thứ ba hoặc rò rỉ secret/PII).
- [x] `npm run check:arch` pass (không còn import mồ côi hay vi phạm biên giữa `core/`, `shared/`, `features/`).
- [x] `npm run lint` đạt **0 errors, 0 warnings** (không thêm `eslint-disable`, bảo toàn chuẩn WCAG 2.2 AA).
- [x] Tuân thủ `.agents/skills/readable-code-defense/SKILL.md`: không để lại code chết (`dead code`), biến/import thừa, comment "TODO tạm ẩn" mập mờ; giải thích rõ bằng tiếng Việt khi giữ lại bất kỳ phần nền nào cho backlog Active Learning.
- [x] Full verification gate: `npm run verify:all` (`check:policy` + `check:arch` + `lint` + `ng test --watch=false` + `build`) xanh 100% sau mỗi PR.
