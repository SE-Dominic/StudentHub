#to activate virtual environment use "source .venv/bin/activate"
#to run application locally, use "uvicorn main:app --reload"
import os
import base64
import binascii
import asyncio
import hashlib
import hmac
import json
import time
import urllib.error
import urllib.request
from datetime import date as DateType, datetime, time as TimeType, timezone
from typing import Literal

import bcrypt
from fastapi import Depends, FastAPI, HTTPException, Security, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator
from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Integer, JSON, String, Time, create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, declarative_base, sessionmaker

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg://studenthub:studenthub@localhost:5432/studenthub",
)

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


class UserModel(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String(320), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)


class TaskModel(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(120), nullable=False)
    completed = Column(Boolean, nullable=False, default=False)


class CalendarTaskModel(Base):
    __tablename__ = "calendarTasks"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(120), nullable=False)
    description = Column(String(1000), nullable=False, default="")
    kind = Column(String(20), nullable=False)
    calendar_date = Column("date", Date, nullable=False, index=True)
    start_time = Column(Time, nullable=True)
    end_time = Column(Time, nullable=True)
    reminder_at = Column(DateTime(timezone=True), nullable=True)
    completed = Column(Boolean, nullable=False, default=False)


class ClassFolderModel(Base):
    __tablename__ = "classFolders"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    class_name = Column(String(100), nullable=False)
    subject = Column(String(100), nullable=False)
    active = Column(Boolean, nullable=False, default=True)


class ClassNoteModel(Base):
    __tablename__ = "classNotes"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    folder_id = Column(Integer, ForeignKey("classFolders.id", ondelete="SET NULL"), nullable=True, index=True)
    title = Column(String(160), nullable=False)
    sequence = Column(String(30), nullable=False)
    content = Column(String(20000), nullable=False, default="")
    drawings = Column(JSON, nullable=False, default=list)


class Credentials(BaseModel):
    email: EmailStr
    password: str

    @field_validator("password")
    @classmethod
    def password_must_fit_bcrypt(cls, value: str) -> str:
        if len(value.encode("utf-8")) > 72:
            raise ValueError("Password must be 72 bytes or fewer")
        return value


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)

    @field_validator("title")
    @classmethod
    def title_must_not_be_blank(cls, value: str) -> str:
        title = value.strip()
        if not title:
            raise ValueError("Task title cannot be blank")
        return title


class TaskUpdate(BaseModel):
    completed: bool


class TaskResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    completed: bool


class CalendarTaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=1000)
    kind: Literal["task", "event", "reminder"]
    date: DateType
    start_time: TimeType | None = None
    end_time: TimeType | None = None
    reminder_at: datetime | None = None

    @field_validator("title")
    @classmethod
    def calendar_title_must_not_be_blank(cls, value: str) -> str:
        title = value.strip()
        if not title:
            raise ValueError("Title cannot be blank")
        return title

    @field_validator("description")
    @classmethod
    def strip_description(cls, value: str) -> str:
        return value.strip()

    @field_validator("reminder_at")
    @classmethod
    def reminder_must_include_timezone(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("Reminder time must include a timezone")
        return value

    @model_validator(mode="after")
    def end_time_must_follow_start_time(self):
        if self.start_time is not None and self.end_time is not None and self.end_time <= self.start_time:
            raise ValueError("End time must be later than start time")
        return self


class CalendarTaskResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    description: str
    kind: str
    date: DateType = Field(validation_alias="calendar_date")
    start_time: TimeType | None
    end_time: TimeType | None
    reminder_at: datetime | None
    completed: bool


class CalendarTaskUpdate(BaseModel):
    completed: bool


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=2000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=20)
    timezone: str = Field(default="UTC", min_length=1, max_length=100)
    current_date: DateType


class ClassFolderCreate(BaseModel):
    class_name: str = Field(min_length=1, max_length=100)
    subject: str = Field(min_length=1, max_length=100)

    @field_validator("class_name", "subject")
    @classmethod
    def strip_folder_fields(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Class and subject are required")
        return cleaned


class ClassFolderUpdate(BaseModel):
    class_name: str | None = Field(default=None, min_length=1, max_length=100)
    subject: str | None = Field(default=None, min_length=1, max_length=100)
    active: bool | None = None

    @field_validator("class_name", "subject")
    @classmethod
    def strip_optional_folder_fields(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Class and subject cannot be blank")
        return cleaned


class ClassFolderResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    class_name: str
    subject: str
    active: bool


class DrawingPoint(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class DrawingElement(BaseModel):
    kind: Literal["pen", "line", "arrow", "rectangle", "ellipse", "text"]
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    line_style: Literal["solid", "dashed", "dotted"]
    points: list[DrawingPoint] = Field(min_length=1, max_length=1000)
    text: str | None = Field(default=None, max_length=4000)
    width: float | None = Field(default=None, gt=0, le=1)
    height: float | None = Field(default=None, gt=0, le=1)
    font_scale: float = Field(default=1, ge=0.8, le=4)

    @model_validator(mode="after")
    def text_box_must_have_text(self):
        if self.kind == "text" and self.text is None:
            raise ValueError("Text boxes must include text")
        return self


class ClassNoteCreate(BaseModel):
    folder_id: int | None = None
    title: str = Field(min_length=1, max_length=160)
    sequence: str = Field(min_length=1, max_length=30)
    content: str = Field(default="", max_length=20000)
    drawings: list[DrawingElement] = Field(default_factory=list, max_length=300)

    @field_validator("title", "sequence")
    @classmethod
    def strip_note_fields(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Page title and sequence are required")
        return cleaned


class ClassNoteUpdate(BaseModel):
    folder_id: int | None = None
    title: str = Field(min_length=1, max_length=160)
    sequence: str = Field(min_length=1, max_length=30)
    content: str = Field(default="", max_length=20000)
    drawings: list[DrawingElement] = Field(default_factory=list, max_length=300)

    @field_validator("title", "sequence")
    @classmethod
    def strip_updated_note_fields(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Page title and sequence are required")
        return cleaned


class ClassNoteResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    folder_id: int | None
    title: str
    sequence: str
    content: str
    drawings: list[DrawingElement]


app = FastAPI()
bearer_scheme = HTTPBearer()
TOKEN_SECRET = os.getenv("TOKEN_SECRET", "change-this-development-secret")

# Allow your frontend to talk to your backend (Cross-Origin Resource Sharing)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def create_tables():
    Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_token(user_id: int) -> str:
    payload = f"{user_id}:{int(time.time())}".encode("utf-8")
    encoded_payload = base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")
    signature = hmac.new(TOKEN_SECRET.encode("utf-8"), encoded_payload.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{encoded_payload}.{signature}"


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(bearer_scheme),
    db: Session = Depends(get_db),
) -> UserModel:
    try:
        encoded_payload, signature = credentials.credentials.split(".", 1)
        expected_signature = hmac.new(
            TOKEN_SECRET.encode("utf-8"), encoded_payload.encode("ascii"), hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(signature, expected_signature):
            raise ValueError
        payload = base64.urlsafe_b64decode(encoded_payload + "===")
        user_id = int(payload.decode("utf-8").split(":", 1)[0])
    except (ValueError, IndexError, UnicodeDecodeError, binascii.Error):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication token")

    user = db.query(UserModel).filter(UserModel.id == user_id, UserModel.is_active.is_(True)).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User account is not active")
    return user

@app.get("/")
def home_root():
    return {"API success": "true"}

@app.post("/signup", status_code=status.HTTP_201_CREATED)
def add_user(data: Credentials, db: Session = Depends(get_db)):
    email = str(data.email).lower()
    user = UserModel(
        email=email,
        password_hash=bcrypt.hashpw(
            data.password.encode("utf-8"), bcrypt.gensalt()
        ).decode("utf-8"),
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists",
        )

    return {"status": "success", "token": create_token(user.id), "user": {"id": user.id, "email": user.email}}


@app.post("/login")
def login(data: Credentials, db: Session = Depends(get_db)):
    email = str(data.email).lower()
    user = db.query(UserModel).filter(UserModel.email == email).first() #going into database and finding the first occurence of the email then storing it in a variable
    if user is None or not bcrypt.checkpw(
        data.password.encode("utf-8"), user.password_hash.encode("utf-8")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )
    print(f"Login successful ID: {user.id}, {user.email}")
    return {"status": "success", "token": create_token(user.id), "user": {"id": user.id, "email": user.email}}


@app.get("/tasks", response_model=list[TaskResponse])
def list_tasks(current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    return (
        db.query(TaskModel)
        .filter(TaskModel.user_id == current_user.id)
        .order_by(TaskModel.id.asc())
        .all()
    )


@app.post("/tasks", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
def add_task(
    data: TaskCreate,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = TaskModel(user_id=current_user.id, title=data.title, completed=False)
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@app.patch("/tasks/{task_id}", response_model=TaskResponse)
def update_task(
    task_id: int,
    data: TaskUpdate,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = (
        db.query(TaskModel)
        .filter(TaskModel.id == task_id, TaskModel.user_id == current_user.id)
        .first()
    )
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    task.completed = data.completed
    db.commit()
    db.refresh(task)
    return task


@app.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    task_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = (
        db.query(TaskModel)
        .filter(TaskModel.id == task_id, TaskModel.user_id == current_user.id)
        .first()
    )
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    db.delete(task)
    db.commit()


@app.get("/calendarTasks", response_model=list[CalendarTaskResponse])
def list_calendar_tasks(
    start_date: DateType,
    end_date: DateType,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if end_date < start_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="End date must not be before start date",
        )
    return (
        db.query(CalendarTaskModel)
        .filter(
            CalendarTaskModel.user_id == current_user.id,
            CalendarTaskModel.calendar_date >= start_date,
            CalendarTaskModel.calendar_date <= end_date,
        )
        .order_by(CalendarTaskModel.calendar_date, CalendarTaskModel.start_time, CalendarTaskModel.id)
        .all()
    )


def build_calendar_task(data: CalendarTaskCreate, user_id: int) -> CalendarTaskModel:
    return CalendarTaskModel(
        user_id=user_id,
        title=data.title,
        description=data.description,
        kind=data.kind,
        calendar_date=data.date,
        start_time=data.start_time,
        end_time=data.end_time,
        reminder_at=data.reminder_at.astimezone(timezone.utc) if data.reminder_at else None,
        completed=False,
    )


def save_calendar_task(data: CalendarTaskCreate, user_id: int, db: Session) -> CalendarTaskModel:
    task = build_calendar_task(data, user_id)
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@app.post("/calendarTasks", response_model=CalendarTaskResponse, status_code=status.HTTP_201_CREATED)
def add_calendar_task(
    data: CalendarTaskCreate,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return save_calendar_task(data, current_user.id, db)


@app.patch("/calendarTasks/{task_id}", response_model=CalendarTaskResponse)
def update_calendar_task(
    task_id: int,
    data: CalendarTaskUpdate,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = (
        db.query(CalendarTaskModel)
        .filter(CalendarTaskModel.id == task_id, CalendarTaskModel.user_id == current_user.id)
        .first()
    )
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Calendar item not found")
    task.completed = data.completed
    db.commit()
    db.refresh(task)
    return task


@app.delete("/calendarTasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_calendar_task(
    task_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = (
        db.query(CalendarTaskModel)
        .filter(CalendarTaskModel.id == task_id, CalendarTaskModel.user_id == current_user.id)
        .first()
    )
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Calendar item not found")
    db.delete(task)
    db.commit()


def get_owned_class_folder(folder_id: int, user_id: int, db: Session) -> ClassFolderModel:
    folder = (
        db.query(ClassFolderModel)
        .filter(ClassFolderModel.id == folder_id, ClassFolderModel.user_id == user_id)
        .first()
    )
    if folder is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Class folder not found")
    return folder


@app.get("/class-folders", response_model=list[ClassFolderResponse])
def list_class_folders(
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return (
        db.query(ClassFolderModel)
        .filter(ClassFolderModel.user_id == current_user.id)
        .order_by(ClassFolderModel.class_name, ClassFolderModel.subject)
        .all()
    )


@app.post("/class-folders", response_model=ClassFolderResponse, status_code=status.HTTP_201_CREATED)
def create_class_folder(
    data: ClassFolderCreate,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    folder = ClassFolderModel(
        user_id=current_user.id,
        class_name=data.class_name,
        subject=data.subject,
        active=True,
    )
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return folder


@app.patch("/class-folders/{folder_id}", response_model=ClassFolderResponse)
def update_class_folder(
    folder_id: int,
    data: ClassFolderUpdate,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    folder = get_owned_class_folder(folder_id, current_user.id, db)
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(folder, key, value)
    db.commit()
    db.refresh(folder)
    return folder


@app.delete("/class-folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_class_folder(
    folder_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    folder = get_owned_class_folder(folder_id, current_user.id, db)
    db.query(ClassNoteModel).filter(
        ClassNoteModel.folder_id == folder_id,
        ClassNoteModel.user_id == current_user.id,
    ).update({ClassNoteModel.folder_id: None}, synchronize_session=False)
    db.delete(folder)
    db.commit()


def validate_note_folder(folder_id: int | None, user_id: int, db: Session) -> None:
    if folder_id is not None:
        get_owned_class_folder(folder_id, user_id, db)


@app.get("/class-notes", response_model=list[ClassNoteResponse])
def list_class_notes(
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return (
        db.query(ClassNoteModel)
        .filter(ClassNoteModel.user_id == current_user.id)
        .order_by(ClassNoteModel.sequence, ClassNoteModel.id)
        .all()
    )


@app.post("/class-notes", response_model=ClassNoteResponse, status_code=status.HTTP_201_CREATED)
def create_class_note(
    data: ClassNoteCreate,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    validate_note_folder(data.folder_id, current_user.id, db)
    note = ClassNoteModel(
        user_id=current_user.id,
        folder_id=data.folder_id,
        title=data.title,
        sequence=data.sequence,
        content=data.content,
        drawings=[element.model_dump() for element in data.drawings],
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


@app.patch("/class-notes/{note_id}", response_model=ClassNoteResponse)
def update_class_note(
    note_id: int,
    data: ClassNoteUpdate,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    note = (
        db.query(ClassNoteModel)
        .filter(ClassNoteModel.id == note_id, ClassNoteModel.user_id == current_user.id)
        .first()
    )
    if note is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note page not found")
    validate_note_folder(data.folder_id, current_user.id, db)
    note.folder_id = data.folder_id
    note.title = data.title
    note.sequence = data.sequence
    note.content = data.content
    note.drawings = [element.model_dump() for element in data.drawings]
    db.commit()
    db.refresh(note)
    return note


@app.delete("/class-notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_class_note(
    note_id: int,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    note = (
        db.query(ClassNoteModel)
        .filter(ClassNoteModel.id == note_id, ClassNoteModel.user_id == current_user.id)
        .first()
    )
    if note is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note page not found")
    db.delete(note)
    db.commit()


CALENDAR_TOOL = {
    "type": "function",
    "function": {
        "name": "create_calendar_items",
        "description": "Create calendar tasks, events, or reminders only when the user explicitly asks to schedule or create them.",
        "parameters": {
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "description": {"type": "string"},
                            "kind": {"type": "string", "enum": ["task", "event", "reminder"]},
                            "date": {"type": "string", "format": "date"},
                            "start_time": {"type": ["string", "null"], "description": "Local time in HH:MM format, or null."},
                            "end_time": {"type": ["string", "null"], "description": "Local time in HH:MM format, or null."},
                            "reminder_at": {
                                "type": ["string", "null"],
                                "description": "ISO 8601 datetime with timezone offset, or null.",
                            },
                        },
                        "required": ["title", "kind", "date"],
                        "additionalProperties": False,
                    },
                }
            },
            "required": ["items"],
            "additionalProperties": False,
        },
    },
}


def request_ai_completion(messages: list[dict]) -> dict:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI chat is not configured. Set OPENAI_API_KEY on the backend and restart it.",
        )
    body = json.dumps(
        {
            "model": os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            "messages": messages,
            "tools": [CALENDAR_TOOL],
            "tool_choice": "auto",
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=body,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI provider returned HTTP {error.code}. Check the backend AI configuration.",
        ) from error
    except urllib.error.URLError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unable to reach the AI provider. Check the backend network connection.",
        ) from error
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI provider returned an invalid response.",
        ) from error


@app.post("/chat")
async def chat(
    data: ChatRequest,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    system_message = {
        "role": "system",
        "content": (
            "You are Student Hub's friendly study planner. Help the user plan tasks, events, and reminders. "
            "Use the create_calendar_items tool when the user explicitly asks you to schedule or create something; "
            "ask a concise follow-up if the date is unclear rather than guessing. Times use the user's local timezone "
            f"({data.timezone}). The current local date is {data.current_date.isoformat()}. "
            "Use 24-hour HH:MM strings for start_time and end_time. For an item without a time, use null for "
            "start_time and end_time. Set reminder_at only when requested, in ISO 8601 including the user's timezone."
        ),
    }
    messages = [system_message, *[message.model_dump() for message in data.messages]]
    completion = await asyncio.to_thread(request_ai_completion, messages)
    try:
        assistant_message = completion["choices"][0]["message"]
    except (KeyError, IndexError, TypeError) as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI provider returned an incomplete response.",
        ) from error

    tool_calls = assistant_message.get("tool_calls", [])
    try:
        validated_items = [
            CalendarTaskCreate.model_validate(item)
            for tool_call in tool_calls
            if tool_call.get("function", {}).get("name") == "create_calendar_items"
            for item in json.loads(tool_call["function"]["arguments"])["items"]
        ]
    except (KeyError, TypeError, json.JSONDecodeError, ValueError) as error:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI generated an invalid calendar item.",
        ) from error

    created_items = [build_calendar_task(item, current_user.id) for item in validated_items]
    if created_items:
        db.add_all(created_items)
        db.commit()
        for item in created_items:
            db.refresh(item)

    reply = assistant_message.get("content") or ""
    if created_items and not reply:
        reply = f"Done — I added {len(created_items)} item{'s' if len(created_items) != 1 else ''} to your calendar."
    return {
        "reply": reply,
        "created_items": [CalendarTaskResponse.model_validate(item) for item in created_items],
    }
