#!/bin/bash

# --- CONFIG ---
PROJECT_DIR="/opt/super-pm"
BACKEND_PORT=7442
FRONTEND_PORT=7443

# Цвета для терминала
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

if [ "$EUID" -ne 0 ]; then 
  echo -e "${RED}Запустите через sudo!${NC}"
  exit 1
fi

echo -e "${GREEN}=== ЗАПУСК ПОЛНОЙ УСТАНОВКИ SUPER-PM ===${NC}"

# 1. Сбор данных
echo -n "Введите ваш домен (например, pm.site.com): "
read DOMAIN
echo -n "Введите Email для SSL Let's Encrypt: "
read EMAIL

# 2. Установка системных зависимостей
echo -e "${GREEN}>>> Установка системных пакетов...${NC}"
apt-get update -y
apt-get install -y python3 python3-pip python3-venv nginx certbot python3-certbot-nginx curl git openssl

# Установка Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# 3. Получение SSL сертификата
echo -e "${GREEN}>>> Получение SSL сертификатов...${NC}"
systemctl stop nginx
certbot certonly --standalone -d $DOMAIN --non-interactive --agree-tos -m $EMAIL

SSL_KEY="/etc/letsencrypt/live/$DOMAIN/privkey.pem"
SSL_CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"

if [ ! -f "$SSL_KEY" ]; then
    echo -e "${RED}Ошибка SSL! Проверьте, что порт 80 открыт и домен направлен на сервер.${NC}"
    exit 1
fi

# 4. Создание структуры папок
mkdir -p $PROJECT_DIR/backend/uploads
mkdir -p $PROJECT_DIR/frontend/src

# 5. ГЕНЕРАЦИЯ BACKEND (backend.py)
echo -e "${GREEN}>>> Создание Backend (Python FastAPI)...${NC}"
cat <<EOF > $PROJECT_DIR/backend/backend.py
import os, json, secrets, shutil
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

DATABASE_URL = "sqlite:///./data.db"
UPLOAD_DIR = "./uploads"
SECRET_KEY = "$(openssl rand -hex 32)"
ALGORITHM = "HS256"

os.makedirs(UPLOAD_DIR, exist_ok=True)
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class Admin(Base):
    __tablename__ = "admins"
    id = Column(Integer, primary_key=True)
    username = Column(String, unique=True)
    password_hash = Column(String)

class Project(Base):
    __tablename__ = "projects"
    id = Column(String, primary_key=True)
    password = Column(String)
    name = Column(String)
    price = Column(Integer, default=0)
    paid_amount = Column(Integer, default=0)
    deadline = Column(String, nullable=True)
    status = Column(String, default="New")
    stages = Column(Text, default='[]')
    messages = relationship("Message", back_populates="project", cascade="all, delete")

class Message(Base):
    __tablename__ = "messages"
    id = Column(Integer, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id"))
    sender = Column(String)
    text = Column(Text)
    attachment_url = Column(String, nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    project = relationship("Project", back_populates="messages")

class Todo(Base):
    __tablename__ = "todos"
    id = Column(Integer, primary_key=True)
    text = Column(String)
    is_done = Column(Boolean, default=False)

Base.metadata.create_all(bind=engine)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

def get_db():
    db = SessionLocal()
    try: yield db
    finally: db.close()

def create_token(data: dict):
    return jwt.encode(data, SECRET_KEY, algorithm=ALGORITHM)

def get_current_user(token: str = Depends(oauth2_scheme)):
    try: return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except: raise HTTPException(401)

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

@app.post("/api/auth/admin")
def admin_login(form: dict = Body(...), db: Session = Depends(get_db)):
    if not db.query(Admin).first():
        db.add(Admin(username="admin", password_hash=pwd_context.hash("admin123")))
        db.commit()
    user = db.query(Admin).filter(Admin.username == form['username']).first()
    if not user or not pwd_context.verify(form['password'], user.password_hash): raise HTTPException(401)
    return {"token": create_token({"sub": "admin", "role": "admin"}), "role": "admin"}

@app.post("/api/auth/client")
def client_login(form: dict = Body(...), db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == form['project_id']).first()
    if not p or p.password != form['password']: raise HTTPException(401)
    return {"token": create_token({"sub": p.id, "role": "client"}), "role": "client"}

@app.get("/api/admin/dashboard")
def dashboard(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return {"projects": db.query(Project).all(), "todos": db.query(Todo).all()}

@app.post("/api/projects")
def create_proj(data: dict = Body(...), db: Session = Depends(get_db)):
    pid, pw = "PRJ-"+secrets.token_hex(3).upper(), secrets.token_urlsafe(6)
    st = json.dumps([{"title": "ТЗ", "done": True}, {"title": "Разработка", "done": False}, {"title": "Приемка", "done": False}])
    db.add(Project(id=pid, password=pw, name=data['name'], price=data.get('price', 0), stages=st))
    db.commit()
    return {"id": pid, "password": pw}

@app.get("/api/project/{pid}")
def get_proj(pid: str, db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == pid).first()
    if not p: raise HTTPException(404)
    return {"details": p, "stages": json.loads(p.stages), "messages": db.query(Message).filter(Message.project_id==pid).order_by(Message.timestamp).all()}

@app.put("/api/projects/{pid}")
def update_proj(pid: str, data: dict = Body(...), db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == pid).first()
    if 'stages' in data: p.stages = json.dumps(data['stages'])
    if 'status' in data: p.status = data['status']
    if 'paid_amount' in data: p.paid_amount = data['paid_amount']
    db.commit()
    return {"status": "ok"}

@app.post("/api/chat/{pid}")
def chat(pid: str, data: dict = Body(...), user=Depends(get_current_user), db: Session = Depends(get_db)):
    sender = "admin" if user['role'] == "admin" else "client"
    db.add(Message(project_id=pid, sender=sender, text=data.get('text'), attachment_url=data.get('attachment_url')))
    db.commit()
    return {"status": "ok"}

@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    name = f"{secrets.token_hex(4)}_{file.filename}"
    with open(f"{UPLOAD_DIR}/{name}", "wb") as f: shutil.copyfileobj(file.file, f)
    return {"url": f"/uploads/{name}", "filename": file.filename}

@app.post("/api/todos")
def add_todo(data: dict = Body(...), db: Session = Depends(get_db)):
    db.add(Todo(text=data['text'])); db.commit(); return {"ok": True}

@app.delete("/api/todos/{id}")
def del_todo(id: int, db: Session = Depends(get_db)):
    db.query(Todo).filter(Todo.id == id).delete(); db.commit(); return {"ok": True}
EOF

# 6. ГЕНЕРАЦИЯ FRONTEND (App.jsx + deps)
echo -e "${GREEN}>>> Создание Frontend (React)...${NC}"
cd $PROJECT_DIR/frontend
cat <<EOF > package.json
{
  "name": "pm-front",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build" },
  "dependencies": { "react": "^18.2.0", "react-dom": "^18.2.0", "lucide-react": "^0.284.0", "axios": "^1.5.0" },
  "devDependencies": { "@types/react": "^18.2.0", "@vitejs/plugin-react": "^4.0.0", "vite": "^4.4.0", "autoprefixer": "^10.4.14", "postcss": "^8.4.27", "tailwindcss": "^3.3.3" }
}
EOF

cat <<EOF > vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()] });
EOF

cat <<EOF > src/main.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
EOF

cat <<EOF > src/index.css
@tailwind base; @tailwind components; @tailwind utilities;
body { background: black; color: white; margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
EOF

cat <<EOF > tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default { content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"], theme: { extend: {} }, plugins: [] }
EOF

cat <<EOF > index.html
<!DOCTYPE html><html><head><meta charset="UTF-8" /><title>PM SYSTEM</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>
EOF

# ГЕНЕРАЦИЯ ГЛАВНОГО ФАЙЛА APP.JSX
cat <<EOF > src/App.jsx
import React, { useState, useEffect } from 'react';
import { Send, Plus, Trash, LogOut, FileText, Shield, Paperclip, CheckCircle } from 'lucide-react';
import axios from 'axios';

const API = "https://$DOMAIN:7442/api";
const UPLOADS = "https://$DOMAIN:7442";

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [role, setRole] = useState(localStorage.getItem('role'));
  const [user, setUser] = useState(null);
  const [projects, setProjects] = useState([]);
  const [todos, setTodos] = useState([]);
  const [current, setCurrent] = useState(null);
  const [msg, setMsg] = useState('');
  const [loginForm, setLoginForm] = useState({ u: '', p: '' });

  useEffect(() => { if(token) loadInit(); }, [token]);

  const loadInit = async () => {
    if(role === 'admin') {
      const res = await axios.get(API + '/admin/dashboard', { headers: { Authorization: 'Bearer ' + token } });
      setProjects(res.data.projects);
      setTodos(res.data.todos);
    } else {
      loadProject(localStorage.getItem('pid'));
    }
  };

  const loadProject = async (pid) => {
    const res = await axios.get(API + '/project/' + pid);
    setCurrent(res.data);
  };

  const login = async (type) => {
    try {
      const url = type === 'admin' ? '/auth/admin' : '/auth/client';
      const body = type === 'admin' ? { username: loginForm.u, password: loginForm.p } : { project_id: loginForm.u, password: loginForm.p };
      const res = await axios.post(API + url, body);
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('role', res.data.role);
      if(type === 'client') localStorage.setItem('pid', loginForm.u);
      window.location.reload();
    } catch(e) { alert("Ошибка входа"); }
  };

  const sendMessage = async () => {
    if(!msg) return;
    await axios.post(API + '/chat/' + current.details.id, { text: msg }, { headers: { Authorization: 'Bearer ' + token } });
    setMsg(''); loadProject(current.details.id);
  };

  const uploadFile = async (e) => {
    const f = e.target.files[0];
    const fd = new FormData(); fd.append('file', f);
    const res = await axios.post(API + '/upload', fd);
    await axios.post(API + '/chat/' + current.details.id, { text: 'Файл: '+f.name, attachment_url: res.data.url }, { headers: { Authorization: 'Bearer ' + token } });
    loadProject(current.details.id);
  };

  const createPrj = async () => {
    const n = prompt("Название проекта?");
    const p = prompt("Цена?");
    if(n) {
      const res = await axios.post(API + '/projects', { name: n, price: p }, { headers: { Authorization: 'Bearer ' + token } });
      alert("ID: " + res.data.id + " / Pass: " + res.data.password);
      loadInit();
    }
  };

  if(!token) return (
    <div className="h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm border border-white p-8 space-y-4">
        <h1 className="text-2xl font-bold tracking-tighter">PROJECT_MANAGER</h1>
        <input className="w-full bg-transparent border border-zinc-800 p-3 outline-none focus:border-white" placeholder="ID / LOGIN" onChange={e=>setLoginForm({...loginForm, u: e.target.value})}/>
        <input type="password" className="w-full bg-transparent border border-zinc-800 p-3 outline-none focus:border-white" placeholder="PASSWORD" onChange={e=>setLoginForm({...loginForm, p: e.target.value})}/>
        <div className="flex gap-2">
          <button className="flex-1 bg-white text-black font-bold py-3 text-xs uppercase" onClick={()=>login('client')}>Client</button>
          <button className="flex-1 border border-white font-bold py-3 text-xs uppercase" onClick={()=>login('admin')}>Admin</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <div className="border-b border-zinc-800 p-4 flex justify-between items-center bg-black">
        <div className="font-bold tracking-widest flex items-center gap-2"><Shield size={18}/> SYSTEM_v1.0</div>
        <button className="text-xs border border-zinc-700 px-3 py-1 hover:bg-white hover:text-black transition" onClick={()=>{localStorage.clear(); window.location.reload();}}>LOGOUT</button>
      </div>
      
      <div className="flex-1 flex overflow-hidden">
        {role === 'admin' && (
          <div className="w-64 border-r border-zinc-800 p-4 overflow-y-auto space-y-6 hidden md:block">
            <div>
              <div className="text-[10px] text-zinc-500 mb-2 uppercase flex justify-between items-center">Projects <Plus size={14} className="cursor-pointer" onClick={createPrj}/></div>
              {projects.map(p=>(
                <div key={p.id} className="p-2 border border-zinc-900 mb-1 cursor-pointer hover:border-zinc-500" onClick={()=>loadProject(p.id)}>
                  <div className="text-sm font-bold truncate">{p.name}</div>
                  <div className="text-[10px] text-zinc-600">{p.id}</div>
                </div>
              ))}
            </div>
            <div>
              <div className="text-[10px] text-zinc-500 mb-2 uppercase">Admin To-Do</div>
              {todos.map(t=>(
                <div key={t.id} className="text-xs flex justify-between group py-1">
                  <span>- {t.text}</span>
                  <Trash size={12} className="text-zinc-700 group-hover:text-red-500 cursor-pointer" onClick={async()=>{await axios.delete(API+'/todos/'+t.id); loadInit();}}/>
                </div>
              ))}
              <input className="w-full bg-transparent border-b border-zinc-800 text-xs py-1 mt-2 outline-none" placeholder="+ New task" onKeyDown={async e=>{if(e.key==='Enter'){await axios.post(API+'/todos',{text:e.target.value}); e.target.value=''; loadInit();}}}/>
            </div>
          </div>
        )}

        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {current ? (
            <>
              <div className="flex-1 p-6 overflow-y-auto space-y-8">
                <div className="border border-white p-6">
                  <div className="text-xs text-zinc-500 mb-1">{current.details.id}</div>
                  <h2 className="text-3xl font-bold mb-4 uppercase">{current.details.name}</h2>
                  <div className="grid grid-cols-2 gap-4 text-[10px] uppercase">
                    <div>Status: <span className="text-white">{current.details.status}</span></div>
                    <div>Price: <span className="text-white">{current.details.price} RUB</span></div>
                    <div>Paid: <span className="text-white">{current.details.paid_amount} RUB</span></div>
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-zinc-500 mb-4 uppercase">Project Stages</div>
                  <div className="space-y-3">
                    {current.stages.map((s,i)=>(
                      <div key={i} className="flex items-center gap-3">
                        <div className={"w-4 h-4 border " + (s.done ? "bg-white" : "border-zinc-800")}/>
                        <span className={"text-sm " + (s.done ? "text-white" : "text-zinc-600")}>{s.title}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border border-zinc-800 p-4">
                  <div className="text-[10px] text-zinc-500 mb-2 uppercase">Payment Details</div>
                  <div className="text-sm font-bold">YooKassa: ID_9928374</div>
                  <button className="mt-4 w-full bg-white text-black text-xs font-bold py-3 uppercase">Pay Now</button>
                </div>
              </div>

              <div className="w-full md:w-96 border-l border-zinc-800 flex flex-col bg-zinc-950">
                <div className="p-3 border-b border-zinc-800 text-[10px] font-bold">INTERNAL_COMMS</div>
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {current.messages.map(m=>(
                    <div key={m.id} className={"flex flex-col " + (m.sender==='admin'?'items-end':'items-start')}>
                      <div className={"max-w-[80%] p-3 text-xs border " + (m.sender==='admin'?'border-white bg-black':'border-zinc-800 bg-zinc-900')}>
                        {m.text}
                        {m.attachment_url && <a href={UPLOADS+m.attachment_url} target="_blank" className="block mt-2 underline text-zinc-400">FILE_ATTACHED</a>}
                      </div>
                      <div className="text-[8px] text-zinc-600 mt-1 uppercase">{new Date(m.timestamp).toLocaleTimeString()}</div>
                    </div>
                  ))}
                </div>
                <div className="p-4 border-t border-zinc-800 flex gap-2">
                  <label className="cursor-pointer text-zinc-500 hover:text-white"><Paperclip size={18}/><input type="file" className="hidden" onChange={uploadFile}/></label>
                  <input className="flex-1 bg-transparent text-xs outline-none" placeholder="Enter message..." value={msg} onChange={e=>setMsg(e.target.value)} onKeyDown={e=>e.key==='Enter'&&sendMessage()}/>
                  <button onClick={sendMessage}><Send size={18}/></button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-zinc-800 text-xs tracking-[0.2em]">SELECT_PROJECT_TO_START</div>
          )}
        </div>
      </div>
    </div>
  );
}
EOF

# 7. УСТАНОВКА И СБОРКА
echo -e "${GREEN}>>> Сборка проекта (это займет время)...${NC}"
npm install
npm run build

# 8. НАСТРОЙКА BACKEND SERVICE
echo -e "${GREEN}>>> Настройка Systemd...${NC}"
cd $PROJECT_DIR/backend
python3 -m venv venv
./venv/bin/pip install fastapi uvicorn sqlalchemy passlib python-jose python-multipart bcrypt

cat <<EOF > /etc/systemd/system/pm-backend.service
[Unit]
Description=PM Backend
After=network.target

[Service]
User=root
WorkingDirectory=$PROJECT_DIR/backend
ExecStart=$PROJECT_DIR/backend/venv/bin/uvicorn backend:app --host 0.0.0.0 --port 7442 --ssl-keyfile $SSL_KEY --ssl-certfile $SSL_CERT
Restart=always

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable pm-backend
systemctl start pm-backend

# 9. НАСТРОЙКА NGINX
echo -e "${GREEN}>>> Настройка Nginx...${NC}"
cat <<EOF > /etc/nginx/conf.d/pm.conf
server {
    listen 7443 ssl;
    server_name $DOMAIN;

    ssl_certificate $SSL_CERT;
    ssl_certificate_key $SSL_KEY;

    root $PROJECT_DIR/frontend/dist;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF

rm -f /etc/nginx/sites-enabled/default
systemctl restart nginx

echo -e "${GREEN}=========================================${NC}"
echo -e " ВСЁ ГОТОВО! УСТАНОВКА ЗАВЕРШЕНА."
echo -e " Ссылка: https://$DOMAIN:7443"
echo -e " Админ панель: Вход через кнопку Admin"
echo -e " Логин: admin / Пароль: admin123"
echo -e " Бэкенд запущен на порту 7442 (SSL)"
echo -e "${GREEN}=========================================${NC}"
