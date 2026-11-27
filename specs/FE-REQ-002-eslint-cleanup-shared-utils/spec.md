# [FE-REQ-002] ESLint WIP Cleanup & Shared Parse/Date Utilities

- **Req ID**: `FE-REQ-002`
- **Phase / Batch**: Đợt 0 (chạy song song với `BE-REQ-001`, không phụ thuộc `openapi.json` v1.0)
- **Status**: `confirmed` *(Gate 5 đã khóa ngày 2026-11-26 bởi Human Owner)*
- **Owner (BA/PO)**: Control Tower / Frontend Owner
- **Named Approver (Tech/Security)**: Independent PR Review Judge + Human Approver
- **Data Classification** *(per `docs/AI_SECURITY_AND_GOVERNANCE.md`)*: `Internal` (chỉ cấu trúc code, utility thuần và synthetic scrubbed fixtures trong unit test)

## 1. Problem & Goal (What & Why)

Trong lúc Backend (`D:\UavPms_BEE`) thực hiện Đợt 0 (`BE-REQ-001`), Frontend (`d:\UavPms_FEE`) còn hai khoản nợ kỹ thuật cần dọn sạch để làm nền sạch trước Đợt 1:
1. Khảo sát thực tế `npm run lint` ghi nhận **126 lỗi ESLint trên 21 file** (gồm **77 lỗi TypeScript/Unit Test** và **49 lỗi Angular Template A11y WCAG 2.2 AA**, lớn hơn ghi chú WIP cũ là 24 lỗi) khiến `npm run lint` chưa xanh hoàn toàn.
2. Các hàm tiện ích parse payload JSON (`record()`, `stringValue()`, `optionalString()`, `numberValue()`, ...) và hàm parse/format ngày `dd/MM/yyyy` (chuyển ISO UTC / hiển thị `UTC+7`) đang bị copy–paste rải rác ở nhiều feature, vi phạm quy tắc Anti Helper Bloat trong `.agents/skills/readable-code-defense/SKILL.md` và dễ phát sinh lỗi ngày lịch không tồn tại (như `31/02/2026`).

**Goal**:
- Đưa `npm run lint` về **0 errors** bằng cách sửa đúng bản chất toàn bộ **126 lỗi ESLint/A11y trên 21 file** (không dùng `eslint-disable` để che lỗi, không nới luật lint).
- Xây dựng bộ utility thuần, strict TypeScript (`unknown` boundary, zero `any`) tại `src/app/shared/utils/` cho **JSON payload parsing** và **date parsing/formatting (`dd/MM/yyyy`, UTC ↔ `UTC+7`)**, kèm unit test Vitest đầy đủ, và thay thế các helper trùng lặp ở các feature trong phạm vi Small Batch.

## 2. Scope & Non-Goals

- **In Scope**:
  - Sửa toàn bộ **126 lỗi ESLint / Template A11y trên 21 file** hiện tại trong `src/app/` (tuân thủ Angular 21: không `any`, không `ngClass`/`ngStyle`, không `@HostBinding`/`@HostListener`, `OnPush`, native control flow, WCAG 2.2 AA; riêng `emergency-alerts-api.ts`, `active-alerts-panel.spec.ts` và `notifications-realtime.ts` chỉ sửa đúng lỗi lint, không đổi hành vi SignalR/Alert).
  - Tạo mới các utility dùng chung thuần (pure functions, không phụ thuộc `HttpClient` hay `features/`) trong `src/app/shared/utils/`:
    - `payload-parse.util.ts` + `payload-parse.util.spec.ts` (đọc an toàn từ `unknown`: `asRecord`, `readString`, `readOptionalString`, `readNumber`, `readOptionalNumber`, `readBoolean`, `readArray`).
    - `date-format.util.ts` + `date-format.util.spec.ts` (validate ngày lịch thật `dd/MM/yyyy`, chuyển biên ngày sang ISO-8601 UTC kết thúc bằng `Z`, định dạng hiển thị tiếng Việt theo `UTC+7` `dd/MM/yyyy` và `dd/MM/yyyy HH:mm` với timezone tường minh `Asia/Ho_Chi_Minh`, không gọi `new Date()` không kiểm soát).
    - `index.ts` (barrel export gọn cho `src/app/shared/utils/`).
  - Refactor các helper parse/date bị trùng lặp ở các feature (bắt đầu từ các file đã có/dễ kiểm chứng nhất) sang import từ `src/app/shared/utils/`.
  - Tài liệu đặc tả & truy vết: `specs/FE-REQ-002-eslint-cleanup-shared-utils/*` và `specs/RTM.md`.
- **Small Batch Split Rule (≤ 300–400 dòng diff/PR — đã chốt 2026-11-26)**:
  - **PR-A1**: Dọn toàn bộ **126 lỗi ESLint/A11y trên 21 file** (nếu vượt ~400 dòng diff thì tách gọn thành **PR-A1a**: 77 lỗi TS/spec trên 14 file → **PR-A1b**: 49 lỗi Template A11y WCAG 2.2 AA trên 7 file) để chốt `npm run lint` = **0 errors** & `npm run verify:all` xanh 100%.
  - **PR-A2**: Tạo `src/app/shared/utils/` (`payload-parse.util.ts`, `date-format.util.ts`, `index.ts`) kèm full Vitest unit tests (`*.spec.ts`).
  - **PR-B**: Thay thế các helper parse/date copy–paste trong các feature sang `src/app/shared/utils/`.
- **Non-Goals (Explicitly Out of Scope)**:
  - Không thay đổi hợp đồng API REST/SignalR (chờ `docs/contracts/openapi.json` v1.0 ở Đợt 1).
  - Không gỡ các phân hệ `Alerts`, `drone-handover`, `Active Learning` trong batch này (thuộc Đợt 1).
  - Không sửa 9 điểm bản đồ online sang PMTiles trong batch này (thuộc Đợt 2).
  - Không sửa logic nghiệp vụ hoặc giao diện ngoài phạm vi sửa lỗi lint/A11y và gom helper.
  - **Human-Approval-Required Zones (Phê duyệt có điều kiện ngày 2026-11-26)**: Human Owner đã duyệt cho phép sửa **CHỈ 2 file unit test** (`src/app/core/auth/auth.spec.ts` dòng 127 — 1 lỗi `no-explicit-any` và `src/app/features/gis/gis-monitoring.spec.ts` dòng 6 — 2 lỗi `no-unused-vars`). **Cấm tuyệt đối** chạm bất kỳ file runtime nào trong `src/app/core/auth/**`, `src/app/features/gis/**`, `docs/AI_SECURITY_AND_GOVERNANCE.md`, hoặc `.github/workflows/**`.

## 3. Architectural & Utility Contract

### 3.1. Boundary Constraints (`npm run check:arch`)
- `src/app/shared/utils/*` **chỉ chứa pure TypeScript utilities**; tuyệt đối không import từ `src/app/features/**` hay `src/app/core/**`, không inject `HttpClient`.
- Chỉ `features/<domain>/data-access/` mới được parse raw API payload (sử dụng `src/app/shared/utils/`). Component không tự parse raw API response.

### 3.2. Shared Utility Semantics
1. **Payload Parse (`src/app/shared/utils/payload-parse.util.ts`)**:
   - Mọi đầu vào có kiểu `unknown` (không dùng `any`).
   - `asRecord(value: unknown): Record<string, unknown> | null` — trả `null` với `null`, `undefined`, primitive, hoặc `Array`.
   - `readString(record, key, fallback?)` / `readOptionalString(record, key)` — trim hợp lý, xử lý non-string an toàn.
   - `readNumber(record, key, fallback?)` / `readOptionalNumber(record, key)` — từ chối `NaN`, `Infinity`, `-Infinity`, chuỗi rỗng.
   - `readBoolean(record, key, fallback?)` và `readArray(value)` — không throw runtime error với payload dị dạng (`malformed`).
2. **Date Parse & Format (`src/app/shared/utils/date-format.util.ts`)**:
   - Khớp quy tắc **Múi giờ** trong `docs/MASTER_SYSTEM_SPEC.md` (Mục 5.7): BE/ISO lưu **100% UTC (`Z`)**, FE hiển thị **100% tiếng Việt theo `UTC+7` (`dd/MM/yyyy HH:mm`)**.
   - Parse `dd/MM/yyyy` phải kiểm tra **ngày lịch thật** (từ chối `31/02/2026`, `31/04/2026`, `29/02/2025`, tháng `<1` hoặc `>12`; chấp nhận năm nhuận `29/02/2024`, `29/02/2028`).
   - Khi truyền giá trị ngày `null` / `undefined` / chuỗi lỗi, hàm format trả về fallback an toàn (ví dụ `''` hoặc `'—'`) thay vì `'Invalid Date'`.
   - Không phụ thuộc múi giờ máy local của trình duyệt khi format `UTC+7` (dùng múi giờ tường minh `Asia/Ho_Chi_Minh` hoặc phép dịch offset `+07:00` xác định rõ để test chạy nhất quán trên mọi CI runner).

## 4. Security, Privacy, Readability & NFRs

- [x] `npm run check:policy` pass (không thêm URL bản đồ/AI/analytics bên thứ ba, không lộ secret/PII/log nhạy cảm).
- [x] `npm run check:arch` pass (không vi phạm biên layer `shared/` ↔ `features/`).
- [x] `npm run lint` đạt **0 errors** (không thêm `eslint-disable` né lỗi, không sửa `eslint.config.*` để tắt luật).
- [x] Tuân thủ `.agents/skills/readable-code-defense/SKILL.md`: không nested ternary, `if` tối đa 2 cấp (guard clauses), không magic strings/numbers, hàm gọn 15–40 dòng, comment tiếng Việt giải thích *TẠI SAO*, kèm "Tóm tắt luồng để bảo vệ code" sau khi hoàn thành.
- [x] WCAG 2.2 AA: mọi lỗi template accessibility trong 24 lỗi ESLint phải được sửa bằng ngữ nghĩa HTML/ARIA chuẩn (`<button>`, `aria-label`, `for`/`id`, keyboard handler, v.v.).
- [x] Full verification gate: `npm run verify:all` (`check:policy` + `check:arch` + `lint` + `ng test --watch=false` + `build`) xanh 100%.
