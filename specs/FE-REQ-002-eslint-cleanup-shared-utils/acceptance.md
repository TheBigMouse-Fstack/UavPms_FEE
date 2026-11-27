# [FE-REQ-002] Agreed Acceptance Test List (Gate 5)

> **Gate 5 Rule**: Khóa danh sách kiểm thử này **TRƯỚC KHI** Coding Agent chỉnh sửa `src/`. Mọi tiêu chí dưới đây phải ánh xạ trực tiếp sang lệnh kiểm tra hoặc Vitest unit test trong `src/app/shared/utils/*.spec.ts` và bộ test hiện có.

- **Approved By (QA/PO)**: Human Owner + Control Tower
- **Approved Date**: `2026-11-26`

## 1. Happy Path & Core Behaviors (Gherkin)

```gherkin
Feature: ESLint WIP Cleanup & Shared Parse/Date Utilities

  Scenario: Workspace passes ESLint with zero errors and no suppression hacks
    Given the repository previously had 126 ESLint / Angular template a11y errors across 21 files
    When FE-REQ-002 ESLint cleanup changes are applied
    Then "npm run lint" exits with code 0 and reports 0 errors
    And no new "eslint-disable" directives or rule relaxations are introduced

  Scenario: Shared payload parser safely extracts typed fields from unknown API records
    Given an unknown JSON object containing valid string, number, boolean, and array fields
    When a data-access normalizer calls helpers from "src/app/shared/utils/"
    Then valid values are returned with strict TypeScript types and zero "any" usage
    And malformed or missing fields gracefully return null or the explicit fallback without throwing

  Scenario: Shared date utility validates real Vietnamese calendar dates and formats UTC to UTC+7
    Given a valid date string "29/02/2024" (leap year) and a UTC ISO timestamp "2026-11-26T17:30:00Z"
    When "parseDateInputToIso" parses "29/02/2024"
    Then it returns a valid ISO-8601 UTC string ending with "Z" without calendar rollover
    And formatting "2026-11-26T17:30:00Z" to Vietnam timezone returns "27/11/2026 00:30"
```

## 2. Shared Payload Parse Unit Tests (`payload-parse.util.spec.ts`)

- [x] `asRecord`: chấp nhận plain object `{ a: 1 }`; trả `null` cho `null`, `undefined`, primitive (`"str"`, `123`, `true`), và `Array` (`[1, 2]`) *(+ chặn `Date`/`RegExp`/`Map`/`Set`)*.
- [x] `readString` / `readOptionalString`: trả chuỗi đã chuẩn hóa với string hợp lệ; trả fallback / `undefined` (hoặc `null` theo chữ ký thống nhất) khi giá trị là `null`, `undefined`, chuỗi toàn khoảng trắng, hoặc kiểu số/object.
- [x] `readNumber` / `readOptionalNumber`: chấp nhận số hữu hạn (gồm `0` và số âm hợp lệ); từ chối `NaN`, `Infinity`, `-Infinity`, chuỗi rỗng `""`, `null`, `undefined`, boolean.
- [x] `readBoolean`: xử lý chính xác `true`/`false` và fallback an toàn khi sai kiểu.
- [x] `readArray`: trả mảng khi đầu vào là `Array`, trả `[]` khi đầu vào là `null`/`undefined`/non-array.
- [x] Malformed payload resilience: một trường bị sai kiểu không gây uncaught exception làm sập toàn bộ quá trình normalize.

## 3. Shared Date Parse & Format Unit Tests (`date-format.util.spec.ts`)

- [x] **Invalid calendar dates rejected**: `31/02/2026`, `30/02/2026`, `31/04/2026`, `29/02/2025` (không nhuận), `00/11/2026`, `15/13/2026`, chuỗi rác `"abc"` đều bị từ chối (trả `null`) — không bao giờ tự cuộn sang tháng kế tiếp.
- [x] **Leap year accepted**: `29/02/2024` và `29/02/2028` được parse hợp lệ.
- [x] **Date range & ISO UTC boundaries**: chuyển đổi `dd/MM/yyyy` cho `startOfDay` và `endOfDay` tạo chuỗi ISO-8601 hợp lệ kết thúc bằng `Z`, giữ đúng thứ tự so sánh `dateFrom <= dateTo`.
- [x] **UTC → UTC+7 (`Asia/Ho_Chi_Minh`) formatting**:
  - Mốc chuyển ngày qua nửa đêm UTC (`2026-11-26T17:30:00Z`) hiển thị đúng `27/11/2026 00:30` (độc lập với timezone OS của máy chạy test).
  - Mốc đầu ngày UTC (`2026-11-26T00:05:00Z`) hiển thị đúng `26/11/2026 07:05`.
- [x] **Malformed / empty date input**: `null`, `undefined`, `""`, `"not-a-date"` trả về fallback an toàn (`""` hoặc `"—"`), tuyệt đối không hiển thị `"Invalid Date"`.

## 4. ESLint, Accessibility & Architecture Gates

- [x] `npm run lint` pass với **0 errors** (xác nhận toàn bộ **126 lỗi ESLint trên 21 file** đã xử lý sạch: 77 lỗi TS/spec + 49 lỗi Template A11y).
- [x] Không có directive `eslint-disable` mới thêm vào để né lỗi; không nới lỏng rule trong cấu hình ESLint.
- [x] Toàn bộ 49 lỗi template accessibility trên 7 file HTML/template được khắc phục chuẩn WCAG 2.2 AA (ví dụ: interactive element dùng semantic `<button>` hoặc đủ `tabindex`/`role`/keyboard handler, form control gắn đúng `for`/`id` hoặc `aria-label`).
- [x] `npm run check:arch` pass: `src/app/shared/utils/` không import từ `features/` hoặc `core/`.
- [x] `npm run check:policy` pass: không phát sinh URL bản đồ/AI/analytics bên thứ ba hoặc rò rỉ secret/PII.
- [x] **Human-Approval-Required Zones respected**: trong vùng `src/app/core/auth/**` và `src/app/features/gis/**`, **CHỈ** sửa đúng 2 file unit test đã được Human phê duyệt (`auth.spec.ts` dòng 127 và `gis-monitoring.spec.ts` dòng 6); 0 thay đổi trên file runtime Auth/GIS, `docs/AI_SECURITY_AND_GOVERNANCE.md`, hoặc `.github/workflows/**`.

## 5. Regression, Build & Readability Gate

- [x] Toàn bộ unit test cũ (bao gồm `REQ-001` `reports-page.spec.ts` và các `*-api.spec.ts` liên quan sau khi thay bằng shared utils) vẫn pass: `npx ng test --watch=false` *(59/59 files, 389/389 tests PASS)*.
- [x] `npm run build` thành công với 0 lỗi TypeScript / Angular template.
- [x] `npm run verify:all` pass toàn bộ (`check:policy` + `check:arch` + `lint` + `ng test --watch=false` + `build`) *(chờ CI chạy lại trên snapshot PR sạch không kèm WIP unstaged khi merge)*.
- [x] Diff tuân thủ Small Batch (≤ 300–400 dòng/PR, tách stacked commits `PR-A1` → `PR-A2` → `PR-B1` → `PR-B2` → `PR-B3` → `PR-B4a`/`PR-B4b`) và `.agents/skills/readable-code-defense/SKILL.md` kèm **"Tóm tắt luồng để bảo vệ code"** — toàn bộ đã đạt `APPROVE_FOR_HUMAN_REVIEW` từ Independent Judge.
