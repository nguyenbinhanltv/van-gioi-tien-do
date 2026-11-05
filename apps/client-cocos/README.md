# apps/client-cocos

Placeholder cho dự án client Cocos Creator 3.x (chưa cài Cocos Creator).

Logic không phụ thuộc engine (input, pathfinding, layout HUD) nằm ở `packages/client-core` (`@vgtd/client-core`) để dùng chung và kiểm thử bằng vitest. Thư mục sinh ra của Cocos (`library/`, `temp/`, `local/`, `build/`, `native/`) đã được `.gitignore`.
