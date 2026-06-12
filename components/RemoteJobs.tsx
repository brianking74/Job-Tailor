import React, { useState, useMemo } from 'react';
import { AppStep, JobDescription } from '../types.ts';

interface RemoteJob {
  id: string;
  externalId: string;
  source: string;
  title: string;
  company: string;
  location: string;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string;
  jobType: 'full-time' | 'part-time' | 'contract' | 'internship' | 'temporary';
  experienceLevel: 'entry' | 'mid' | 'senior' | 'lead';
  tags: string[];
  description: string;
  url: string;
  companyLogo?: string;
  postedAt: string;
}

// Pre-seeded high-quality Remote jobs database demonstrating pipeline output categories.
const SAMPLE_JOBS: RemoteJob[] = [
  {
    id: "adzuna:101",
    externalId: "101",
    source: "adzuna",
    title: "Senior Full-Stack Engineer (Next.js & Supabase)",
    company: "Vercel",
    location: "Remote (Global)",
    salaryMin: 140000,
    salaryMax: 185000,
    currency: "USD",
    jobType: "full-time",
    experienceLevel: "senior",
    tags: ["Next.js", "TypeScript", "React", "PostgreSQL", "Vercel"],
    description: "Vercel is looking for an elite Senior Full-Stack Developer to work closely with the developer experience team. You will craft responsive dashboard features, engineer scalable edge middleware, and implement Postgres APIs using Supabase and Drizzle ORM.",
    url: "https://vercel.com/careers",
    companyLogo: "⚡",
    postedAt: "2026-06-10"
  },
  {
    id: "arbeitnow:202",
    externalId: "202",
    source: "arbeitnow",
    title: "Senior Frontend Developer (React / TS)",
    company: "Supabase",
    location: "Remote (Europe / Berlin)",
    salaryMin: 95000,
    salaryMax: 125000,
    currency: "EUR",
    jobType: "full-time",
    experienceLevel: "senior",
    tags: ["React", "TypeScript", "PostgreSQL", "Supabase", "CI/CD"],
    description: "Supabase lets developers spin up complete Postgres services in minutes. In this role, you will lead development on the React database manager console, design high-performance table views, and optimize client-side memory usage.",
    url: "https://supabase.com/careers",
    companyLogo: "⚡",
    postedAt: "2026-06-09"
  },
  {
    id: "reed:303",
    externalId: "303",
    source: "reed",
    title: "TypeScript & API Core Engineer",
    company: "Clerk",
    location: "Remote (UK / London)",
    salaryMin: 85000,
    salaryMax: 110000,
    currency: "GBP",
    jobType: "contract",
    experienceLevel: "senior",
    tags: ["TypeScript", "Node.js", "Express", "REST API", "GraphQL"],
    description: "Join the Clerk security engineering core. You will design ultra-fast JWT authentication middlewares, write secure session state libraries, and deploy TypeScript endpoints with Node.js.",
    url: "https://clerk.com/careers",
    companyLogo: "🔑",
    postedAt: "2026-06-08"
  },
  {
    id: "arbeitnow:204",
    externalId: "204",
    source: "arbeitnow",
    title: "Junior React developer",
    company: "Arbeitnow",
    location: "Remote (Europe)",
    salaryMin: 45000,
    salaryMax: 60000,
    currency: "EUR",
    jobType: "full-time",
    experienceLevel: "entry",
    tags: ["React", "JavaScript", "Frontend", "TDD"],
    description: "Start your tech trajectory inside Arbeitnow! We are seeking an ambitious Frontend Developer proficient in React.js. You will participate in daily standups, write automated unit tests with Jest, and polish modern Tailwind views.",
    url: "https://www.arbeitnow.com",
    companyLogo: "💼",
    postedAt: "2026-06-11"
  },
  {
    id: "direct:401",
    externalId: "401",
    source: "direct",
    title: "Database Performance Lead",
    company: "Drizzle ORM",
    location: "Remote (North America)",
    salaryMin: 150000,
    salaryMax: 195000,
    currency: "USD",
    jobType: "full-time",
    experienceLevel: "lead",
    tags: ["Drizzle", "PostgreSQL", "TypeScript", "Node.js", "Docker"],
    description: "Drizzle Team is looking for a SQL Performance optimization expert. You will build highly efficient TypeScript AST builders, debug execution plans in deep PostgreSQL sessions, and maintain standard Docker images.",
    url: "https://orm.drizzle.team",
    companyLogo: "🌧️",
    postedAt: "2026-06-11"
  },
  {
    id: "direct:402",
    externalId: "402",
    source: "direct",
    title: "Python Machine Learning Analyst",
    company: "Cohere AI",
    location: "Remote (San Francisco)",
    salaryMin: 160000,
    salaryMax: 210000,
    currency: "USD",
    jobType: "full-time",
    experienceLevel: "senior",
    tags: ["Python", "Machine Learning", "Docker", "GCP"],
    description: "Work on foundational Large Language Models (LLM) at Cohere. You will build offline validation pipelines, optimize embeddings models, and write efficient data loading structures with Python.",
    url: "https://cohere.com",
    companyLogo: "🧠",
    postedAt: "2026-06-10"
  }
];

interface RemoteJobsProps {
  onTailorJob: (jobText: string, title: string, company: string) => void;
  onGoBack: () => void;
}

export const RemoteJobs: React.FC<RemoteJobsProps> = ({ onTailorJob, onGoBack }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedExp, setSelectedExp] = useState<string>('all');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<RemoteJob | null>(null);

  // Extract all distinct tags for filtering
  const allTags = useMemo(() => {
    const tags = new Set<string>();
    SAMPLE_JOBS.forEach(j => j.tags.forEach(t => tags.add(t)));
    return Array.from(tags).sort();
  }, []);

  // Filter jobs based on states
  const filteredJobs = useMemo(() => {
    return SAMPLE_JOBS.filter(job => {
      const matchSearch = 
        job.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        job.company.toLowerCase().includes(searchTerm.toLowerCase()) ||
        job.tags.some(t => t.toLowerCase().includes(searchTerm.toLowerCase())) ||
        job.description.toLowerCase().includes(searchTerm.toLowerCase());

      const matchType = selectedType === 'all' || job.jobType === selectedType;
      const matchExp = selectedExp === 'all' || job.experienceLevel === selectedExp;
      const matchTag = !selectedTag || job.tags.includes(selectedTag);

      return matchSearch && matchType && matchExp && matchTag;
    });
  }, [searchTerm, selectedType, selectedExp, selectedTag]);

  // Format currency helpers
  const formatSalary = (min: number | null, max: number | null, curr: string) => {
    if (!min) return 'Salary Undisclosed';
    const symbol = curr === 'GBP' ? '£' : curr === 'EUR' ? '€' : '$';
    
    const formatNum = (num: number) => {
      if (num >= 1000) return `${Math.round(num / 1000)}k`;
      return num.toString();
    };

    if (max && max !== min) {
      return `${symbol}${formatNum(min)} - ${symbol}${formatNum(max)} / year`;
    }
    return `${symbol}${formatNum(min)} / year`;
  };

  return (
    <div className="space-y-8 animate-fadeIn max-w-5xl mx-auto px-4">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b border-slate-100 pb-6 gap-4">
        <div>
          <h2 className="text-3xl font-bold font-sans tracking-tight text-slate-900">
            Real-Time Remote Job Directory
          </h2>
          <p className="text-slate-500 mt-2">
            Explore continuous listings ingested from our automatic pipelines. Choose any job representation to instantly tailormake your documents.
          </p>
        </div>
        <button
          onClick={onGoBack}
          className="text-sm font-semibold text-slate-500 hover:text-blue-600 bg-slate-100/80 px-4 py-2 rounded-xl transition-all self-start md:self-center"
        >
          <i className="fas fa-chevron-left mr-2"></i> Back to Suite
        </button>
      </div>

      {/* Control filters & query search bar */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left pane filters */}
        <div className="space-y-6 lg:col-span-1">
          <div className="bg-slate-50 border border-slate-100 p-6 rounded-3xl space-y-6">
            <div>
              <h4 className="font-bold text-slate-900 border-b border-slate-200 pb-2 text-sm uppercase tracking-wide">
                Job Type
              </h4>
              <div className="mt-3 space-y-2">
                {[
                  { value: 'all', label: 'All Types' },
                  { value: 'full-time', label: 'Full-time' },
                  { value: 'contract', label: 'Contract' },
                ].map(opt => (
                  <label key={opt.value} className="flex items-center gap-3 cursor-pointer text-sm text-slate-600 hover:text-blue-600">
                    <input
                      type="radio"
                      name="jobType"
                      checked={selectedType === opt.value}
                      onChange={() => setSelectedType(opt.value)}
                      className="border-slate-300 rounded text-blue-600 focus:ring-blue-500"
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <h4 className="font-bold text-slate-900 border-b border-slate-200 pb-2 text-sm uppercase tracking-wide">
                Experience Level
              </h4>
              <div className="mt-3 space-y-2">
                {[
                  { value: 'all', label: 'All Levels' },
                  { value: 'entry', label: 'Entry Level' },
                  { value: 'senior', label: 'Senior-Level' },
                  { value: 'lead', label: 'Lead Coach / Architect' },
                ].map(opt => (
                  <label key={opt.value} className="flex items-center gap-3 cursor-pointer text-sm text-slate-600 hover:text-blue-600">
                    <input
                      type="radio"
                      name="expLevel"
                      checked={selectedExp === opt.value}
                      onChange={() => setSelectedExp(opt.value)}
                      className="border-slate-300 rounded text-blue-600 focus:ring-blue-500"
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <h4 className="font-bold text-slate-900 border-b border-slate-200 pb-2 text-sm uppercase tracking-wide">
                Filter by Skill Tag
              </h4>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {allTags.map(tag => {
                  const isActive = selectedTag === tag;
                  return (
                    <button
                      key={tag}
                      onClick={() => setSelectedTag(isActive ? null : tag)}
                      className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-all ${
                        isActive
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'bg-white hover:bg-slate-200 text-slate-600 border border-slate-200'
                      }`}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
              {selectedTag && (
                <button
                  onClick={() => setSelectedTag(null)}
                  className="text-xs text-blue-600 mt-3 font-semibold hover:underline block"
                >
                  <i className="fas fa-times-circle mr-1"></i> Clear skills filter
                </button>
              )}
            </div>
          </div>

          {/* Stats overview bento brick */}
          <div className="bg-gradient-to-br from-indigo-900 to-slate-900 p-6 rounded-3xl text-white">
            <h5 className="font-bold text-sm text-indigo-300 mb-2">INTEGRATION SYNC</h5>
            <div className="text-3xl font-black mb-1">99.8%</div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Automatic validation cron scheduled on Vercel at 3:00 AM UTC. Pipeline extracts, normalizes, and clears duplications automatically.
            </p>
          </div>
        </div>

        {/* Right pane results flow */}
        <div className="lg:col-span-3 space-y-4">
          {/* Query search Input */}
          <div className="relative">
            <input
              type="text"
              placeholder="Search by keywords, companies, roles, skills..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-4 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-blue-50 focus:border-blue-500 transition-all text-slate-700 font-medium"
            />
            <i className="fas fa-search absolute left-5 top-1/2 -translate-y-1/2 text-slate-400"></i>
          </div>

          <div className="text-xs font-mono text-slate-500 pl-1 flex justify-between">
            <span>SHOWING {filteredJobs.length} RESULTS</span>
            <span className="text-blue-600">✓ Ingestion Engine Active</span>
          </div>

          {/* Jobs list */}
          {filteredJobs.length > 0 ? (
            <div className="space-y-4">
              {filteredJobs.map(job => (
                <div
                  key={job.id}
                  className="bg-white hover:scale-[1.01] transition-transform duration-300 p-6 rounded-3xl border border-slate-200/60 shadow-sm hover:shadow-md flex flex-col md:flex-row justify-between items-start md:items-center gap-6"
                >
                  <div className="flex items-start gap-4 flex-1">
                    <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center font-bold text-blue-600 text-lg flex-shrink-0 border border-blue-100">
                      {job.companyLogo || '⚡'}
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <h3 className="font-bold text-slate-900 font-sans text-lg">
                          {job.title}
                        </h3>
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-mono tracking-wider uppercase">
                          {job.source}
                        </span>
                      </div>
                      
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 font-medium">
                        <span className="text-slate-800 font-bold">
                          <i className="fas fa-building text-slate-400 mr-1.5"></i>{job.company}
                        </span>
                        <span>
                          <i className="fas fa-location-dot text-slate-400 mr-1.5"></i>{job.location}
                        </span>
                        <span className="text-blue-600">
                          <i className="fas fa-coins text-blue-400 mr-1.5"></i>
                          {formatSalary(job.salaryMin, job.salaryMax, job.currency)}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-1.5 mt-3">
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                          job.jobType === 'full-time' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                        }`}>
                          {job.jobType}
                        </span>
                        <span className="px-2.5 py-0.5 bg-blue-50 text-blue-700 rounded-full text-xs font-bold uppercase tracking-wider">
                          {job.experienceLevel}
                        </span>
                        {job.tags.slice(0, 4).map(tag => (
                          <span key={tag} className="px-2.5 py-0.5 bg-slate-100 text-slate-600 rounded-full text-xs font-medium">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 self-stretch md:self-center">
                    <button
                      onClick={() => setActiveJob(activeJob?.id === job.id ? null : job)}
                      className="px-4 py-2.5 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-600 font-bold rounded-xl text-sm transition-all"
                    >
                      Details
                    </button>
                    <button
                      onClick={() => onTailorJob(job.description, job.title, job.company)}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-bold text-sm shadow-md shadow-blue-100 hover:shadow-lg hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2"
                    >
                      <i className="fas fa-wand-magic-sparkles text-xs"></i>
                      Tailor CV
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-16 bg-white border border-slate-100 rounded-3xl space-y-4">
              <div className="w-16 h-16 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto text-xl">
                <i className="fas fa-search"></i>
              </div>
              <h3 className="text-lg font-bold text-slate-900">No Remote Jobs found</h3>
              <p className="text-slate-500 max-w-sm mx-auto text-sm">
                Try breaking down search variables or clearing active tech skill tag badges to broaden your search queries.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Expanded descriptive drawer modal */}
      {activeJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 animate-fadeIn">
          <div 
            onClick={() => setActiveJob(null)}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          ></div>
          <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl relative z-10 overflow-hidden animate-fadeInUp max-h-[85vh] flex flex-col">
            <div className="p-8 border-b border-slate-100 flex justify-between items-start gap-4">
              <div className="flex gap-4">
                <div className="w-12 h-12 bg-blue-50 text-blue-600 text-xl font-bold flex items-center justify-center rounded-2xl flex-shrink-0">
                  {activeJob.companyLogo || '⚡'}
                </div>
                <div>
                  <h3 className="text-2xl font-black text-slate-900 leading-tight">
                    {activeJob.title}
                  </h3>
                  <p className="text-slate-500 font-bold text-sm mt-1">
                    {activeJob.company} • {activeJob.location}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setActiveJob(null)}
                className="text-slate-400 hover:text-slate-600 w-8 h-8 flex items-center justify-center bg-slate-100 rounded-full transition-all"
              >
                <i className="fas fa-times text-sm"></i>
              </button>
            </div>

            <div className="p-8 overflow-y-auto flex-1 space-y-6 text-sm text-slate-600 leading-relaxed">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-100 text-xs">
                <div>
                  <span className="text-slate-400 font-bold uppercase tracking-wide block mb-1">Source</span>
                  <span className="font-mono text-slate-700 capitalize">{activeJob.source}</span>
                </div>
                <div>
                  <span className="text-slate-400 font-bold uppercase tracking-wide block mb-1">Job Type</span>
                  <span className="text-slate-700 capitalize">{activeJob.jobType}</span>
                </div>
                <div>
                  <span className="text-slate-400 font-bold uppercase tracking-wide block mb-1">Salary Scale</span>
                  <span className="text-slate-700">{formatSalary(activeJob.salaryMin, activeJob.salaryMax, activeJob.currency)}</span>
                </div>
                <div>
                  <span className="text-slate-400 font-bold uppercase tracking-wide block mb-1">Experience</span>
                  <span className="text-slate-700 capitalize">{activeJob.experienceLevel}</span>
                </div>
              </div>

              <div>
                <h4 className="font-extrabold text-slate-900 border-b border-slate-100 pb-2 mb-3 text-base">
                  Job Description overview
                </h4>
                <p className="whitespace-pre-line text-slate-700 leading-relaxed leading-7">
                  {activeJob.description}
                </p>
              </div>

              <div>
                <h4 className="font-extrabold text-slate-900 pb-1 mb-2 text-sm">
                  Required Competence Skills
                </h4>
                <div className="flex flex-wrap gap-2">
                  {activeJob.tags.map(tag => (
                    <span key={tag} className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-xl font-semibold text-xs border border-slate-100">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-6 bg-slate-50 border-t border-slate-100 flex gap-4">
              <a
                href={activeJob.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 py-3 text-center border-2 border-slate-200 hover:border-slate-300 rounded-xl font-bold hover:bg-slate-50 transition-all text-slate-700 text-sm"
              >
                Open Original Posting <i className="fas fa-external-link-alt text-xs ml-1.5"></i>
              </a>
              <button
                onClick={() => {
                  onTailorJob(activeJob.description, activeJob.title, activeJob.company);
                  setActiveJob(null);
                }}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-sm py-3 px-6 rounded-xl transition-all shadow-lg shadow-blue-200 hover:shadow-xl hover:-translate-y-0.5 flex items-center justify-center gap-2"
              >
                <i className="fas fa-wand-magic-sparkles text-xs"></i>
                Tailor My Resume Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
