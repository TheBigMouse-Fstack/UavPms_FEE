# [FE-REQ-101] Agreed Acceptance Test List (Gate 5 — Locked TDD)

> **Gate 5 Rule**: Danh sách test này PHẢI được chốt trước khi Coding Agent sửa `src/`. Mọi test phải chứng minh hành vi từ `spec.md`, không bao giờ sửa assertion theo bug của code.

- **Approved By (QA/PO)**: `Control Tower + Human Owner`
- **Approved Date**: `2026-11-27`

---

## 0. Quy trình Khóa Test Chống Gian Lận (`RED → LOCK → GREEN`)

*Bắt buộc cho toàn bộ lát cắt **Tier 1** (RBAC UI Gating + Pre-Mission State Readiness):*
1. **Pha `RED`** (`SDD_PHASE=RED`): Viết test thất bại (RED) cho từng `FR-001..FR-006` & `HC-02..HC-04` ở bảng dưới (`*.acceptance.spec.ts` hoặc file spec chỉ định), chạy xác nhận fail đúng lý do.
2. **Khóa File Test**: Ghi đường dẫn tương đối file test vào `.claude/locked-tests.txt` (nếu nằm ngoài `e2e/` / `tests/acceptance/` / `*.acceptance.spec.ts`).
3. **Pha `CODE`** (mặc định `SDD_PHASE=CODE`): Hook `.claude/hooks/protect-sdd-and-tests.mjs` tự động chặn (`exit 2`) mọi thao tác sửa file test đã khóa — Agent chỉ được sửa `src/` cho đến khi GREEN.

---

## 1. Bảng Ánh xạ `FR-xxx` / `HC-xx` ↔ Test Case (Given-When-Then)

| Mã Spec | Kịch bản Gherkin (Given / When / Then) | Loại Test & File Đích | Trạng thái |
|---|---|---|---|
| `FR-001` | **Given** `Technician` hoặc `SystemAdmin` mở Chi tiết Drone **When** đọc FC (kể cả khi thiếu thông số) hoặc nhập tay BIST + ghi chú và Lưu **Then** gọi đúng API `OperationsService`, cập nhật nhãn `Đạt chuẩn / Sẵn sàng` hoặc `Không đạt / Cần bảo trì`, **báo đỏ các thông số thiếu** và vẫn cho nhập thêm thủ công bổ sung (`BRL-04`), đẩy bản ghi mới lên đầu lịch sử `UTC+7` | `Vitest` (`src/app/features/.../*.spec.ts`) | `[ ] RED -> GREEN` |
| `FR-002` | **Given** `Manager` hoặc `Inspector` (không kiêm `Technician`/`SystemAdmin`) mở Chi tiết Drone **When** view render **Then** hiển thị lịch sử BIST/FC chỉ đọc, ẩn/disable toàn bộ nút chạy BIST, kết nối FC và form nhập tay | `Vitest` (`src/app/features/.../*.spec.ts`) | `[ ] RED -> GREEN` |
| `FR-003` | **Given** `Manager` hoặc `SystemAdmin` mở tạo/chi tiết Pre-Mission (MF01) **When** thao tác lập hồ sơ **Then** không hiển thị bước/form BIST nội bộ và chỉ cho chọn Drone `Đạt chuẩn / Sẵn sàng` thuộc đúng vùng (`regionId`) của hồ sơ MF01 (`BRL-01`) | `Vitest` (`src/app/features/.../*.spec.ts`) | `[ ] RED -> GREEN` |
| `FR-004` | **Given** `Manager` hoặc `SystemAdmin` cấu hình nhân sự MF01 **When** nhập số lượng nguyên dương cho 3 role (`Inspector`, `Analyst`, `Technician`) **Then** form Reactive gửi đúng payload headcount theo hợp đồng `BE-REQ-101` (không ép chọn user cụ thể) | `Vitest` (`src/app/features/.../*.spec.ts`) | `[ ] RED -> GREEN` |
| `FR-005` | **Given** dữ liệu chi tiết Drone hoặc Pre-Mission có trường tùy chọn rỗng **When** UI render **Then** ẩn gọn hoặc hiển thị nhãn tiếng Việt hợp lệ, tuyệt đối không render `"N/A"` | `Vitest` (`src/app/features/.../*.spec.ts`) | `[ ] RED -> GREEN` |
| `FR-006` | **Given** API trả `400` (`INVALID_ROLE_HEADCOUNT`, `METRICS_REQUIRED`)/`403`/`409` (`DRONE_NOT_READY`, `DRONE_REGION_MISMATCH`, `FC_ALREADY_PAIRED`)/lỗi mạng khi lưu BIST/FC hoặc MF01 **When** người dùng submit **Then** giữ nguyên dữ liệu form, hiển thị thông báo lỗi `role="alert"` và không crash/lộ raw payload | `Vitest` (`src/app/features/.../*.spec.ts`) | `[ ] RED -> GREEN` |
| `HC-02` | **Given** user giữ multi-role (`Manager + Technician`) **When** mở Chi tiết Drone **Then** union quyền cho phép hiển thị và thao tác BIST/FC | `Vitest` (`src/app/features/.../*.spec.ts`) | `[ ] RED -> GREEN` |
| `HC-03` | **Given** danh sách lịch sử BIST/FC và Pre-Mission **When** render **Then** format ngày `dd/MM/yyyy HH:mm` `UTC+7` qua `src/app/shared/utils/` và sắp xếp mới nhất lên đầu (`DESC`) | `Vitest` (`src/app/features/.../*.spec.ts`) | `[ ] RED -> GREEN` |
| `HC-04` | **Given** `data-access/` parse payload BE **When** nhận `unknown` payload **Then** validate an toàn, không dùng `any`, tuân thủ ranh giới `shared/` vs `features/` | `Vitest` + `check:arch` + `lint` | `[ ] RED -> GREEN` |

```gherkin
Feature: Drone Detail BIST/FC (Manual + Serial) & MF01 Role Headcount

  Scenario: Technician saves manual BIST result on Drone Detail
    Given người dùng đăng nhập hợp lệ với role "Technician"
    When mở Chi tiết Drone, nhập thông số BIST thủ công kèm ghi chú và bấm Lưu
    Then giao diện hiển thị trạng thái "Đạt chuẩn / Sẵn sàng" hoặc "Không đạt / Cần bảo trì" với mốc thời gian UTC+7
    And payload gửi lên BE khớp hợp đồng trong HANDOFF.md

  Scenario: Manager creates MF01 Pre-Mission with Ready drones and role counts only
    Given người dùng đăng nhập hợp lệ với role "Manager"
    When mở màn tạo Pre-Mission, chọn Drone sẵn sàng và nhập số lượng 3 role (Inspector, Analyst, Technician)
    Then UI không hiển thị bước kiểm tra BIST trong Pre-Mission và gửi payload số lượng nhân sự chuẩn
```

---

## 2. Auth, RBAC & Session Edge Cases

- [ ] Người dùng chưa đăng nhập bị chuyển về `/login`, không lộ dữ liệu nhạy cảm.
- [ ] `SystemAdmin` thao tác được cả Chi tiết Drone (BIST/FC/nhập tay) lẫn MF01 trên mọi vùng; các role khác tuân thủ đúng ma trận RBAC & multi-role union.

---

## 3. Data Integrity, Ordering & UI Consistency

- [ ] Payload null/thiếu trường hoặc list rỗng không làm crash UI và tuyệt đối không hiển thị `"N/A"`.
- [ ] Lịch sử BIST/FC tại Chi tiết Drone và danh sách Pre-Mission mặc định sắp xếp item mới nhất lên đầu (`DESC`).
- [ ] Không chứa tọa độ thật, JWT, email thật hay raw payload nhạy cảm trong log/test.

---

## 4. Accessibility (WCAG 2.2 AA) & Static Gates

- [ ] Điều khiển hoàn toàn bằng bàn phím (`Tab`, `Enter`, `Escape`); form nhập tay BIST & form số lượng nhân sự MF01 có label/error với `role="alert"` đạt chuẩn WCAG 2.2 AA.
- [ ] `npm run check:policy`, `npm run check:arch`, `npm run lint`, targeted Vitest và `npm run verify:all` (trước PR) pass 100%.
