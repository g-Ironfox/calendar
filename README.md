# Dayline 日历

一个原生 JavaScript + FastAPI 的日历应用，日程使用 MongoDB 持久化。

## 本地运行

先准备一个可访问的 MongoDB 实例，然后运行：

```powershell
cd webui
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:MONGO_URI = "mongodb://localhost:27017"
$env:MONGO_DATABASE = "calendar"
uvicorn app:app --reload
```

打开 http://127.0.0.1:8000 。`MONGO_URI` 默认连接本机 MongoDB，`MONGO_DATABASE` 默认为 `calendar`。

## Docker Compose

```bash
docker compose up --build -d
```

默认访问 http://localhost:8987 。MongoDB 数据保存在项目根目录 `data/`，并挂载到容器 `/data`。

## 功能

- 类型保存在 MongoDB 中，支持重命名、改色；删除自定义类型时显示关联日程数并可迁移日程
- 月视图、日视图与月-日左右组合视图，支持迷你日历、今天定位及日期导航
- 新建、编辑、删除日程，设置日期、时间、日历分类与备注
- 按日历分类筛选日程
- FastAPI REST API 与 MongoDB 持久化

API 文档可在运行后通过 `/docs` 打开。
