# [FE-REQ-XXX] Tên Tính năng / Lát cắt

- **Req ID**: `FE-REQ-XXX` *(bất biến, không tái sử dụng)*
- **Status**: `DRAFT` | `FROZEN (Approved by BA/PO at commit <sha>)`
- **Risk Tier**: `Tier 1 (Auth/GIS/RBAC/Upload/State)` | `Tier 2 (UI/Business)` | `Tier 3 (CI/Docs)`
- **Owner (BA/PO)**: `<tên>`
- **Named Approver (Judge / Tech-Security)**: `<tên khác người code>`
- **Data Classification** *(theo `docs/AI_SECURITY_AND_GOVERNANCE.md`)*: `Public` | `Internal` | `Sensitive` | `Restricted`

---

## 1. Problem & Goal (What & Why)

<!-- Nêu ngắn gọn lỗi/nghiệp vụ thực tế từ docs/MASTER_SYSTEM_SPEC.md v2.0, role tác động (5 role chuẩn + SystemAdmin full), và kết quả đo được. -->

---

## 2. Hard Constraints (`HC-xx` — Bất biến, Vi phạm = Fail)

- **HC-01**: Không dùng bản đồ/tile/CDN ngoài (`C-01`); mọi map phải qua `src/app/shared/gis/local-gis.ts`.
- **HC-02**: Không log JWT, OTP, mật khẩu, email thật, GPS thô, ảnh UAV; không giữ chữ `"AI Review"` sau khi duyệt và không để `"N/A"` (`C-03`, `C-05`).
- **HC-03**: Tái sử dụng helper dùng chung trong `src/app/shared/utils/`; code tuyến tính `if/return` tối đa 2 cấp (`C-06`).
- **HC-04**: *(Thêm ràng buộc bất biến riêng của REQ này, ví dụ: chỉ `Analyst` của Mission hoặc `SystemAdmin` được bấm duyệt).*

---

## 3. Functional Requirements (Cú pháp EARS / GEARS)

> **Quy tắc**: Mọi hành vi phải gắn mã `FR-xxx` theo 4 mẫu EARS chuẩn để ánh xạ 1–1 sang `acceptance.md`.

- **FR-001 [Event]**: WHEN `<điều kiện kích hoạt / hành động người dùng>`, THE `<Component/Store>` SHALL `<hành vi & kết quả cụ thể>`.
- **FR-002 [State]**: WHILE `<trạng thái đang diễn ra>`, WHEN `<sự kiện xảy ra>`, THE `<Component/Store>` SHALL `<hành vi tương ứng>`.
- **FR-003 [Config]**: WHERE `<cấu hình / quyền role hoặc SystemSettings được bật>`, WHEN `<hành vi xảy ra>`, THE `<Component/Store>` SHALL `<xử lý theo cấu hình>`.
- **FR-004 [Error]**: IF `<lỗi HTTP 401/403/409/5xx, payload thiếu, hoặc mất mạng>`, THEN THE `<Component/Store>` SHALL `<xử lý an toàn không crash, không lộ stack trace>`.

---

## 4. API / SignalR / RBAC Contract

- **Referenced Endpoints** *(từ `docs/contracts/openapi.json` & `docs/MASTER_SYSTEM_SPEC.md`)*:
  - `GET /api/v1/...` *(mặc định sắp xếp mới nhất lên đầu `DESC`)*
- **SignalR Events** *(từ `docs/contracts/HANDOFF.md`)*:
  - Hub `/hubs/...` → Event `...` *(kèm key dedupe popup nếu có toast)*
- **RBAC Matrix**:
  - Allowed roles: `SystemAdmin`, `...`
  - Denied / Read-only roles: `...`
- **Shared Layer Rules**:
  - `data-access/` chỉ parse payload `unknown` → domain model; hiển thị ngày qua helper `UTC+7`; toàn bộ list mặc định mới nhất lên đầu.

---

## 5. Out of Scope (Cấm AI tự ý thêm)

- Không thêm nút/luồng ngoài danh sách `FR-xxx` ở trên.
- Không sửa `specs/`, `.specify/memory/constitution.md`, hay test đã khóa trong pha `CODE`.
