from __future__ import annotations

import os
import re
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from typing import AsyncIterator
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator
from pymongo import MongoClient, ReturnDocument
from pymongo.errors import DuplicateKeyError

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
MONGO_DATABASE = os.getenv("MONGO_DATABASE", "calendar")

mongo_client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
events = mongo_client[MONGO_DATABASE]["events"]
categories = mongo_client[MONGO_DATABASE]["categories"]


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    events.create_index([("date", 1), ("start_time", 1), ("title", 1)])
    events.create_index("color")
    categories.create_index("name", unique=True, collation={"locale": "en", "strength": 2})
    yield
    mongo_client.close()


app = FastAPI(title="日历", version="1.0.0", lifespan=lifespan)


class EventInput(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    date: date
    start_time: str = Field(default="", max_length=5)
    end_time: str = Field(default="", max_length=5)
    color: str = Field(min_length=1, max_length=40, pattern="^[a-zA-Z0-9_-]+$")
    notes: str = Field(default="", max_length=1000)

    @field_validator("title")
    @classmethod
    def title_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("标题不能为空")
        return value

    @field_validator("notes")
    @classmethod
    def trim_notes(cls, value: str) -> str:
        return value.strip()


class CategoryInput(BaseModel):
    id: str | None = Field(default=None, min_length=1, max_length=40, pattern="^[a-zA-Z0-9_-]+$")
    name: str = Field(min_length=1, max_length=24)
    color: str = Field(pattern="^#[0-9a-fA-F]{6}$")

    @field_validator("name")
    @classmethod
    def category_name_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("类型名称不能为空")
        return value


class CategoryUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=24)
    color: str = Field(pattern="^#[0-9a-fA-F]{6}$")

    @field_validator("name")
    @classmethod
    def category_name_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("类型名称不能为空")
        return value


def serialize(document: dict) -> dict:
    return {
        "id": document["_id"], "title": document["title"], "date": document["date"],
        "start_time": document["start_time"], "end_time": document["end_time"],
        "color": document["color"], "notes": document["notes"],
    }


def checked_event(event_id: str) -> dict:
    document = events.find_one({"_id": event_id})
    if document is None:
        raise HTTPException(status_code=404, detail="日程不存在")
    return document


def event_document(event: EventInput) -> dict:
    return {
        "title": event.title,
        "date": event.date.isoformat(),
        "start_time": event.start_time,
        "end_time": event.end_time,
        "color": event.color,
        "notes": event.notes,
    }


def serialize_category(document: dict) -> dict:
    return {
        "id": document["_id"], "name": document["name"],
        "color": document["color"], "is_builtin": document.get("is_builtin", False),
        "event_count": events.count_documents({"color": document["_id"]}),
    }


def checked_category(category_id: str) -> dict:
    document = categories.find_one({"_id": category_id})
    if document is None:
        raise HTTPException(status_code=404, detail="日历类型不存在")
    return document


def category_name_taken(name: str, exclude_id: str | None = None) -> bool:
    query: dict = {"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}
    if exclude_id:
        query["_id"] = {"$ne": exclude_id}
    return categories.find_one(query, {"_id": 1}) is not None


@app.get("/api/categories")
def list_categories() -> list[dict]:
    documents = list(categories.find())
    ordered = sorted(
        documents,
        key=lambda document: (document.get("created_at", datetime.min), document["name"].casefold()),
    )
    return [serialize_category(item) for item in ordered]


@app.post("/api/categories", status_code=201)
def create_category(category: CategoryInput) -> dict:
    category_id = category.id or f"custom-{uuid4().hex[:16]}"
    if not category_id.startswith("custom-"):
        raise HTTPException(status_code=400, detail="新类型 ID 必须使用 custom- 前缀")
    if categories.find_one({"_id": category_id}):
        raise HTTPException(status_code=409, detail="类型 ID 已存在")
    if category_name_taken(category.name):
        raise HTTPException(status_code=409, detail="类型名称已存在")
    document = {"_id": category_id, "name": category.name, "color": category.color.upper(), "is_builtin": False, "created_at": datetime.now(timezone.utc)}
    try:
        categories.insert_one(document)
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=409, detail="类型名称或 ID 已存在") from exc
    return serialize_category(document)


@app.patch("/api/categories/{category_id}")
def update_category(category_id: str, update: CategoryUpdate) -> dict:
    checked_category(category_id)
    if category_name_taken(update.name, category_id):
        raise HTTPException(status_code=409, detail="类型名称已存在")
    try:
        document = categories.find_one_and_update(
            {"_id": category_id},
            {"$set": {"name": update.name, "color": update.color.upper()}},
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=409, detail="类型名称已存在") from exc
    return serialize_category(document)


@app.delete("/api/categories/{category_id}")
def delete_category(category_id: str, replacement_id: str | None = Query(default=None)) -> dict:
    checked_category(category_id)
    event_count = events.count_documents({"color": category_id})
    if event_count and not replacement_id:
        raise HTTPException(status_code=409, detail=f"该类型还有 {event_count} 个日程，请选择迁移目标")
    if replacement_id:
        if replacement_id == category_id:
            raise HTTPException(status_code=400, detail="迁移目标不能是待删除类型")
        checked_category(replacement_id)
        events.update_many({"color": category_id}, {"$set": {"color": replacement_id}})
    categories.delete_one({"_id": category_id})
    return {"deleted": category_id, "migrated_events": event_count if replacement_id else 0}


@app.get("/api/health")
def health() -> dict:
    mongo_client.admin.command("ping")
    return {"status": "ok"}


@app.get("/api/events")
def list_events(start: date = Query(...), end: date = Query(...)) -> list[dict]:
    if end < start:
        raise HTTPException(status_code=400, detail="结束日期不能早于开始日期")
    cursor = events.find({"date": {"$gte": start.isoformat(), "$lte": end.isoformat()}}).sort(
        [("date", 1), ("start_time", 1), ("title", 1)]
    )
    return [serialize(document) for document in cursor]


@app.post("/api/events", status_code=201)
def create_event(event: EventInput) -> dict:
    checked_category(event.color)
    document = event_document(event)
    document.update({"_id": str(uuid4()), "created_at": datetime.now(timezone.utc)})
    events.insert_one(document)
    return serialize(document)


@app.put("/api/events/{event_id}")
def update_event(event_id: str, event: EventInput) -> dict:
    checked_category(event.color)
    document = events.find_one_and_update(
        {"_id": event_id}, {"$set": event_document(event)}, return_document=ReturnDocument.AFTER
    )
    if document is None:
        raise HTTPException(status_code=404, detail="日程不存在")
    return serialize(document)


@app.delete("/api/events/{event_id}", status_code=204)
def delete_event(event_id: str) -> Response:
    result = events.delete_one({"_id": event_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="日程不存在")
    return Response(status_code=204)


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")
