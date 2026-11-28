# [FE-REQ-101] Drone Detail BIST/FC (Kèm Nhập Tay) & MF01 Headcount Only

- **Req ID**: `FE-REQ-101` *(bất biến, không tái sử dụng)*
- **Status**: `FROZEN (Approved by Control Tower & Human Owner — PR Lớn 1, chờ đồng bộ DTO từ BE-REQ-101 trước khi code)`
- **Risk Tier**: `Tier 1 (RBAC UI Gating + Pre-Mission State Readiness)`
- **Owner (BA/PO)**: `Control Tower / Frontend Owner`
- **Named Approver (Judge / Tech-Security)**: `Codex Diff Auditor + Human Owner`
- **Data Classification** *(theo `docs/AI_SECURITY_AND_GOVERNANCE.md`)*: `Sensitive` (thông số kỹ thuật UAV, vùng địa lý lưới điện — không log raw payload, test dùng dữ liệu synthetic scrubbed)

---

## 1. Problem & Goal (What & Why)

Đồng bộ Frontend theo `docs/MASTER_SYSTEM_SPEC.md` v2.0 (Mục 2, Mục 4, Mục 5 Luồng 2 & Phụ lục 8.1) trong **PR Lớn 1**:
1. Trên màn **Chi tiết Drone (`Drone Detail`)**: cung cấp khu vực kiểm tra kỹ thuật BIST / kết nối đọc thông số Serial FC **và biểu mẫu nhập thủ công thông số BIST / sức khỏe Drone + ghi chú kiểm định**, cập nhật nhãn chuẩn `Đạt chuẩn / Sẵn sàng` (`Ready`) | `Không đạt / Cần bảo trì` (`MaintenanceRequired`). Chỉ hiển thị/mở thao tác ghi cho `Technician` và `SystemAdmin` (hỗ trợ multi-role union); `Manager` và `Inspector` chỉ xem kết quả/lịch sử; `Analyst` không có quyền thao tác.
2. Trên các màn **Pre-Mission Assessment (MF01)**: gỡ bỏ hoàn toàn bước/tab/panel kiểm tra kỹ thuật BIST/FC Drone khỏi luồng tạo & thẩm định Pre-Mission; danh sách chọn Drone chỉ cho chọn Drone `Đạt chuẩn / Sẵn sàng` (kế thừa từ màn Chi tiết Drone); khu vực Nhân sự chuyển sang **chỉ nhập/chọn SỐ LƯỢNG nhân sự theo 3 role** (`Inspector`, `Analyst`, `Technician`) thay vì chọn đích danh từng cá nhân.

---

## 2. Hard Constraints (`HC-xx` — Bất biến, Vi phạm = Fail)

- **HC-01**: Mọi bản đồ liên quan dùng `src/app/shared/gis/local-gis.ts` (`/maps/evnspc-south-z12.pmtiles` + schematic fallback, 0 request online) (`C-01`).
- **HC-02**: Phân quyền chuẩn 5 role + multi-role union (`SystemAdmin` full quyền; chỉ `Technician` + `SystemAdmin` thao tác BIST/FC tại Drone Detail; chỉ `Manager` + `SystemAdmin` tạo/duyệt MF01) (`C-02`).
- **HC-03**: Hiển thị thời gian `UTC+7` (`dd/MM/yyyy HH:mm`) qua `src/app/shared/utils/`; cấm tuyệt đối hiển thị chữ `"N/A"`; lịch sử kiểm định mới nhất lên đầu (`DESC`) (`C-04`, `C-05`).
- **HC-04**: Angular 21 (`OnPush`, signals, `inject()`, Reactive Forms, native `@if`/`@for`, không `any`), chỉ `data-access/` được gọi `HttpClient`/parse `unknown`; code tuyến tính theo `readable-code-defense/SKILL.md`, WCAG 2.2 AA (`C-06`).
- **HC-05**: Không chạm `src/app/core/auth/**`, `src/app/features/gis/**`, `docs/AI_SECURITY_AND_GOVERNANCE.md`, `.github/workflows/**`. Tuân thủ `RED → LOCK → GREEN` (`C-07`).

---

## 3. Functional Requirements (Cú pháp EARS / GEARS)

> **Quy tắc**: Mọi hành vi phải gắn mã `FR-xxx` theo 4 mẫu EARS chuẩn để ánh xạ 1–1 sang `acceptance.md`.

- **FR-001 [Event — Drone Detail FC, Manual BIST & Missing-Metric Alert]**: WHEN user có role `Technician` hoặc `SystemAdmin` mở màn Chi tiết Drone và thực hiện đọc thông số FC (Serial/API) hoặc điền biểu mẫu nhập thủ công thông số BIST/sức khỏe Drone + ghi chú rồi bấm Lưu, THE `Drone Detail Feature` SHALL gửi payload chuẩn lên API `OperationsService`, cập nhật ngay trạng thái `Đạt chuẩn / Sẵn sàng` hoặc `Không đạt / Cần bảo trì` và đẩy bản ghi mới nhất lên đầu lịch sử kiểm định (`UTC+7`). **`[BRL-04]`**: Khi kết quả đọc FC hoặc kiểm tra trả về thiếu thông số bắt buộc (hoặc mất kết nối), UI SHALL **báo đỏ rõ các thông số bị thiếu** (không điền giả `0%` hay `"Betaflight"` nếu không có) và **vẫn mở biểu mẫu cho phép `Technician`/`SystemAdmin` nhập thêm thủ công** bổ sung thông số còn thiếu.
- **FR-002 [Config — Drone Detail RBAC View vs Edit]**: WHERE user đăng nhập là `Manager` hoặc `Inspector` (không kiêm `Technician`/`SystemAdmin`), WHEN mở màn Chi tiết Drone, THE `Drone Detail Feature` SHALL hiển thị đầy đủ trạng thái kỹ thuật và lịch sử BIST/FC ở chế độ chỉ đọc (ẩn/vô hiệu hóa nút chạy BIST, kết nối FC và form nhập tay).
- **FR-003 [Event — Remove BIST from MF01 & Region-Scoped Ready Drones]**: WHEN `Manager` hoặc `SystemAdmin` mở màn tạo/chi tiết Pre-Mission (MF01), THE `Pre-Mission Feature` SHALL không hiển thị bước/form chạy kiểm tra BIST/FC trực tiếp trên Pre-Mission và chỉ cho phép chọn các Drone có trạng thái kỹ thuật `Đạt chuẩn / Sẵn sàng` **thuộc đúng vùng (`regionId`) của hồ sơ MF01** (`BRL-01`, áp dụng cho cả `SystemAdmin`; hiển thị liên kết/trạng thái rõ ràng nếu Drone `Không đạt / Cần bảo trì`).
- **FR-004 [Event — MF01 Role Headcount Form]**: WHEN `Manager` hoặc `SystemAdmin` cấu hình nhân sự trong MF01, THE `Pre-Mission Feature` SHALL hiển thị các ô nhập số lượng nguyên dương theo 3 role (`Inspector`, `Analyst`, `Technician`) dùng Reactive Forms (không bắt chọn tên người dùng cụ thể) và gửi đúng số lượng theo hợp đồng `BE-REQ-101`.
- **FR-005 [State — Pre-Mission Validity & No N/A]**: WHILE hiển thị chi tiết Drone hoặc Pre-Mission, WHEN có trường ghi chú/thông số tùy chọn bị trống, THE UI SHALL ẩn gọn hoặc hiển thị nhãn tiếng Việt rõ nghĩa, tuyệt đối không render chuỗi `"N/A"`.
- **FR-006 [Error — API Validation & 403/409 Handling]**: IF API trả lỗi `400` (`INVALID_ROLE_HEADCOUNT`, `METRICS_REQUIRED`)/`403`/`409` (`DRONE_NOT_READY`, `DRONE_REGION_MISMATCH`, `FC_ALREADY_PAIRED`)/mất kết nối khi lưu BIST/FC hoặc lưu MF01, THEN THE Feature Store/Component SHALL giữ nguyên dữ liệu form đang nhập, hiển thị thông báo lỗi tiếng Việt rõ ràng có `role="alert"` / ARIA chuẩn và không crash hoặc lộ raw payload.

---

## 4. API / SignalR / RBAC Contract

- **Referenced Endpoints** *(từ `docs/contracts/HANDOFF.md` sau khi `BE-REQ-101` hoàn thành và đối chiếu `docs/contracts/openapi.json`)*:
  - Endpoints lấy/lưu BIST & thông số FC tại Chi tiết Drone (`OperationsService`, lịch sử sắp xếp mới nhất lên đầu `DESC`).
  - Endpoints tạo/cập nhật/duyệt Pre-Mission Assessment (`OperationsService`, chỉ truyền `inspectorCount`, `analystCount`, `technicianCount`).
- **RBAC Matrix**:
  - Drone Detail ghi BIST/FC/nhập tay: `SystemAdmin`, `Technician`.
  - Drone Detail chỉ đọc BIST/FC: `Manager`, `Inspector`.
  - MF01 tạo/duyệt: `SystemAdmin`, `Manager`.
- **Shared Layer Rules**:
  - `data-access/` chỉ parse payload `unknown` → domain model; hiển thị ngày qua helper `UTC+7` (`src/app/shared/utils/`); toàn bộ list mặc định mới nhất lên đầu.

---

## 5. Out of Scope (Cấm AI tự ý thêm)

- Không làm MF02 chọn đích danh 3 role / 3 nút `Accept` / Check-in GPS `50m` / Telemetry `/hubs/telemetry` ở lát cắt này (thuộc PR Lớn 2).
- Không chạm `src/app/core/auth/**`, `src/app/features/gis/**`, `docs/AI_SECURITY_AND_GOVERNANCE.md`, `.github/workflows/**`.
- Không thêm nút/luồng ngoài danh sách `FR-001..FR-006` ở trên.
- Không sửa `specs/`, `.specify/memory/constitution.md`, hay test đã khóa trong pha `CODE`.
