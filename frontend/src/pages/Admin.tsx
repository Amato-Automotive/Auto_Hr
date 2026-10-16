import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Construction } from 'lucide-react';
import logoImg from '../images/autoform-logo.png';

const Admin: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-app-bg relative flex items-center justify-center font-sans p-4 overflow-hidden">
      {/* Background Glowing Blobs */}
      <div className="absolute top-[-10%] right-[-10%] w-[50vw] h-[50vw] rounded-full bg-brand-orange/10 blur-[120px] pointer-events-none animate-pulse-slow" />
      <div className="absolute bottom-[-10%] left-[-10%] w-[50vw] h-[50vw] rounded-full bg-blue-400/5 blur-[120px] pointer-events-none animate-pulse-slow" />

      <div className="w-full max-w-md relative z-10 text-center animate-scale-in">
        <div className="mb-6">
          <img 
            src={logoImg} 
            alt="Autoform India" 
            className="w-64 h-auto mx-auto mb-2 drop-shadow-sm select-none"
            draggable={false}
          />
          <h1 className="text-4xl font-script text-slate-800 leading-none">Autoform Connect</h1>
          <p className="text-slate-500 font-semibold text-xs tracking-wider uppercase mt-1.5 opacity-80">Autoform India Employee Portal</p>
        </div>

        <div className="bg-white/85 backdrop-blur-xl border border-orange-100 shadow-2xl p-8 rounded-[32px] flex flex-col items-center">
          <div className="w-14 h-14 rounded-2xl bg-orange-50 text-[#f46617] border border-orange-100 flex items-center justify-center mb-4 shadow-sm animate-float">
            <Construction className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-black text-slate-800 tracking-tight mb-1">Admin Panel</h2>
          <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-6">Section Under Construction</p>
          
          <button
            onClick={() => navigate('/')}
            className="btn-orange w-full py-3 text-sm font-bold rounded-2xl"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Dashboard</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default Admin;