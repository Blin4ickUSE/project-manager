# backend.py
import os
import secrets
import shutil
from datetime import datetime
from typing import List, Optional
from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, Integer, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import sessionmaker, declarative_base, relationship, Session
from passlib.context import CryptContext
from jose import JWTError, jwt

# --- CONFIG ---
SECRET_KEY = secrets.token_hex(32)
ALGORITHM = "HS256"
DATABASE_URL = "sqlite:///./data.db"
UPLOAD_DIR = "uploads"

# --- DATABASE SETUP ---
os.makedirs(UPLOAD_DIR, exist_ok=True)
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# --- MODELS ---
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    is_admin = Column(Boolean, default=False)

class Project(Base):
    __tablename__ = "projects"
    id = Column(String, primary_key=True, index=True) # Project ID (e.g., PRJ-123)
    password = Column(String) # Simple access password for client
    name = Column(String)
    status = Column(String, default="In Progress")
    deadline = Column(DateTime, nullable=True)
    price = Column(Integer, default=0)
    paid = Column(Boolean, default=False)
    progress = Column(Integer, default=0) # 0-100%
    stages = Column(Text, default="[]") # JSON string of stages
    is_completed = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class Message(Base):
    __tablename__ = "messages"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(String, ForeignKey("projects.id"))
    sender = Column(String) # "admin" or "client"
    content = Column(Text)
    timestamp = Column(DateTime, default=datetime.utcnow)
    file_path = Column(String, nullable=True)
    file_type = Column(String, nullable=True)

class Todo(Base):
    __tablename__ = "todos"
    id = Column(Integer, primary_key=True, index=True)
    task = Column(String)
    done = Column(Boolean, default=False)

Base.metadata.create_all(bind=engine)

# --- SECURITY ---
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = None # Simplified for this demo

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- API ---
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/files", StaticFiles(directory=UPLOAD_DIR), name="files")

# --- Pydantic Schemas ---
class ProjectCreate(BaseModel):
    name: str
    price: int
    deadline: Optional[datetime] = None

class LoginRequest(BaseModel):
    username: str
    password: str

# --- ENDPOINTS ---

@app.post("/api/admin/login")
def admin_login(creds: LoginRequest, db: Session = Depends(get_db)):
    # Default admin if not exists
    admin = db.query(User).filter(User.username == "admin").first()
    if not admin:
        admin = User(username="admin", hashed_password=pwd_context.hash("superadmin123"), is_admin=True)
        db.add(admin)
        db.commit()
    
    user = db.query(User).filter(User.username == creds.username).first()
    if not user or not pwd_context.verify(creds.password, user.hashed_password) or not user.is_admin:
        raise HTTPException(status_code=401, detail="Invalid admin credentials")
    return {"token": "admin_access_granted", "role": "admin"}

@app.post("/api/client/login")
def client_login(creds: LoginRequest, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == creds.username).first() # username is project_id
    if not project or project.password != creds.password:
        raise HTTPException(status_code=401, detail="Invalid project credentials")
    return {"token": project.id, "role": "client"}

@app.post("/api/projects")
def create_project(data: ProjectCreate, db: Session = Depends(get_db)):
    prj_id = "PRJ-" + secrets.token_hex(3).upper()
    prj_pass = secrets.token_urlsafe(8)
    new_project = Project(
        id=prj_id,
        password=prj_pass,
        name=data.name,
        price=data.price,
        deadline=data.deadline,
        stages='["Start", "Design", "Development", "Testing", "Release"]'
    )
    db.add(new_project)
    db.commit()
    return {"id": prj_id, "password": prj_pass}

@app.get("/api/projects")
def get_projects(db: Session = Depends(get_db)):
    return db.query(Project).all()

@app.get("/api/projects/{project_id}")
def get_project_details(project_id: str, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    messages = db.query(Message).filter(Message.project_id == project_id).all()
    if not project:
        raise HTTPException(404)
    return {"project": project, "messages": messages}

@app.post("/api/projects/{project_id}/update")
def update_project(project_id: str, data: dict, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if "progress" in data: project.progress = data["progress"]
    if "status" in data: project.status = data["status"]
    if "paid" in data: project.paid = data["paid"]
    db.commit()
    return {"status": "ok"}

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    file_location = os.path.join(UPLOAD_DIR, file.filename)
    with open(file_location, "wb+") as buffer:
        shutil.copyfileobj(file.file, buffer)
    return {"filename": file.filename, "url": f"/files/{file.filename}", "type": file.content_type}

@app.post("/api/chat")
def send_message(data: dict, db: Session = Depends(get_db)):
    msg = Message(
        project_id=data['project_id'],
        sender=data['sender'],
        content=data.get('content', ''),
        file_path=data.get('file_path'),
        file_type=data.get('file_type')
    )
    db.add(msg)
    db.commit()
    return {"status": "sent"}

# --- ADMIN TODO ---
@app.get("/api/todos")
def get_todos(db: Session = Depends(get_db)):
    return db.query(Todo).all()

@app.post("/api/todos")
def add_todo(task: str, db: Session = Depends(get_db)):
    db.add(Todo(task=task))
    db.commit()
    return {"status": "ok"}

@app.delete("/api/todos/{id}")
def delete_todo(id: int, db: Session = Depends(get_db)):
    db.query(Todo).filter(Todo.id == id).delete()
    db.commit()
    return {"status": "ok"}
