@AGENTS.md

## Tài liệu Bất biến & Quy tắc Theo Vùng
- Hiến pháp kỹ thuật (bị khóa bởi hook): `.specify/memory/constitution.md`
- Quy tắc phạm vi hẹp (tự nạp theo file đang sửa): `.claude/rules/`
- Kiểm tra đối chiếu Spec siêu nhẹ: subagent `spec-checker` (`.claude/agents/spec-checker.md`)

## Compact instructions
Khi chạy `/compact` hoặc tóm tắt ngữ cảnh, BẮT BUỘC giữ lại nguyên văn:
1. Mã `REQ-ID` đang làm (ví dụ `FE-REQ-006`) và các mã `FR-xxx`, `HC-xx` liên quan.
2. Trạng thái `SDD_PHASE` hiện tại (`SPEC` | `RED` | `CODE`) và danh sách file test trong `.claude/locked-tests.txt`.
3. Danh sách chính xác đường dẫn file đã sửa trong slice hiện tại.
4. Lỗi ESLint / Vitest / Policy / Architecture hoặc Playwright chưa được xử lý xong.
5. Quyết định đồng bộ FE↔BE gần nhất trong `docs/contracts/HANDOFF.md`.
