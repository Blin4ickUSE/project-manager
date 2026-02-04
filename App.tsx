import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Send, FileText, CheckCircle, Lock, Menu, X, Upload, CreditCard } from 'lucide-react';

// --- CONFIG ---
const API_URL = "https://YOUR_DOMAIN:7442/api"; // Will be replaced by install script usually
const FILE_URL = "https://YOUR_DOMAIN:7442/files";

const App = () => {
  const [view, setView] = useState('login'); // login, admin, client
  const [auth, setAuth] = useState({ token: null, role: null, id: null });
  const [projects, setProjects] = useState([]);
  const [currentProject, setCurrentProject] = useState(null);
  
  // Login Form State
  const [creds, setCreds] = useState({ username: '', password: '' });

  // --- AUTH ACTIONS ---
  const handleLogin = async (role) => {
    try {
      const endpoint = role === 'admin' ? '/admin/login' : '/client/login';
      const res = await axios.post(`${API_URL}${endpoint}`, creds);
      setAuth({ token: res.data.token, role: res.data.role, id: creds.username });
      setView(role === 'admin' ? 'admin' : 'client');
      if (role === 'admin') fetchProjects();
      if (role === 'client') fetchProjectDetails(creds.username);
    } catch (e) {
      alert("Доступ запрещен. Проверьте данные.");
    }
  };

  // --- DATA ACTIONS ---
  const fetchProjects = async () => {
    const res = await axios.get(`${API_URL}/projects`);
    setProjects(res.data);
  };

  const fetchProjectDetails = async (pid) => {
    const res = await axios.get(`${API_URL}/projects/${pid}`);
    setCurrentProject(res.data);
  };

  // --- RENDERERS ---
  
  if (view === 'login') {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center font-mono p-4">
        <div className="w-full max-w-md border border-white p-8">
          <h1 className="text-4xl font-bold mb-8 tracking-tighter">PROJECT MANAGER</h1>
          <div className="space-y-4">
            <div>
              <label className="block text-xs uppercase mb-1">ID / Admin Login</label>
              <input 
                className="w-full bg-black border border-gray-600 p-3 focus:border-white outline-none transition"
                value={creds.username} onChange={e => setCreds({...creds, username: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-xs uppercase mb-1">Password</label>
              <input 
                type="password"
                className="w-full bg-black border border-gray-600 p-3 focus:border-white outline-none transition"
                value={creds.password} onChange={e => setCreds({...creds, password: e.target.value})}
              />
            </div>
            <div className="grid grid-cols-2 gap-4 mt-6">
              <button onClick={() => handleLogin('client')} className="border border-white py-3 hover:bg-white hover:text-black transition uppercase font-bold text-sm">
                Вход Клиента
              </button>
              <button onClick={() => handleLogin('admin')} className="bg-white text-black py-3 hover:bg-gray-200 transition uppercase font-bold text-sm">
                Вход Админа
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white font-mono flex flex-col">
      {/* HEADER */}
      <header className="border-b border-gray-800 p-4 flex justify-between items-center">
        <div className="font-bold text-xl tracking-widest">PM:SYSTEM</div>
        <button onClick={() => setView('login')} className="text-xs uppercase hover:underline">Log Out</button>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* SIDEBAR (Admin only mostly) */}
        {auth.role === 'admin' && (
          <aside className="w-64 border-r border-gray-800 p-4 overflow-y-auto hidden md:block">
            <h3 className="text-gray-500 text-xs uppercase mb-4">Проекты</h3>
            {projects.map(p => (
              <div key={p.id} onClick={() => fetchProjectDetails(p.id)} 
                   className={`p-3 mb-2 cursor-pointer border hover:bg-gray-900 transition ${currentProject?.project.id === p.id ? 'border-white' : 'border-transparent'}`}>
                <div className="font-bold">{p.name}</div>
                <div className="text-xs text-gray-500">{p.id}</div>
              </div>
            ))}
            <button onClick={() => {/* Logic to create project modal */}} className="w-full mt-4 border border-dashed border-gray-600 p-2 text-xs uppercase hover:border-white text-center">
              + Новый проект
            </button>
          </aside>
        )}

        {/* MAIN CONTENT */}
        <main className="flex-1 flex flex-col p-0 md:p-6 overflow-hidden">
          {currentProject ? (
            <div className="flex-1 flex flex-col md:flex-row gap-6 h-full">
              
              {/* LEFT: Project Info */}
              <div className="flex-1 overflow-y-auto pr-2 space-y-6">
                <div className="border border-gray-800 p-6">
                  <div className="flex justify-between items-start mb-4">
                    <h2 className="text-3xl font-bold">{currentProject.project.name}</h2>
                    <span className="bg-white text-black px-2 py-1 text-xs font-bold">{currentProject.project.status}</span>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 text-sm text-gray-400 mb-6">
                    <div>Цена: <span className="text-white">{currentProject.project.price} ₽</span></div>
                    <div>Дедлайн: <span className="text-white">{currentProject.project.deadline ? new Date(currentProject.project.deadline).toLocaleDateString() : 'Не указан'}</span></div>
                  </div>

                  {/* Progress Bar */}
                  <div className="mb-6">
                    <div className="flex justify-between text-xs uppercase mb-1">
                      <span>Прогресс</span>
                      <span>{currentProject.project.progress}%</span>
                    </div>
                    <div className="w-full h-2 bg-gray-900">
                      <div className="h-full bg-white transition-all duration-500" style={{width: `${currentProject.project.progress}%`}}></div>
                    </div>
                  </div>

                  {/* Stages Timeline */}
                  <div className="space-y-2">
                     {JSON.parse(currentProject.project.stages).map((stage, idx) => (
                       <div key={idx} className="flex items-center gap-3 text-sm">
                         <div className={`w-3 h-3 rounded-full ${idx * 20 < currentProject.project.progress ? 'bg-white' : 'bg-gray-800'}`}></div>
                         <span className={idx * 20 < currentProject.project.progress ? 'text-white' : 'text-gray-600'}>{stage}</span>
                       </div>
                     ))}
                  </div>

                  {/* Payment Block */}
                  {!currentProject.project.paid && (
                    <div className="mt-8 border border-white p-4 text-center">
                      <div className="text-xs uppercase mb-2">Ожидается оплата</div>
                      <button className="bg-white text-black font-bold py-2 px-6 flex items-center justify-center gap-2 mx-auto hover:bg-gray-200">
                        <CreditCard size={16}/> Оплатить через YooKassa
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* RIGHT: Chat & Files */}
              <div className="w-full md:w-1/2 lg:w-96 flex flex-col border border-gray-800 h-[600px] md:h-auto">
                <div className="p-3 border-b border-gray-800 font-bold text-sm bg-zinc-950">ЧАТ ПРОЕКТА</div>
                
                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-black">
                  {currentProject.messages.map((msg, i) => (
                    <div key={i} className={`flex flex-col ${msg.sender === (auth.role === 'admin' ? 'admin' : 'client') ? 'items-end' : 'items-start'}`}>
                      <div className={`max-w-[80%] p-3 text-sm border ${msg.sender === 'admin' ? 'border-white bg-black' : 'border-gray-700 bg-gray-900'}`}>
                        {msg.content}
                        {msg.file_path && (
                           <div className="mt-2 text-xs underline cursor-pointer text-blue-400">
                             <a href={`${API_URL}/files/${msg.file_path}`} target="_blank">📄 Вложение</a>
                           </div>
                        )}
                      </div>
                      <span className="text-[10px] text-gray-600 mt-1">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                    </div>
                  ))}
                </div>

                <div className="p-3 border-t border-gray-800 flex gap-2">
                   {/* Chat Input Area (Simplified) */}
                   <input className="flex-1 bg-transparent border-b border-gray-700 focus:border-white outline-none text-sm p-1" placeholder="Сообщение..." />
                   <button className="text-white hover:text-gray-400"><Upload size={18}/></button>
                   <button className="text-white hover:text-gray-400"><Send size={18}/></button>
                </div>
              </div>

            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-600">Выберите проект</div>
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
