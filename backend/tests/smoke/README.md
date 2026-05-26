# Backend Smoke Test

后端冒烟测试固定入口。

## 默认快速冒烟

不调用真实聊天模型，不消耗模型额度。覆盖：

1. `/health`
2. `/api/models/chat`
3. 模型文件元数据：`file_accept` / `supported_file_extensions` / `supported_file_mime_types`
4. 未登录保护边界
5. 匿名 guest 文件上传
6. SQLite 中验证：`files.parse_status = done`、解析内容存在、`file_chunks` 已生成
7. guest 文件访问隔离

```bash
cd /workspace/aipool/backend
python3 tests/smoke/backend_smoke.py
```

默认地址：`http://localhost:9091`  
默认 DB：`/workspace/aipool/backend/data/aipool.db`

## 指定地址/DB

```bash
python3 tests/smoke/backend_smoke.py \
  --base-url http://localhost:9091 \
  --db /workspace/aipool/backend/data/aipool.db
```

也可以用环境变量：

```bash
AIPOOL_BASE_URL=http://localhost:9091 python3 tests/smoke/backend_smoke.py
```

## 带真实聊天冒烟

会调用 `/api/chat`，可能消耗模型额度。用于发布前最终验证。

```bash
python3 tests/smoke/backend_smoke.py --chat --model gpt-5.4-mini
```

也可以指定：

```bash
AIPOOL_SMOKE_MODEL=gpt-5.4-mini python3 tests/smoke/backend_smoke.py --chat
```

## 预期输出

成功最后会看到：

```text
[smoke] PASS
```

失败会输出：

```text
[smoke] FAIL: ...
```

## 注意

- 脚本不会启动/停止后端服务；运行前确保后端已在 `9091` 或指定地址可访问。
- DB 读取使用复制 `aipool.db` + `-wal` + `-shm` 的方式，避免直接读线上 SQLite 时状态不一致。
- 默认只上传一个临时 markdown 文件，测试数据会保留在当前 DB 中，文件名为 `smoke.md`。
