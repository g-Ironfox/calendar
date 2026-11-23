from __future__ import annotations

import os
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

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
MONGO_DATABASE = os.getenv("MONGO_DATABASE", "calendar")

mongo_client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
events = mongo_client[MONGO_DATABASE]["events"]


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    events.create_index([("date", 1), ("start_time", 1), ("title", 1)])
    yield
    mongo_client.close()


app = FastAPI(title="日历", version="1.0.0", lifespan=lifespan)


class EventInput(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    date: date
    start_time: str = Field(default="", max_length=5)
    end_time: str = Field(default="", max_length=5)
    color: str = Field(default="blue", min_length=1, max_length=40, pattern="^[a-zA-Z0-9_-]+$")
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
    document = event_document(event)
    document.update({"_id": str(uuid4()), "created_at": datetime.now(timezone.utc)})
    events.insert_one(document)
    return serialize(document)


@app.put("/api/events/{event_id}")
def update_event(event_id: str, event: EventInput) -> dict:
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
