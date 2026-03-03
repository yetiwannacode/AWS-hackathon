import React, { useState, useEffect } from 'react';
import { X, Brain, CheckCircle, AlertTriangle, ArrowRight, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';

interface PracticeQuestion {
    question: string;
    options: string[];
    correct_answer: string;
    explanation: string;
}

interface RemedialPlan {
    diagnosis: string;
    explanation: string;
    practice_question: PracticeQuestion;
}

interface RemedialModalProps {
    isOpen: boolean;
    onClose: () => void;
    plan: RemedialPlan | null;
    cooldownRemaining: number;
    sessionId: string;
    onSuccess: () => void;
}

export const RemedialModal: React.FC<RemedialModalProps> = ({
    isOpen,
    onClose,
    plan,
    cooldownRemaining,
    sessionId,
    onSuccess
}: RemedialModalProps) => {
    const [selectedOption, setSelectedOption] = useState<string | null>(null);
    const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
    const [localCooldown, setLocalCooldown] = useState<number>(cooldownRemaining);
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const authHeaders = () => {
        const token = localStorage.getItem('cote_auth_token');
        return token ? { Authorization: `Bearer ${token}` } : {};
    };

    // Timer Logic
    useEffect(() => {
        if (!isOpen) return;
        setLocalCooldown(cooldownRemaining);
    }, [isOpen, cooldownRemaining]);

    useEffect(() => {
        if (!isOpen || localCooldown <= 0) return;
        const timer = setInterval(() => {
            setLocalCooldown((prev: number) => Math.max(0, prev - 1));
        }, 1000);
        return () => clearInterval(timer);
    }, [isOpen, localCooldown]);

    if (!isOpen || !plan) return null;

    const handleCheck = () => {
        if (!selectedOption || !plan.practice_question) return;
        setIsCorrect(selectedOption === plan.practice_question.correct_answer);
    };

    const handleCompleteRemedial = async () => {
        setIsSubmitting(true);
        try {
            const res = await fetch('http://localhost:8000/api/remedial/complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({ session_id: sessionId })
            });
            const data = await res.json();
            if (data.success) {
                toast.success("Remedial complete! Level unlocked.");
                onSuccess();
            } else {
                toast.error("Failed to clear cooldown.");
            }
        } catch (error) {
            toast.error("Network error.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}m ${secs}s`;
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/80 backdrop-blur-md">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-card w-full max-w-2xl max-h-[90vh] rounded-2xl border border-border shadow-2xl overflow-y-auto"
            >
                <div className="p-6 border-b border-border flex items-center justify-between bg-yellow-500/5">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg text-yellow-600 dark:text-yellow-400">
                            <Brain size={24} />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold">Educational Diagnosis</h2>
                            <p className={`text-xs font-mono font-bold ${localCooldown > 0 ? 'text-orange-500' : 'text-green-500'}`}>
                                {localCooldown > 0 ? `RETRY LOCKED: ${formatTime(localCooldown)}` : 'RETRY UNLOCKED'}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-accent rounded-full">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-8 space-y-8">
                    {/* DIAGNOSIS */}
                    <div className="space-y-2">
                        <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Analysis</h3>
                        <div className="p-4 rounded-xl border-l-4 border-yellow-500 bg-yellow-500/5">
                            <h4 className="font-bold text-lg mb-1">{plan.diagnosis}</h4>
                            <p className="text-muted-foreground leading-relaxed">{plan.explanation}</p>
                        </div>
                    </div>

                    {/* PRACTICE */}
                    {plan.practice_question && (
                        <div className="space-y-4">
                            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Quick Practice</h3>
                            <div className="p-6 rounded-2xl border border-border bg-card shadow-sm">
                                <p className="font-semibold text-lg mb-6">{plan.practice_question.question}</p>

                                <div className="space-y-3">
                                    {plan.practice_question.options?.map((opt: string) => (
                                        <button
                                            key={opt}
                                            onClick={() => {
                                                if (isCorrect !== true) {
                                                    setSelectedOption(opt);
                                                    setIsCorrect(null);
                                                }
                                            }}
                                            className={`w-full text-left p-4 rounded-xl border transition-all font-medium flex items-center justify-between
                                                ${selectedOption === opt
                                                    ? (isCorrect === true ? 'bg-green-500/10 border-green-500 text-green-600'
                                                        : isCorrect === false ? 'bg-red-500/10 border-red-500 text-red-600'
                                                            : 'bg-primary/10 border-primary text-primary')
                                                    : 'hover:bg-accent border-border'
                                                }`}
                                        >
                                            {opt}
                                            {selectedOption === opt && isCorrect === true && <CheckCircle size={18} />}
                                            {selectedOption === opt && isCorrect === false && <AlertTriangle size={18} />}
                                        </button>
                                    ))}
                                    {!plan.practice_question.options && (
                                        <p className="text-sm italic text-muted-foreground">Review the explanation above and try the quest again once the timer expires.</p>
                                    )}
                                </div>

                                {selectedOption && isCorrect === null && (
                                    <button
                                        onClick={handleCheck}
                                        className="mt-6 w-full py-3 bg-primary text-primary-foreground font-bold rounded-xl shadow-lg hover:shadow-primary/20 transition-all"
                                    >
                                        Check Answer
                                    </button>
                                )}

                                <AnimatePresence>
                                    {isCorrect === true && (
                                        <motion.div
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            className="mt-6"
                                        >
                                            <div className="p-4 bg-green-500/10 text-green-600 rounded-xl mb-4 border border-green-500/20">
                                                <strong>Great Fix!</strong> {plan.practice_question.explanation}
                                            </div>
                                            <button
                                                onClick={handleCompleteRemedial}
                                                disabled={isSubmitting}
                                                className="w-full py-4 bg-green-600 text-white font-black rounded-xl shadow-xl hover:bg-green-700 transition-all flex items-center justify-center gap-2"
                                            >
                                                {isSubmitting ? <Loader2 className="animate-spin" /> : <>Continue to Quest <ArrowRight size={20} /></>}
                                            </button>
                                        </motion.div>
                                    )}

                                    {isCorrect === false && (
                                        <motion.div
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            className="mt-6 p-4 bg-red-500/10 text-red-600 rounded-xl border border-red-500/20"
                                        >
                                            <strong>Not quite.</strong> Look at the diagnosis again and try one more time!
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </div>
                    )}
                </div>
            </motion.div>
        </div>
    );
};
