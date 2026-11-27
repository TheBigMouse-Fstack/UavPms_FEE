# [FE-REQ-XXX] Agreed Acceptance Test List (Gate 5 — Locked TDD)

> **Gate 5 Rule**: Danh sách test này PHẢI được chốt trước khi Coding Agent sửa `src/`. Mọi test phải chứng minh hành vi từ `spec.md`, không bao giờ sửa assertion theo bug của code.

- **Approved By (QA/PO)**: `<tên>`
- **Approved Date**: `YYYY-MM-DD`

---

## 0. Quy trình Khóa Test Chống Gian Lận (`RED → LOCK → GREEN`)

*Bắt buộc cho toàn bộ lát cắt **Tier 1** (Auth/Silent Refresh, GIS, Check-in 50m, RBAC Defect, Upload):*
1. **Pha `RED`** (`SDD_PHASE=RED`): Viết test thất bại (RED) cho từng `FR-xxx` / `HC-xx` ở bảng dưới (`*.acceptance.spec.ts` hoặc `e2e/*.spec.ts` hoặc file unit spec chỉ định), chạy xác nhận fail đúng lý do.
2. **Khóa File Test**: Ghi đường dẫn tương đối file test vào `.claude/locked-tests.txt` (nếu nằm ngoài `e2e/` / `tests/acceptance/` / `*.acceptance.spec.ts`).
3. **Pha `CODE`** (mặc định `SDD_PHASE=CODE`): Hook `.claude/hooks/protect-sdd-and-tests.mjs` tự động chặn (`exit 2`) mọi thao tác sửa file test đã khóa — Agent chỉ được sửa `src/` cho đến khi GREEN.

---

## 1. Bảng Ánh xạ `FR-xxx` / `HC-xx` ↔ Test Case (Given-When-Then)

| Mã Spec | Kịch bản Gherkin (Given / When / Then) | Loại Test & File Đích | Trạng thái |
|---|---|---|---|
| `FR-001` | **Given** ... **When** ... **Then** ... | `Vitest` (`src/...spec.ts`) | `[ ] RED -> GREEN` |
| `FR-002` | **Given** ... **When** ... **Then** ... | `Playwright` (`e2e/...spec.ts`) | `[ ] RED -> GREEN` |
| `HC-01` | Không phát request map/CDN ngoài khi ngắt mạng | `Policy + E2E` | `[ ] RED -> GREEN` |

```gherkin
Feature: <Tên Tính năng>

  Scenario: Happy path đúng theo FR-001
    Given người dùng đăng nhập hợp lệ với role "<Role>"
    When người dùng thực hiện "<hành động>"
    Then giao diện hiển thị "<kết quả UTC+7, không AI Review/N/A>"
    And payload gửi lên BE khớp hợp đồng OpenAPI
```

---

## 2. Auth, RBAC & Session Edge Cases

- [ ] Người dùng chưa đăng nhập bị chuyển về `/login`, không lộ dữ liệu nhạy cảm.
- [ ] `SystemAdmin` thao tác được mọi vùng & mọi tính năng; 4 role còn lại bị chặn/ẩn đúng `UserGeographicScopes` và RBAC.
- [ ] Access Token sắp hết hạn tự Silent Refresh ngầm; gặp `401` chỉ gọi 1 lần refresh và retry request, không văng đăng xuất.

---

## 3. Data Integrity, Ordering & UI Consistency

- [ ] Payload null/thiếu trường hoặc list rỗng không làm crash UI và không hiển thị `"N/A"`.
- [ ] Toàn bộ danh sách mặc định sắp xếp item mới nhất / gần nhất lên đầu (`DESC`).
- [ ] Popup Notification không bị bật trùng 2 lần cho 1 sự kiện.
- [ ] Tab Kết quả giám định đồng nhất giữa các role trong Mission (trạng thái thật, `towerCode`, BBox `0..100%`, không còn `"AI Review"` sau khi duyệt).

---

## 4. Accessibility (WCAG 2.2 AA) & Static Gates

- [ ] Điều khiển hoàn toàn bằng bàn phím (`Tab`, `Enter`, `Escape`); form error & toast có ARIA role đúng.
- [ ] `npm run check:policy`, `npm run check:arch`, `npm run lint`, targeted Vitest và `npm run verify:all` (trước PR) pass 100%.
