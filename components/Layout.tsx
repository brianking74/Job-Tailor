
import React from 'react';

interface LayoutProps {
  children: React.ReactNode;
  onLogoClick?: () => void;
  isLanding?: boolean;
}

export const Layout: React.FC<LayoutProps> = ({ children, onLogoClick, isLanding }) => {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-100 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-20 items-center">
            <div 
              className="flex items-center gap-2 cursor-pointer group" 
              onClick={onLogoClick}
            >
              <div className="bg-blue-600 p-2 rounded-xl transition-transform group-hover:scale-110">
                <i className="fas fa-bolt text-white"></i>
              </div>
              <span className="text-2xl font-bold text-slate-900 tracking-tight">
                Job<span className="text-blue-600">Tailor</span>
              </span>
            </div>
            
            <nav className="hidden md:flex space-x-10">
              <a href="#features" className="text-sm font-medium text-slate-600 hover:text-blue-600 transition-colors">Features</a>
              <a href="#pricing" className="text-sm font-medium text-slate-600 hover:text-blue-600 transition-colors">Pricing</a>
              <a href="#" className="text-sm font-medium text-slate-600 hover:text-blue-600 transition-colors">FAQ</a>
            </nav>

            <div className="flex items-center gap-4">
              <button 
                onClick={onLogoClick}
                className="hidden sm:block text-sm font-semibold text-slate-600 hover:text-blue-600"
              >
                Log In
              </button>
              <button 
                onClick={onLogoClick}
                className="bg-blue-600 text-white px-6 py-2.5 rounded-full text-sm font-bold hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all hover:-translate-y-0.5"
              >
                Get Started
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className={`flex-1 ${!isLanding ? 'max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-12' : ''}`}>
        {children}
      </main>

      <footer className="bg-slate-900 text-slate-400 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
            <div className="col-span-1 md:col-span-2">
              <div className="flex items-center gap-2 mb-6">
                <div className="bg-blue-600 p-1.5 rounded-lg">
                  <i className="fas fa-bolt text-white text-xs"></i>
                </div>
                <span className="text-xl font-bold text-white tracking-tight">
                  JobTailor
                </span>
              </div>
              <p className="max-w-xs text-sm leading-relaxed">
                Empowering job seekers with precision AI tools to dominate the modern recruitment landscape.
              </p>
            </div>
            <div>
              <h4 className="text-white font-bold mb-6">Product</h4>
              <ul className="space-y-4 text-sm">
                <li><a href="#" className="hover:text-white transition-colors">ATS Checker</a></li>
                <li><a href="#" className="hover:text-white transition-colors">CV Tailoring</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Cover Letters</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-bold mb-6">Legal</h4>
              <ul className="space-y-4 text-sm">
                <li><a href="#" className="hover:text-white transition-colors">Privacy Policy</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Terms of Service</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Contact Us</a></li>
              </ul>
            </div>
          </div>
          <div className="pt-8 border-t border-slate-800 text-center text-xs">
            &copy; {new Date().getFullYear()} JobTailor AI Job Suite. Precision matters.
          </div>
        </div>
      </footer>
    </div>
  );
};
