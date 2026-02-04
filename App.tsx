import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, Paperclip, CheckSquare, Settings, LogOut, 
  FileText, Download, Plus, Trash, User, Shield 
} from 'lucide-react';

// GLOBAL CONFIG
// В install.sh мы заменим DOMAIN на реальный
const API_BASE = "https://DOMAIN_PLACEHOLDER:7442/api"; 
const UPLOADS_BASE = "https://DOMAIN_PLACEHOLDER:7442";

const App = () => {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [role, setRole] = useState(localStorage.getItem('role'));
  const [view, setView] = useState('login'); // login, admin, client
  
  // Data State
  const [dashboard, setDashboard] = useState(null);
  const [currentProject, setCurrentProject] = useState(null);
  
  // Forms
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [msgText, setMsgText] = useState('');

  useEffect(() => {
    if (token && role) {
      setView(role === 'admin' ? 'admin' : 'client');
      loadData();
    }
  }, [token, role]);

  useEffect(() => {
    // Polling for chat updates (simple real-time)
    let interval;
    if (currentProject) {
      interval = setInterval(() => loadProjectDetails(currentProject.details.id), 3000);
    }
    return () => clearInterval(interval);
  }, [currentProject?.details?.id]);

  const api = async (endpoint, method = 'GET', body = null) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    
    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : null
      });
      if (res.status === 401) logout();
      return await res.json();
    } catch (e) {
      console.error(e);
      return null;
    }
  };

  const logout = () => {
    localStorage.clear();
    setToken(null);
    setRole(null);
    setView('login');
  };

  const handleLogin = async (type) => {
    const endpoint = type === 'admin' ? '/auth/admin' : '/auth/client';
    const body = type === 'admin' 
      ? { username: loginForm.username, password: loginForm.password }
      : { project_id: loginForm.username, password: loginForm.password };
      
    const res = await api(endpoint, 'POST', body);
    if (res?.token) {
      localStorage.setItem('token', res.token);
      localStorage.setItem('role', res.role);
      setToken(res.token);
      setRole(res.role);
    } else {
      alert("Ошибка входа");
    }
  };

  const loadData = async () => {
    if (role === 'admin') {
      const data = await api('/admin/dashboard');
      setDashboard(data);
    } else {
      // client
      const pid = localStorage.getItem('project_id') || loginForm.username; // fallback
      if(pid) loadProjectDetails(pid);
    }
  };

  const loadProjectDetails = async (pid) => {
    const data = await api(`/project/${pid}`);
    setCurrentProject(data);
  };

  const sendMessage = async () => {
    if (!msgText) return;
    await api(`/chat/${currentProject.details.id}`, 'POST', { text: msgText });
    setMsgText('');
    loadProjectDetails(currentProject.details.id);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    const res = await fetch(`${API_BASE}/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    const data = await res.json();
    
    // Send as message immediately
    await api(`/chat/${currentProject.details.id}`, 'POST', { 
      text: `File: ${data.filename}`,
      attachment_url: data.url,
      attachment_type: data.type
    });
    loadProjectDetails(currentProject.details.id);
  };

  // --- RENDER HELPERS ---
  
  if (view === 'login') {
    return (
      <div className="min-h-screen bg-black text-white font-mono flex items-center justify-center">
        <div className="w-full max-w-md p-8 border border-white">
          <h1 className="text-4xl font-black mb-8 tracking-tighter">BLACK_OPS_PM</h1>
          <div className="space-y-4">
            <input 
              placeholder="LOGIN / PROJECT ID"
              className="w-full bg-black border border-gray-700 p-4 focus:border-white outline-none text-white placeholder-gray-600"
              value={loginForm.username} onChange={e => setLoginForm({...loginForm, username: e.target.value})}
            />
            <input 
              type="password"
              placeholder="PASSWORD"
              className="w-full bg-black border border-gray-700 p-4 focus:border-white outline-none text-white placeholder-gray-600"
              value={loginForm.password} onChange={e => setLoginForm({...loginForm, password: e.target.value})}
            />
            <div className="flex gap-4 pt-4">
              <button onClick={() => handleLogin('client')} className="flex-1 border border-white py-3 hover:bg-white hover:text-black transition uppercase font-bold text-sm">
                Client Login
              </button>
              <button onClick={() => handleLogin('admin')} className="flex-1 bg-zinc-900 border border-zinc-900 text-gray-400 py-3 hover:text-white transition uppercase font-bold text-sm">
                Admin
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- INTERNAL UI COMPONENTS ---
  
  const ChatWindow = () => (
    <div className="flex flex-col h-[600px] border border-gray-800 bg-zinc-950/50">
      <div className="p-3 border-b border-gray-800 font-bold bg-black sticky top-0">COMMS_LINK</div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {currentProject?.messages.map(m => (
          <div key={m.id} className={`flex ${m.sender === (role === 'admin' ? 'admin' : 'client') ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] p-3 text-sm border ${m.sender === 'admin' ? 'bg-black border-white' : 'bg-zinc-900 border-zinc-800'}`}>
              <div className="mb-1">{m.text}</div>
              {m.attachment_url && (
                <a href={`${UPLOADS_BASE}${m.attachment_url}`} target="_blank" className="block mt-2 p-2 bg-zinc-800 text-xs flex items-center gap-2 hover:bg-zinc-700">
                  <FileText size={14}/> Скачать файл
                </a>
              )}
              <div className="text-[10px] opacity-50 mt-2">{new Date(m.timestamp).toLocaleTimeString()}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="p-3 border-t border-gray-800 flex gap-2 bg-black">
        <label className="cursor-pointer p-2 hover:text-white text-gray-500">
          <Paperclip size={20}/>
          <input type="file" className="hidden" onChange={handleFileUpload}/>
        </label>
        <input 
          className="flex-1 bg-transparent border-b border-gray-800 focus:border-white outline-none p-1 text-sm"
          placeholder="Type message..."
          value={msgText} onChange={e => setMsgText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && sendMessage()}
        />
        <button onClick={sendMessage}><Send size={20}/></button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-black text-white font-mono flex flex-col">
      <header className="border-b border-gray-800 p-4 flex justify-between items-center bg-black sticky top-0 z-50">
        <div className="font-bold text-xl tracking-widest flex items-center gap-2"><Shield size={20}/> SUPER_PM: {role === 'admin' ? 'ADMIN_MODE' : 'CLIENT_VIEW'}</div>
        <button onClick={logout} className="text-xs uppercase hover:underline flex gap-1 items-center"><LogOut size={14}/> Exit</button>
      </header>

      <div className="flex-1 p-4 md:p-8 flex gap-8 flex-col lg:flex-row max-w-[1600px] mx-auto w-full">
        
        {/* LEFT COLUMN: NAVIGATION / LIST */}
        {role === 'admin' && (
          <div className="w-full lg:w-1/4 space-y-8">
            <div className="border border-gray-800 p-4">
              <h2 className="text-sm text-gray-500 uppercase mb-4 flex justify-between items-center">
                Projects
                <button 
                  onClick={async () => {
                    const name = prompt("Название проекта?");
                    if(name) {
                      const res = await api('/projects', 'POST', {name, price: 0, deadline: null});
                      alert(`Создан!\nID: ${res.id}\nPass: ${res.password}`);
                      loadData();
                    }
                  }} 
                  className="hover:text-white"><Plus size={16}/></button>
              </h2>
              <div className="space-y-2">
                {dashboard?.projects.map(p => (
                  <div key={p.id} onClick={() => loadProjectDetails(p.id)}
                    className={`p-3 cursor-pointer border hover:bg-zinc-900 transition ${currentProject?.details?.id === p.id ? 'border-white bg-zinc-900' : 'border-zinc-800'}`}>
                    <div className="font-bold text-sm truncate">{p.name}</div>
                    <div className="text-xs text-gray-500 flex justify-between mt-1">
                      <span>{p.status}</span>
                      <span>{p.price}₽</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="border border-gray-800 p-4">
               <h2 className="text-sm text-gray-500 uppercase mb-4">To-Do List</h2>
               <div className="flex gap-2 mb-4">
                 <input id="newtodo" className="w-full bg-black border border-gray-700 p-1 text-sm" placeholder="New Task"/>
                 <button onClick={async () => {
                   const el = document.getElementById('newtodo');
                   await api('/todos', 'POST', {text: el.value});
                   el.value = '';
                   loadData();
                 }} className="text-white border border-gray-700 px-2">+</button>
               </div>
               {dashboard?.todos.map(t => (
                 <div key={t.id} className="flex justify-between items-center text-sm mb-2 group">
                   <span>- {t.text}</span>
                   <button onClick={async () => {await api(`/todos/${t.id}`, 'DELETE'); loadData();}} className="text-red-900 group-hover:text-red-500">X</button>
                 </div>
               ))}
            </div>
          </div>
        )}

        {/* MAIN AREA */}
        <div className="flex-1 flex flex-col lg:flex-row gap-8">
          {currentProject ? (
            <>
              {/* MIDDLE: INFO & STAGES */}
              <div className="flex-1 space-y-6">
                <div className="border border-white p-6 relative">
                  <div className="absolute top-0 right-0 bg-white text-black text-xs font-bold px-2 py-1">{currentProject.details.id}</div>
                  <h1 className="text-3xl font-bold mb-2">{currentProject.details.name}</h1>
                  <div className="grid grid-cols-2 gap-4 text-sm text-gray-400 mt-4">
                    <div>Status: <span className="text-white">{currentProject.details.status}</span></div>
                    <div>Price: <span className="text-white">{currentProject.details.price} ₽</span></div>
                    <div>Paid: <span className="text-white">{currentProject.details.paid_amount} ₽</span></div>
                    <div>Deadline: <span className="text-white">{currentProject.details.deadline ? new Date(currentProject.details.deadline).toLocaleDateString() : 'N/A'}</span></div>
                  </div>

                  {/* Payment Button (Visual) */}
                  {currentProject.details.paid_amount < currentProject.details.price && (
                    <button className="w-full mt-6 bg-white text-black font-bold py-3 hover:bg-gray-200 transition">
                      ОПЛАТИТЬ ЧЕРЕЗ YOOKASSA
                    </button>
                  )}
                </div>

                {/* STAGES */}
                <div className="border border-gray-800 p-6">
                  <h3 className="text-sm text-gray-500 uppercase mb-4">Этапы разработки</h3>
                  <div className="space-y-4">
                    {currentProject.stages.map((stage, i) => (
                      <div key={i} className="flex items-center gap-4">
                        <div className={`w-4 h-4 border flex items-center justify-center ${stage.done ? 'bg-white border-white' : 'border-gray-600'}`}>
                          {stage.done && <div className="w-2 h-2 bg-black"></div>}
                        </div>
                        <div className={`flex-1 ${stage.done ? 'text-white line-through decoration-1' : 'text-gray-500'}`}>
                          {stage.title}
                        </div>
                        {role === 'admin' && (
                          <button 
                            onClick={async () => {
                               const newStages = [...currentProject.stages];
                               newStages[i].done = !newStages[i].done;
                               await api(`/projects/${currentProject.details.id}`, 'PUT', {stages: newStages});
                               loadProjectDetails(currentProject.details.id);
                            }}
                            className="text-xs text-blue-500 underline"
                          >Toggle</button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                
                {role === 'admin' && (
                  <div className="border border-gray-800 p-4">
                     <h3 className="text-xs text-gray-500 mb-2">Admin Controls</h3>
                     <div className="flex gap-2">
                       <input className="bg-black border border-gray-700 p-1 text-sm w-20" placeholder="Price" onBlur={async (e) => {
                          await api(`/projects/${currentProject.details.id}`, 'PUT', {price: parseInt(e.target.value)});
                       }}/>
                       <select className="bg-black border border-gray-700 p-1 text-sm" onChange={async (e) => {
                          await api(`/projects/${currentProject.details.id}`, 'PUT', {status: e.target.value});
                       }}>
                         <option>New</option>
                         <option>In Progress</option>
                         <option>Completed</option>
                       </select>
                     </div>
                  </div>
                )}
              </div>

              {/* RIGHT: CHAT */}
              <div className="w-full lg:w-96">
                <ChatWindow />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-600 border border-gray-900 border-dashed">
              ВЫБЕРИТЕ ИЛИ СОЗДАЙТЕ ПРОЕКТ
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
