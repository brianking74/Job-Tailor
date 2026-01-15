
import React from 'react';
import { AppStep } from '../types';

interface StepIndicatorProps {
  currentStep: AppStep;
}

const steps = [
  { id: AppStep.UPLOAD_CV, label: 'Upload CV', icon: 'fa-file-arrow-up' },
  { id: AppStep.JOB_DETAILS, label: 'Job Description', icon: 'fa-align-left' },
  { id: AppStep.ANALYSIS, label: 'ATS Analysis', icon: 'fa-chart-simple' },
  { id: AppStep.TAILORING, label: 'Tailored Assets', icon: 'fa-wand-magic-sparkles' },
  { id: AppStep.OUTREACH, label: 'Send Outreach', icon: 'fa-paper-plane' },
];

export const StepIndicator: React.FC<StepIndicatorProps> = ({ currentStep }) => {
  const currentIndex = steps.findIndex(s => s.id === currentStep);

  return (
    <div className="mb-12">
      <div className="flex justify-between relative">
        <div className="absolute top-1/2 left-0 w-full h-0.5 bg-slate-200 -z-10 -translate-y-1/2"></div>
        <div 
          className="absolute top-1/2 left-0 h-0.5 bg-indigo-600 -z-10 -translate-y-1/2 transition-all duration-500"
          style={{ width: `${(currentIndex / (steps.length - 1)) * 100}%` }}
        ></div>
        
        {steps.map((step, idx) => {
          const isActive = step.id === currentStep;
          const isCompleted = idx < currentIndex;
          
          return (
            <div key={step.id} className="flex flex-col items-center">
              <div 
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 border-2 ${
                  isActive 
                    ? 'bg-indigo-600 border-indigo-600 text-white scale-110 shadow-lg shadow-indigo-200' 
                    : isCompleted
                      ? 'bg-indigo-100 border-indigo-600 text-indigo-600'
                      : 'bg-white border-slate-200 text-slate-400'
                }`}
              >
                {isCompleted ? <i className="fas fa-check"></i> : <i className={`fas ${step.icon}`}></i>}
              </div>
              <span className={`mt-2 text-xs font-semibold ${isActive ? 'text-indigo-600' : 'text-slate-500'}`}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
