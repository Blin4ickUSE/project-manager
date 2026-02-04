import os
import json
import secrets
import shutil
from datetime import datetime
from typing import List, Optional
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, Integer, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import sessionmaker, declarative_base, relationship, Session
from passlib.context import CryptContext
from jose import JWTError, jwt

# --- КОНФИГУРАЦИЯ ---
DATABASE_URL = "sqlite:///./data.db"
UPLOAD_DIR = "./uploads"
SECRET_KEY = secrets.token_hex(64)
ALGORITHM = "HS256"

os.makedirs(UPLOAD_DIR, exist_ok=True)

# --- БАЗА ДАННЫХ ---
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# --- МОДЕЛИ ---
class Settings(Base):
    __tablename__ = "settings"
    key = Column(String, primary_key=True)
    value = Column(String)

class Admin(Base):
    __tablename__ = "admins"
    id = Column(Integer, primary_key=True)
    username = Column(String, unique=True)
    password_hash = Column(String)
    avatar_url = Column(String, default="")

class Project(Base):
    __tablename__ = "projects"
    id = Column(String, primary_key=True) # ID проекта (PRJ-XXX)
    password = Column(String) # Пароль клиента
    name = Column(String)
    description = Column(Text, default="")
    price = Column(Integer, default=0)
    paid_amount = Column(Integer, default=0)
    deadline = Column(DateTime, nullable=True)
    status = Column(String, default="New") # New, In Progress, Review, Completed
    is_archived = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # JSON поля
    stages = Column(Text, default='[{"title": "Start", "done": false}]') 
    options = Column(Text, default='[]') # Доп опции
    
    messages = relationship("Message", back_populates="project", cascade="all, delete")
    files = relationship("FileRecord", back_populates="project", cascade="all, delete")

class Message(Base):
    __tablename__ = "messages"
    id = Column(Integer, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id"))
    sender = Column(String) # "admin" или "client"
    text = Column(Text)
    attachment_url = Column(String, nullable=True)
    attachment_type = Column(String, nullable=True) # image, video, zip
    timestamp = Column(DateTime, default=datetime.utcnow)
    read = Column(Boolean, default=False)
    
    project = relationship("Project", back_populates="messages")

class FileRecord(Base):
    __tablename__ = "files"
    id = Column(Integer, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id"))
    filename = Column(String)
    filepath = Column(String)
    uploaded_by = Column(String)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    
    project = relationship("Project", back_populates="files")

class Todo(Base):
    __tablename__ = "todos"
    id = Column(Integer, primary_key=True)
    text = Column(String)
    is_done = Column(Boolean, default=False)
    priority = Column(String, default="low") # low, high

Base.metadata.create_all(bind=engine)

# --- BEZOPASNOST ---
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

def get_db():
    db = SessionLocal()
    try: yield db
    finally: db.close()

def create_token(data: dict):
    return jwt.encode(data, SECRET_KEY, algorithm=ALGORITHM)

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

# --- FASTAPI APP ---
app = FastAPI()

# Разрешаем CORS для фронта на 7443
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # В продакшене лучше указать конкретный домен
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# --- AUTH ENDPOINTS ---

@app.post("/api/auth/admin")
def admin_login(form: dict = Body(...), db: Session = Depends(get_db)):
    # Создаем админа, если нет (Первый запуск)
    if not db.query(Admin).first():
        hashed = pwd_context.hash("admin123") # Default password
        db.add(Admin(username="admin", password_hash=hashed))
        db.commit()
    
    admin = db.query(Admin).filter(Admin.username == form.get("username")).first()
    if not admin or not pwd_context.verify(form.get("password"), admin.password_hash):
        raise HTTPException(401, "Неверный логин или пароль")
    
    return {"token": create_token({"sub": "admin", "role": "admin"}), "role": "admin"}

@app.post("/api/auth/client")
def client_login(form: dict = Body(...), db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == form.get("project_id")).first()
    if not project or project.password != form.get("password"):
        raise HTTPException(401, "Неверный ID проекта или пароль")
    
    return {"token": create_token({"sub": project.id, "role": "client"}), "role": "client", "project_id": project.id}

# --- ADMIN ENDPOINTS ---

@app.get("/api/admin/dashboard")
def get_dashboard(user=Depends(get_current_user), db: Session = Depends(get_db)):
    if user['role'] != 'admin': raise HTTPException(403)
    
    projects = db.query(Project).all()
    todos = db.query(Todo).all()
    total_money = sum(p.price for p in projects)
    return {
        "projects": projects,
        "todos": todos,
        "stats": {
            "total_projects": len(projects),
            "active_projects": len([p for p in projects if p.status != "Completed"]),
            "total_money": total_money
        }
    }

@app.post("/api/projects")
def create_project(data: dict = Body(...), user=Depends(get_current_user), db: Session = Depends(get_db)):
    if user['role'] != 'admin': raise HTTPException(403)
    
    pid = f"PRJ-{secrets.token_hex(3).upper()}"
    ppass = secrets.token_urlsafe(6)
    
    new_proj = Project(
        id=pid,
        password=ppass,
        name=data['name'],
        price=int(data.get('price', 0)),
        deadline=datetime.fromisoformat(data['deadline']) if data.get('deadline') else None,
        stages=json.dumps([{"title": "Создание", "done": False}, {"title": "Разработка", "done": False}, {"title": "Финал", "done": False}])
    )
    db.add(new_proj)
    db.commit()
    return {"id": pid, "password": ppass}

@app.put("/api/projects/{pid}")
def update_project(pid: str, data: dict = Body(...), user=Depends(get_current_user), db: Session = Depends(get_db)):
    if user['role'] != 'admin': raise HTTPException(403)
    proj = db.query(Project).filter(Project.id == pid).first()
    
    if "stages" in data: proj.stages = json.dumps(data['stages'])
    if "status" in data: proj.status = data['status']
    if "price" in data: proj.price = data['price']
    if "paid_amount" in data: proj.paid_amount = data['paid_amount']
    
    db.commit()
    return {"status": "ok"}

@app.post("/api/todos")
def add_todo(data: dict = Body(...), user=Depends(get_current_user), db: Session = Depends(get_db)):
    if user['role'] != 'admin': raise HTTPException(403)
    db.add(Todo(text=data['text'], priority=data.get('priority', 'low')))
    db.commit()
    return {"status": "ok"}

@app.delete("/api/todos/{tid}")
def delete_todo(tid: int, user=Depends(get_current_user), db: Session = Depends(get_db)):
    if user['role'] != 'admin': raise HTTPException(403)
    db.query(Todo).filter(Todo.id == tid).delete()
    db.commit()
    return {"status": "ok"}

# --- SHARED/CLIENT ENDPOINTS ---

@app.get("/api/project/{pid}")
def get_project_details(pid: str, user=Depends(get_current_user), db: Session = Depends(get_db)):
    # Access check
    if user['role'] != 'admin' and user['sub'] != pid:
        raise HTTPException(403)
        
    proj = db.query(Project).filter(Project.id == pid).first()
    msgs = db.query(Message).filter(Message.project_id == pid).order_by(Message.timestamp).all()
    files = db.query(FileRecord).filter(FileRecord.project_id == pid).all()
    
    return {
        "details": proj,
        "messages": msgs,
        "files": files,
        "stages": json.loads(proj.stages),
        "options": json.loads(proj.options)
    }

@app.post("/api/chat/{pid}")
def send_message(pid: str, data: dict = Body(...), user=Depends(get_current_user), db: Session = Depends(get_db)):
    sender = "admin" if user['role'] == 'admin' else "client"
    msg = Message(
        project_id=pid,
        sender=sender,
        text=data.get("text", ""),
        attachment_url=data.get("attachment_url"),
        attachment_type=data.get("attachment_type")
    )
    db.add(msg)
    db.commit()
    return {"status": "sent", "msg": msg}

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...), user=Depends(get_current_user), db: Session = Depends(get_db)):
    # Определяем Project ID
    pid = user['sub']
    if user['role'] == 'admin':
        # Admin должен передать project_id в заголовках или форме, для простоты берем из имени файла или отдельного поля,
        # но здесь упростим: файл просто грузится, привязка идет при отправке сообщения
        pass

    fname = f"{secrets.token_hex(4)}_{file.filename}"
    fpath = os.path.join(UPLOAD_DIR, fname)
    
    with open(fpath, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    # Возвращаем URL
    return {"url": f"/uploads/{fname}", "filename": file.filename, "type": file.content_type}
