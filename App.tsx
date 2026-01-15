
import React, { useState, useRef, useEffect } from 'react';
import { Layout } from './components/Layout.tsx';
import { StepIndicator } from './components/StepIndicator.tsx';
import { AppStep, CVData, JobDescription, ATSAnalysis, TailoredDocuments } from './types.ts';
import { analyzeATS, generateTailoredContent } from './services/geminiService.ts';
import { downloadAsPDF, downloadAsWord } from './utils/exportUtils.ts';

// Global type declarations for CDN libraries
declare const mammoth: any;
declare const pdfjsLib: any;

const App: React.FC = () => {
  // Constants for localStorage keys
  const STORAGE_KEY_CV = 'jobtailor_cv_v1';
  const STORAGE_KEY_JD = 'jobtailor_jd_v1';

  const [step, setStep] = useState<AppStep>(AppStep.LANDING);
  
  // Initialize state from localStorage
  const [cvData, setCvData] = useState<CVData | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_CV);
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      console.error("Failed to load CV from storage", e);
      return null;
    }
  });

  const [jdData, setJdData] = useState<JobDescription | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_JD);
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      console.error("Failed to load JD from storage", e);
      return null;
    }
  });

  const [analysis, setAnalysis] = useState<ATSAnalysis | null>(null);
  const [tailored, setTailored] = useState<TailoredDocuments | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditingCV, setIsEditingCV] = useState(false);
  const [tempCVContent, setTempCVContent] = useState("");
  
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  // Sync state to localStorage
  useEffect(() => {
    if (cvData) {
      localStorage.setItem(STORAGE_KEY_CV, JSON.stringify(cvData));
    } else {
      localStorage.removeItem(STORAGE_KEY_CV);
    }
  }, [cvData]);

  useEffect(() => {
    if (jdData) {
      localStorage.setItem(STORAGE_KEY_JD, JSON.stringify(jdData));
    } else {
      localStorage.removeItem(STORAGE_KEY_JD);
    }
  }, [jdData]);

  const extractTextFromPDF = async (arrayBuffer: ArrayBuffer): Promise<string> => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    let fullText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(" ");
      fullText += pageText + "\n";
    }
    return fullText;
  };

  const extractTextFromDocx = async (arrayBuffer: ArrayBuffer): Promise<string> => {
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setError(null);

    try {
      const fileExtension = file.name.split('.').pop()?.toLowerCase();
      let extractedText = "";

      if (fileExtension === 'pdf') {
        const buffer = await file.arrayBuffer();
        extractedText = await extractTextFromPDF(buffer);
      } else if (fileExtension === 'docx') {
        const buffer = await file.arrayBuffer();
        extractedText = await extractTextFromDocx(buffer);
      } else {
        extractedText = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (event) => resolve(event.target?.result as string);
          reader.onerror = (error) => reject(error);
          reader.readAsText(file);
        });
      }

      if (!extractedText || extractedText.trim().length === 0) {
        throw new Error("Could not extract any text from the file.");
      }

      setCvData({ content: extractedText, fileName: file.name });
    } catch (err: any) {
      console.error(err);
      setError(`Failed to read file: ${err.message || 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const startAnalysis = async (customContent?: string) => {
    const contentToAnalyze = customContent || cvData?.content;
    if (!contentToAnalyze || !jdData) return;
    
    setIsLoading(true);
    setError(null);
    try {
      const result = await analyzeATS(contentToAnalyze, jdData.text);
      setAnalysis(result);
      if (customContent) {
        setCvData(prev => prev ? { ...prev, content: customContent } : null);
        setIsEditingCV(false);
      }
      setStep(AppStep.ANALYSIS);
    } catch (err: any) {
      console.error(err);
      setError(`Failed to analyze documents: ${err.message || 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessingPayment(true);
    // Simulate payment processing delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    setIsProcessingPayment(false);
    setShowPaymentModal(false);
    startTailoring();
  };

  const startTailoring = async () => {
    if (!cvData || !jdData) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await generateTailoredContent(cvData.content, jdData.text);
      setTailored(result);
      setStep(AppStep.TAILORING);
    } catch (err: any) {
      console.error(err);
      setError(`Failed to generate tailored documents: ${err.message || 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenEditor = () => {
    setTempCVContent(cvData?.content || "");
    setIsEditingCV(true);
  };

  const applyFormat = (type: 'bold' | 'italic' | 'bullet') => {
    if (!textAreaRef.current) return;

    const start = textAreaRef.current.selectionStart;
    const end = textAreaRef.current.selectionEnd;
    const selectedText = tempCVContent.substring(start, end);
    let newText = "";

    if (type === 'bold') {
      newText = `**${selectedText}**`;
    } else if (type === 'italic') {
      newText = `*${selectedText}*`;
    } else if (type === 'bullet') {
      newText = selectedText
        .split('\n')
        .map(line => line.startsWith('- ') ? line : `- ${line}`)
        .join('\n');
    }

    const updatedContent = tempCVContent.substring(0, start) + newText + tempCVContent.substring(end);
    setTempCVContent(updatedContent);

    // Reset focus and selection
    setTimeout(() => {
      if (textAreaRef.current) {
        textAreaRef.current.focus();
        textAreaRef.current.setSelectionRange(start, start + newText.length);
      }
    }, 0);
  };

  const PaymentModal = () => (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-fadeIn" onClick={() => !isProcessingPayment && setShowPaymentModal(false)}></div>
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl relative z-10 overflow-hidden animate-fadeInUp">
        <div className="bg-blue-600 p-8 text-white">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-bold">Secure Checkout</h3>
            <button onClick={() => setShowPaymentModal(false)} className="text-white/60 hover:text-white transition-colors">
              <i className="fas fa-times text-xl"></i>
            </button>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
              <i className="fas fa-wand-magic-sparkles text-xl"></i>
            </div>
            <div>
              <div className="text-sm text-white/80 font-medium">Tailored Asset Suite</div>
              <div className="text-2xl font-black">$5.00</div>
            </div>
          </div>
        </div>
        
        <form onSubmit={handlePaymentSubmit} className="p-8">
          <div className="space-y-4 mb-8">
            <div>
              <label className="block text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Cardholder Name</label>
              <input required type="text" placeholder="John Doe" className="w-full p-4 border border-slate-200 rounded-xl outline-none focus:ring-4 focus:ring-blue-50 focus:border-blue-500 transition-all" />
            </div>
            <div>
              <label className="block text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Card Number</label>
              <div className="relative">
                <input required type="text" placeholder="0000 0000 0000 0000" className="w-full p-4 border border-slate-200 rounded-xl outline-none focus:ring-4 focus:ring-blue-50 focus:border-blue-500 transition-all pl-12" />
                <i className="fas fa-credit-card absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Expiry</label>
                <input required type="text" placeholder="MM/YY" className="w-full p-4 border border-slate-200 rounded-xl outline-none focus:ring-4 focus:ring-blue-50 focus:border-blue-500 transition-all" />
              </div>
              <div>
                <label className="block text-xs font-black uppercase tracking-widest text-slate-400 mb-2">CVC</label>
                <input required type="text" placeholder="123" className="w-full p-4 border border-slate-200 rounded-xl outline-none focus:ring-4 focus:ring-blue-50 focus:border-blue-500 transition-all" />
              </div>
            </div>
          </div>
          
          <button 
            type="submit" 
            disabled={isProcessingPayment}
            className="w-full py-5 rounded-2xl bg-blue-600 text-white font-black text-lg hover:bg-blue-700 shadow-xl shadow-blue-200 transition-all flex items-center justify-center gap-3 disabled:opacity-70"
          >
            {isProcessingPayment ? (
              <>Verifying <i className="fas fa-circle-notch fa-spin"></i></>
            ) : (
              <>Pay $5.00 <i className="fas fa-lock text-sm ml-1"></i></>
            )}
          </button>
          <div className="text-center mt-6 text-xs text-slate-400 font-medium">
            <i className="fas fa-shield-halved mr-2"></i> Encrypted & Secure Payment
          </div>
        </form>
      </div>
    </div>
  );

  const LandingPage = () => (
    <div className="bg-white">
      {/* Hero Section */}
      <section className="relative py-20 lg:py-32 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div className="animate-fadeInLeft">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-full text-sm font-bold mb-6">
                <i className="fas fa-sparkles"></i>
                AI-Powered Career Success
              </div>
              <h1 className="text-5xl lg:text-7xl font-bold text-slate-900 leading-tight mb-8">
                Maximum Impact For Your <span className="text-blue-600">Dream Career</span>
              </h1>
              <p className="text-xl text-slate-600 mb-10 leading-relaxed max-w-lg">
                Stop sending generic applications. Our AI engine builds tailored, high-converting CVs and Cover Letters that bypass ATS filters and land interviews.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 mb-8">
                <button 
                  onClick={() => setStep(AppStep.UPLOAD_CV)}
                  className="bg-blue-600 text-white px-8 py-4 rounded-full font-bold hover:bg-blue-700 shadow-xl shadow-blue-200 transition-all hover:-translate-y-1"
                >
                  Start Applying Now <i className="fas fa-arrow-right ml-2"></i>
                </button>
                <button className="bg-white border border-slate-200 text-slate-700 px-8 py-4 rounded-full font-bold hover:bg-slate-50 transition-all">
                  Watch Demo
                </button>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex -space-x-3">
                  {[1, 2, 3, 4].map(i => (
                    <img key={i} src={`https://i.pravatar.cc/150?u=person${i}`} className="w-10 h-10 rounded-full border-2 border-white shadow-sm" alt="User" />
                  ))}
                </div>
                <div className="text-sm text-slate-500 font-medium">
                  <span className="text-slate-900 font-bold">10k+</span> professionals landing interviews
                </div>
              </div>
            </div>
            <div className="relative animate-fadeInRight">
              <div className="relative z-10">
                 <img 
                  src="https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=600&h=800" 
                  alt="Professional Woman" 
                  className="rounded-3xl shadow-2xl w-full max-w-md mx-auto object-cover aspect-[3/4]"
                />
                <div className="absolute -bottom-6 -left-6 bg-white p-6 rounded-2xl shadow-xl border border-slate-100 max-w-[240px] hidden md:block animate-bounce-slow">
                   <div className="flex items-center gap-3 mb-3">
                    <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center text-green-600">
                      <i className="fas fa-check text-xs"></i>
                    </div>
                    <span className="text-xs font-bold text-slate-900">Success! Application Sent</span>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-tight">Sarah just landed an interview at Google using JobTailor.</p>
                </div>
              </div>
              {/* Decorative accents */}
              <div className="absolute top-1/2 right-0 w-64 h-64 bg-blue-100 rounded-full blur-3xl -z-10 translate-x-1/4 -translate-y-1/2"></div>
            </div>
          </div>
        </div>
      </section>

      {/* Human Touch / Trusted By Section */}
      <section className="py-24 bg-white border-y border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
           <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-slate-900 mb-4">Empowering Professionals Globally</h2>
            <p className="text-slate-500 max-w-2xl mx-auto italic font-serif text-lg">"The precision of the tailoring is unmatched. I went from zero responses to three interview calls in one week."</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            {[
              { name: "Michael Chen", role: "Software Engineer", img: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=200&h=200", quote: "JobTailor helped me highlight the exact skills Amazon was looking for. The ATS score analysis is a game changer." },
              { name: "Jessica Williams", role: "Marketing Director", img: "https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&q=80&w=200&h=200", quote: "The cover letters sound human and professional, not robotic. It saved me hours of frustration." },
              { name: "David Rodriguez", role: "Product Manager", img: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&q=80&w=200&h=200", quote: "Finally, a tool that understands the nuances of senior-level applications. Worth every penny." }
            ].map((t, i) => (
              <div key={i} className="flex flex-col items-center text-center group">
                <img src={t.img} alt={t.name} className="w-20 h-20 rounded-full object-cover mb-6 border-4 border-blue-50 group-hover:border-blue-200 transition-colors shadow-md" />
                <h4 className="font-bold text-slate-900 text-lg">{t.name}</h4>
                <div className="text-blue-600 text-sm font-bold mb-4 uppercase tracking-widest">{t.role}</div>
                <p className="text-slate-500 text-sm italic leading-relaxed">"{t.quote}"</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-24 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <h2 className="text-3xl lg:text-4xl font-bold text-slate-900 mb-4">The Smart Way to Apply</h2>
            <p className="text-slate-500 max-w-2xl mx-auto">Our workflow mimics a professional career consultant, ensuring every detail of your application is perfect.</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { icon: 'fa-search', title: 'ATS Analysis', desc: 'Instantly see how your resume ranks against specific job requirements.', color: 'bg-blue-500' },
              { icon: 'fa-wand-magic-sparkles', title: 'AI Tailoring', desc: 'Precision-crafted content that matches the hiring manager’s needs.', color: 'bg-indigo-500' },
              { icon: 'fa-envelope-open-text', title: 'Recruiter Email', desc: 'Customized outreach messages that actually get opened and read.', color: 'bg-violet-500' },
              { icon: 'fa-cloud-arrow-down', title: 'Multi-Format Export', desc: 'Professional PDF and Word exports ready for submission.', color: 'bg-emerald-500' }
            ].map((f, i) => (
              <div key={i} className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100 hover:shadow-xl hover:-translate-y-2 transition-all group">
                <div className={`w-14 h-14 ${f.color} rounded-2xl flex items-center justify-center text-white mb-6 group-hover:scale-110 transition-transform`}>
                  <i className={`fas ${f.icon} text-xl`}></i>
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-3">{f.title}</h3>
                <p className="text-slate-500 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <h2 className="text-3xl lg:text-4xl font-bold text-slate-900 mb-4">Simple, Performance-Based Pricing</h2>
            <p className="text-slate-500">No subscriptions. Pay as you grow.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            {/* Free Tier */}
            <div className="bg-white p-10 rounded-3xl border border-slate-200 shadow-sm relative overflow-hidden transition-all hover:border-slate-300">
              <h3 className="text-xl font-bold mb-2">Free Analyzer</h3>
              <div className="text-4xl font-bold mb-6">$0</div>
              <ul className="space-y-4 mb-10 text-sm text-slate-600">
                <li className="flex items-center gap-3"><i className="fas fa-check text-emerald-500"></i> Full ATS Score Analysis</li>
                <li className="flex items-center gap-3"><i className="fas fa-check text-emerald-500"></i> Missing Keyword Detection</li>
                <li className="flex items-center gap-3"><i className="fas fa-check text-emerald-500"></i> Improvement Suggestions</li>
                <li className="flex items-center gap-3"><i className="fas fa-check text-emerald-500"></i> Manual CV Editor</li>
              </ul>
              <button 
                onClick={() => setStep(AppStep.UPLOAD_CV)}
                className="w-full py-4 rounded-full border-2 border-slate-200 font-bold hover:bg-slate-50 transition-all"
              >
                Get Started
              </button>
            </div>

            {/* Premium Tier */}
            <div className="bg-slate-900 p-10 rounded-3xl border border-blue-600 shadow-2xl relative overflow-hidden text-white transition-all hover:scale-[1.02]">
              <div className="absolute top-0 right-0 bg-blue-600 text-[10px] font-black uppercase px-4 py-1.5 -rotate-45 translate-x-5 translate-y-3">Popular</div>
              <h3 className="text-xl font-bold mb-2 text-blue-400">Tailored Suite</h3>
              <div className="text-4xl font-bold mb-2">$5 <span className="text-lg font-normal text-slate-500">/ generation</span></div>
              <p className="text-xs text-slate-400 mb-6">Perfect for high-priority dream jobs.</p>
              <ul className="space-y-4 mb-10 text-sm text-slate-300">
                <li className="flex items-center gap-3"><i className="fas fa-check text-blue-500"></i> AI-Optimized Tailored CV</li>
                <li className="flex items-center gap-3"><i className="fas fa-check text-blue-500"></i> Professionally Written Cover Letter</li>
                <li className="flex items-center gap-3"><i className="fas fa-check text-blue-500"></i> Personalized Outreach Email</li>
                <li className="flex items-center gap-3"><i className="fas fa-check text-blue-500"></i> Full ATS Score Analysis</li>
                <li className="flex items-center gap-3"><i className="fas fa-check text-blue-500"></i> Missing Keyword Detection</li>
                <li className="flex items-center gap-3"><i className="fas fa-check text-blue-500"></i> Export to PDF & Docx</li>
              </ul>
              <button 
                onClick={() => setStep(AppStep.UPLOAD_CV)}
                className="w-full py-4 rounded-full bg-blue-600 text-white font-bold hover:bg-blue-700 shadow-xl shadow-blue-900/40 transition-all hover:-translate-y-1"
              >
                Go Premium
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Social Proof / Call to Action */}
      <section className="py-24 bg-blue-600 relative overflow-hidden">
        <div className="max-w-4xl mx-auto px-4 text-center text-white relative z-10">
          <h2 className="text-4xl font-bold mb-8">Ready to Land Your Next Interview?</h2>
          <p className="text-blue-100 mb-12 text-xl leading-relaxed">Join thousands of high-performers who use JobTailor to bypass the noise and get noticed by top recruiters.</p>
          <button 
            onClick={() => setStep(AppStep.UPLOAD_CV)}
            className="bg-white text-blue-600 px-12 py-5 rounded-full font-black text-xl hover:scale-105 transition-transform shadow-2xl"
          >
            Create My Tailored Application <i className="fas fa-rocket ml-2"></i>
          </button>
        </div>
        {/* Abstract shapes */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500 rounded-full blur-3xl opacity-20 -translate-y-1/2 translate-x-1/2"></div>
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-blue-700 rounded-full blur-3xl opacity-20 translate-y-1/2 -translate-x-1/2"></div>
      </section>
    </div>
  );

  return (
    <Layout 
      onLogoClick={() => setStep(AppStep.LANDING)} 
      isLanding={step === AppStep.LANDING}
    >
      {showPaymentModal && <PaymentModal />}
      
      {step === AppStep.LANDING ? (
        <LandingPage />
      ) : (
        <div className="max-w-4xl mx-auto py-12">
          <StepIndicator currentStep={step} />

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl flex items-center gap-3">
              <i className="fas fa-circle-exclamation text-xl"></i>
              <div>
                <p className="font-bold">Error encountered</p>
                <p className="text-sm opacity-90">{error}</p>
              </div>
            </div>
          )}

          {/* Step 1: Upload CV */}
          {step === AppStep.UPLOAD_CV && (
            <div className="bg-white p-10 rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100 animate-fadeIn">
              <h2 className="text-3xl font-bold mb-2 text-slate-900">Step 1: Upload Your Master CV</h2>
              <p className="text-slate-500 mb-10 text-lg">We use your master file as the DNA for all tailored variations.</p>
              
              <div className={`border-2 border-dashed rounded-3xl p-16 text-center transition-all ${isLoading ? 'border-blue-200 bg-blue-50/30 cursor-wait' : 'border-slate-200 hover:border-blue-400 hover:bg-blue-50/10 cursor-pointer'}`}>
                <input 
                  type="file" 
                  id="cv-upload" 
                  className="hidden" 
                  accept=".txt,.md,.rtf,.pdf,.docx" 
                  onChange={handleFileUpload} 
                  disabled={isLoading}
                />
                <label htmlFor="cv-upload" className={isLoading ? 'cursor-wait' : 'cursor-pointer'}>
                  <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-sm">
                    {isLoading ? (
                      <i className="fas fa-circle-notch fa-spin text-3xl"></i>
                    ) : (
                      <i className="fas fa-file-upload text-3xl"></i>
                    )}
                  </div>
                  <div className="text-xl font-bold text-slate-900 mb-2">
                    {isLoading ? "Processing file..." : (cvData ? cvData.fileName : "Select your Resume")}
                  </div>
                  <p className="text-sm text-slate-400">PDF, DOCX, or Text (Max 5MB)</p>
                </label>
              </div>

              {cvData && !isLoading && (
                <div className="mt-10 flex justify-end">
                  <button 
                    onClick={() => setStep(AppStep.JOB_DETAILS)}
                    className="bg-blue-600 text-white px-8 py-4 rounded-full font-bold hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all flex items-center gap-2"
                  >
                    Next: Paste Job Description <i className="fas fa-arrow-right"></i>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Job Details */}
          {step === AppStep.JOB_DETAILS && (
            <div className="bg-white p-10 rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100 animate-fadeIn">
              <h2 className="text-3xl font-bold mb-2 text-slate-900">The Target Role</h2>
              <p className="text-slate-500 mb-10 text-lg">Paste the full job description. The more detail, the better the tailoring.</p>
              
              <textarea
                className="w-full h-80 p-6 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all resize-none text-slate-700 leading-relaxed"
                placeholder="Paste job description here..."
                value={jdData?.text || ''}
                onChange={(e) => setJdData({ text: e.target.value })}
              />

              <div className="mt-10 flex justify-between items-center">
                <button 
                  onClick={() => setStep(AppStep.UPLOAD_CV)}
                  className="text-slate-500 font-bold hover:text-blue-600 transition-colors flex items-center gap-2"
                >
                  <i className="fas fa-chevron-left"></i> Back
                </button>
                <button 
                  onClick={() => startAnalysis()}
                  disabled={!jdData?.text || isLoading}
                  className="bg-blue-600 text-white px-10 py-4 rounded-full font-bold hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all disabled:opacity-50 flex items-center gap-2"
                >
                  {isLoading ? (
                    <>Processing <i className="fas fa-spinner fa-spin"></i></>
                  ) : (
                    <>Analyze Match <i className="fas fa-chart-line"></i></>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Analysis */}
          {step === AppStep.ANALYSIS && analysis && (
            <div className="space-y-8 animate-fadeIn">
              <div className="bg-white p-10 rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100">
                <div className="flex flex-col md:flex-row gap-10 items-center mb-12">
                  <div className="relative w-40 h-40 flex-shrink-0">
                    <svg className="w-full h-full transform -rotate-90">
                      <circle cx="80" cy="80" r="72" stroke="currentColor" strokeWidth="12" fill="transparent" className="text-slate-100" />
                      <circle cx="80" cy="80" r="72" stroke="currentColor" strokeWidth="12" fill="transparent" 
                        strokeDasharray={452} 
                        strokeDashoffset={452 - (452 * analysis.score) / 100}
                        className="text-blue-600 transition-all duration-1000 ease-out" 
                        strokeLinecap="round"
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-4xl font-black text-slate-900">{analysis.score}%</span>
                      <span className="text-[10px] uppercase font-black text-slate-400 tracking-widest">Match Score</span>
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h2 className="text-3xl font-bold text-slate-900">ATS Insights</h2>
                        <p className="text-slate-500 mt-2">Here is how you currently stand. Use the editor below to bridge the gap manually or let us tailor it for you.</p>
                      </div>
                      {!isEditingCV && (
                        <button 
                          onClick={handleOpenEditor}
                          className="text-sm font-bold text-blue-600 bg-blue-50 px-5 py-2.5 rounded-full hover:bg-blue-100 transition-colors flex items-center gap-2"
                        >
                          <i className="fas fa-edit"></i> Refine Text
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {isEditingCV ? (
                  <div className="mb-10 border-2 border-blue-100 rounded-3xl p-8 bg-blue-50/20 animate-fadeIn">
                    <div className="flex justify-between items-center mb-6">
                      <h3 className="font-black text-slate-900 flex items-center gap-3">
                        <i className="fas fa-pen-nib text-blue-600"></i> Interactive Optimizer
                      </h3>
                      <div className="flex gap-4">
                        <button 
                          onClick={() => setIsEditingCV(false)}
                          className="text-slate-500 px-4 py-2 text-sm font-bold"
                        >
                          Cancel
                        </button>
                        <button 
                          onClick={() => startAnalysis(tempCVContent)}
                          disabled={isLoading}
                          className="bg-blue-600 text-white px-6 py-2.5 rounded-full text-sm font-bold hover:bg-blue-700 shadow-md shadow-blue-200"
                        >
                          Save & Update Score
                        </button>
                      </div>
                    </div>
                    
                    <div className="flex gap-2 mb-4 bg-white p-1.5 rounded-xl border border-slate-100 shadow-sm w-fit">
                      <button onClick={() => applyFormat('bold')} className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-slate-50 text-slate-700"><i className="fas fa-bold"></i></button>
                      <button onClick={() => applyFormat('italic')} className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-slate-50 text-slate-700"><i className="fas fa-italic"></i></button>
                      <button onClick={() => applyFormat('bullet')} className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-slate-50 text-slate-700"><i className="fas fa-list-ul"></i></button>
                    </div>

                    <textarea
                      ref={textAreaRef}
                      className="w-full h-96 p-6 border border-slate-100 rounded-2xl focus:ring-4 focus:ring-blue-50 outline-none transition-all font-mono text-sm leading-relaxed"
                      value={tempCVContent}
                      onChange={(e) => setTempCVContent(e.target.value)}
                    />
                  </div>
                ) : null}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="bg-emerald-50/50 p-8 rounded-3xl border border-emerald-100">
                    <h3 className="text-emerald-800 font-bold flex items-center gap-3 mb-6">
                      <i className="fas fa-circle-check text-xl"></i> Strong Matches
                    </h3>
                    <ul className="space-y-3">
                      {analysis.strengths.map((s, i) => <li key={i} className="text-emerald-700 text-sm flex items-start gap-3"><i className="fas fa-plus text-[10px] mt-1.5 bg-emerald-200 p-0.5 rounded-full"></i>{s}</li>)}
                    </ul>
                  </div>
                  <div className="bg-amber-50/50 p-8 rounded-3xl border border-amber-100">
                    <h3 className="text-amber-800 font-bold flex items-center gap-3 mb-6">
                      <i className="fas fa-lightbulb text-xl"></i> Missing Focus
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {analysis.missingKeywords.map((k, i) => <span key={i} className="px-4 py-2 bg-white text-amber-700 rounded-xl text-xs font-bold border border-amber-200 shadow-sm">{k}</span>)}
                    </div>
                  </div>
                </div>

                <div className="mt-10 p-8 bg-slate-50 rounded-3xl border border-slate-100">
                  <h3 className="font-bold text-slate-900 mb-6 flex items-center gap-3"><i className="fas fa-list-check text-blue-600"></i> Actionable Suggestions</h3>
                  <div className="space-y-4">
                    {analysis.suggestions.map((s, i) => (
                      <div key={i} className="flex gap-4 p-5 bg-white rounded-2xl text-sm text-slate-700 border border-slate-100 shadow-sm">
                        <div className="w-6 h-6 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold">{i+1}</div>
                        {s}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center">
                <button onClick={() => setStep(AppStep.JOB_DETAILS)} className="text-slate-500 font-bold hover:text-slate-900">Modify JD</button>
                <button 
                  onClick={() => setShowPaymentModal(true)}
                  disabled={isLoading || isEditingCV}
                  className="bg-blue-600 text-white px-12 py-5 rounded-full font-black text-lg hover:bg-blue-700 shadow-2xl shadow-blue-200 flex items-center gap-3 disabled:opacity-50"
                >
                  {isLoading ? (
                    <>Optimizing Assets <i className="fas fa-spinner fa-spin"></i></>
                  ) : (
                    <>Generate Premium Assets ($5) <i className="fas fa-wand-magic-sparkles"></i></>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Tailoring Results */}
          {step === AppStep.TAILORING && tailored && (
            <div className="space-y-10 animate-fadeIn">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                {/* CV Section */}
                <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm flex flex-col min-h-[600px]">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="font-black text-xl text-slate-900">Tailored Resume</h3>
                    <div className="flex gap-3">
                      <button onClick={() => downloadAsPDF(tailored.cv, 'Tailored_CV')} className="w-10 h-10 flex items-center justify-center text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl transition-all" title="PDF"><i className="fas fa-file-pdf"></i></button>
                      <button onClick={() => downloadAsWord(tailored.cv, 'Tailored_CV')} className="w-10 h-10 flex items-center justify-center text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition-all" title="Word"><i className="fas fa-file-word"></i></button>
                    </div>
                  </div>
                  <div className="flex-1 bg-slate-50 p-8 rounded-2xl border border-slate-100 overflow-y-auto text-sm font-mono whitespace-pre-wrap text-slate-700 shadow-inner">
                    {tailored.cv}
                  </div>
                </div>

                {/* Cover Letter Section */}
                <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm flex flex-col min-h-[600px]">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="font-black text-xl text-slate-900">Cover Letter</h3>
                    <div className="flex gap-3">
                      <button onClick={() => downloadAsPDF(tailored.coverLetter, 'Cover_Letter')} className="w-10 h-10 flex items-center justify-center text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl transition-all" title="PDF"><i className="fas fa-file-pdf"></i></button>
                      <button onClick={() => downloadAsWord(tailored.coverLetter, 'Cover_Letter')} className="w-10 h-10 flex items-center justify-center text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition-all" title="Word"><i className="fas fa-file-word"></i></button>
                    </div>
                  </div>
                  <div className="flex-1 bg-slate-50 p-8 rounded-2xl border border-slate-100 overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap text-slate-700 shadow-inner">
                    {tailored.coverLetter}
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center">
                <button onClick={() => setStep(AppStep.ANALYSIS)} className="text-slate-500 font-bold hover:text-slate-900">Back to Analysis</button>
                <button 
                  onClick={() => setStep(AppStep.OUTREACH)}
                  className="bg-blue-600 text-white px-12 py-5 rounded-full font-black text-lg hover:bg-blue-700 shadow-2xl shadow-blue-200 flex items-center gap-3"
                >
                  Final Step: Outreach <i className="fas fa-paper-plane"></i>
                </button>
              </div>
            </div>
          )}

          {/* Step 5: Outreach */}
          {step === AppStep.OUTREACH && tailored && (
            <div className="bg-white p-10 rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100 animate-fadeIn">
              <h2 className="text-3xl font-bold mb-2 text-slate-900">Recruiter Outreach</h2>
              <p className="text-slate-500 mb-10 text-lg">Send this message directly to the hiring manager for maximum visibility.</p>
              
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Recruiter Email</label>
                    <input type="email" placeholder="name@company.com" className="w-full p-4 border border-slate-200 rounded-xl outline-none focus:ring-4 focus:ring-blue-50 focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Subject Line</label>
                    <input type="text" defaultValue={`Application for ${jdData?.role || 'the position'}`} className="w-full p-4 border border-slate-200 rounded-xl outline-none focus:ring-4 focus:ring-blue-50 focus:border-blue-500 font-bold" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Personalized Message</label>
                  <textarea 
                    className="w-full h-80 p-6 border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-blue-50 focus:border-blue-500 resize-none text-slate-700 leading-relaxed"
                    defaultValue={tailored.emailBody}
                  />
                </div>
              </div>

              <div className="mt-12 flex justify-between items-center">
                <button onClick={() => setStep(AppStep.TAILORING)} className="text-slate-500 font-bold hover:text-slate-900">Edit Assets</button>
                <div className="flex gap-4">
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(tailored.emailBody);
                      alert("Message copied to clipboard!");
                    }}
                    className="bg-white border-2 border-slate-200 text-slate-700 px-8 py-4 rounded-full font-bold hover:bg-slate-50 transition-all flex items-center gap-3"
                  >
                    <i className="fas fa-copy"></i> Copy Content
                  </button>
                  <button 
                    onClick={() => {
                      const mailtoUrl = `mailto:?subject=${encodeURIComponent(`Job Application`)}&body=${encodeURIComponent(tailored.emailBody)}`;
                      window.location.href = mailtoUrl;
                    }}
                    className="bg-blue-600 text-white px-10 py-4 rounded-full font-black hover:bg-blue-700 shadow-xl shadow-blue-200 transition-all flex items-center gap-3"
                  >
                    Open Mail Client <i className="fas fa-envelope"></i>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </Layout>
  );
};

export default App;
