import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import WizardSteps from '@/components/wizard/WizardSteps';
import Step1Details from '@/components/wizard/Step1Details';
import Step2Uploads from '@/components/wizard/Step2Uploads';
import Step3Systems from '@/components/wizard/Step3Systems';
import Step4Checklist from '@/components/wizard/Step4Checklist';
import Step5Groups from '@/components/wizard/Step5Groups';
import Step6Review from '@/components/wizard/Step6Review';
import Step7Generate from '@/components/wizard/Step7Generate';
import { ArrowRight } from 'lucide-react';

export default function ProjectWizard() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [step, setStep] = useState(1);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    base44.entities.VehicleProject.get(id)
      .then((p) => {
        setProject(p);
        setStep(p.current_step || 1);
      })
      .catch(() => setNotFound(true));
  }, [id]);

  // שמירה אוטומטית של כל שינוי בפרויקט
  const updateProject = useCallback(
    async (patch) => {
      setProject((prev) => ({ ...prev, ...patch }));
      await base44.entities.VehicleProject.update(id, patch);
    },
    [id]
  );

  const goToStep = useCallback(
    (next) => {
      setStep(next);
      const maxReached = Math.max(project?.current_step || 1, next);
      updateProject({ current_step: maxReached });
    },
    [project, updateProject]
  );

  if (notFound) {
    return (
      <div className="text-center py-24">
        <p className="text-stone-500 mb-4">הפרויקט לא נמצא או שאין לך הרשאה אליו.</p>
        <Link to="/" className="text-stone-900 font-medium underline">חזרה לפרויקטים</Link>
      </div>
    );
  }
  if (!project) {
    return (
      <div className="flex justify-center py-24">
        <div className="w-7 h-7 border-4 border-stone-200 border-t-stone-800 rounded-full animate-spin" />
      </div>
    );
  }

  const stepProps = { project, updateProject, goToStep };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link to="/" className="text-stone-400 hover:text-stone-700 transition-colors">
          <ArrowRight className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-bold text-stone-900">
          {project.manufacturer || project.model
            ? `${project.manufacturer || ''} ${project.model || ''} ${project.model_year || ''}`
            : 'פרויקט חדש'}
        </h1>
      </div>

      <WizardSteps current={step} maxReached={project.current_step || 1} onSelect={setStep} />

      {step === 1 && <Step1Details {...stepProps} />}
      {step === 2 && <Step2Uploads {...stepProps} />}
      {step === 3 && <Step3Systems {...stepProps} />}
      {step === 4 && <Step4Checklist {...stepProps} />}
      {step === 5 && <Step5Groups {...stepProps} />}
      {step === 6 && <Step6Review {...stepProps} />}
      {step === 7 && <Step7Generate {...stepProps} />}
    </div>
  );
}