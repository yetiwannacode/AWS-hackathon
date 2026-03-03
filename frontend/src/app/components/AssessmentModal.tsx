import React, { useState, useEffect } from 'react';
import { X, Clock, CheckCircle, AlertCircle, Eye, Lightbulb } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';

interface AssessmentModalProps {
    isOpen: boolean;
    onClose: () => void;
    level: number;
    sessionId: string;
    onComplete: () => void;
}

interface Question {
    id: number;
    question: string;
    options?: string[]; // MCQs
    correct_answer?: string; // MCQs
    type?: 'mcq' | 'short_answer';
    hints?: string[];
}

interface Result {
    passed: boolean;
    xp_gained: number;
    new_total_xp: number;
    unlocked_level: number;
    score: number;
}

const normalizeText = (value?: string) =>
    (value || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/^[a-d][\)\.\:\-\s]+/i, '')
        .trim();

const getAnswerLetter = (value?: string): string | null => {
    if (!value) return null;
    const trimmed = value.trim();
    if (/^[a-d]$/i.test(trimmed)) {
        return trimmed.toUpperCase();
    }
    const match = trimmed.match(/^([a-d])[\)\.\:\-\s]/i);
    return match ? match[1].toUpperCase() : null;
};

const isAnswerCorrect = (question: Question, selectedAnswer: string) => {
    if (!question.correct_answer) {
        if (question.type === 'short_answer') {
            return (selectedAnswer || '').trim().length > 5;
        }
        return false;
    }

    const selectedNormalized = normalizeText(selectedAnswer);
    const correctNormalized = normalizeText(question.correct_answer);

    if (selectedNormalized === correctNormalized) {
        return true;
    }

    if (!question.options || question.options.length === 0) {
        return false;
    }

    const correctLetter = getAnswerLetter(question.correct_answer);
    if (correctLetter) {
        const optionIndex = correctLetter.charCodeAt(0) - 65; // A=0, B=1...
        if (optionIndex >= 0 && optionIndex < question.options.length) {
            return normalizeText(question.options[optionIndex]) === selectedNormalized;
        }
    }

    const matchingOption = question.options.find(
        (option) => normalizeText(option) === correctNormalized
    );
    return matchingOption ? normalizeText(matchingOption) === selectedNormalized : false;
};

const resolveCorrectOptionText = (question: Question) => {
    if (!question.correct_answer || !question.options?.length) {
        return question.correct_answer || '';
    }

    const letter = getAnswerLetter(question.correct_answer);
    if (!letter) return question.correct_answer;

    const idx = letter.charCodeAt(0) - 65;
    if (idx >= 0 && idx < question.options.length) {
        return question.options[idx];
    }
    return question.correct_answer;
};

export const AssessmentModal: React.FC<AssessmentModalProps> = ({
    isOpen,
    onClose,
    level,
    sessionId,
    onComplete
}) => {
    const authHeaders = () => {
        const token = localStorage.getItem('cote_auth_token');
        return token ? { Authorization: `Bearer ${token}` } : {};
    };

    const [loading, setLoading] = useState(false);
    const [questions, setQuestions] = useState<Question[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});
    const [timer, setTimer] = useState(600); // 10 minutes
    const [result, setResult] = useState<Result | null>(null);
    const [isReviewMode, setIsReviewMode] = useState(false);
    const [feedback, setFeedback] = useState<{ type: 'success' | 'error', message: string } | null>(null);
    const [wrongQuestions, setWrongQuestions] = useState<any[]>([]);

    // Hint State
    const [userXP, setUserXP] = useState(0);
    const [unlockedHints, setUnlockedHints] = useState<number>(0); // 0, 1, 2, 3

    useEffect(() => {
        if (isOpen && level && sessionId) {
            loadAssessment();
            loadXP();
        } else {
            // Reset state on close
            setQuestions([]);
            setCurrentIndex(0);
            setUserAnswers({});
            setResult(null);
            setIsReviewMode(false);
            setTimer(600);
            setUnlockedHints(0);
        }
    }, [isOpen, level, sessionId]);

    // Reset hints on question change
    useEffect(() => {
        setUnlockedHints(0);
    }, [currentIndex]);

    // Timer Logic
    useEffect(() => {
        if (!isOpen || result || loading) return;

        const interval = setInterval(() => {
            setTimer(prev => {
                if (prev <= 1) {
                    clearInterval(interval);
                    submitAssessment(); // Auto-submit on timeout
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [isOpen, result, loading]);

    const loadXP = async () => {
        try {
            const res = await fetch(`http://localhost:8000/api/progress/${sessionId}`, {
                headers: authHeaders()
            });
            const data = await res.json();
            setUserXP(data.xp || 0);
        } catch (e) {
            console.error("Failed to load XP");
        }
    };

    const handleUnlockHint = async () => {
        const currentQ = questions[currentIndex];
        if (!currentQ.hints || unlockedHints >= currentQ.hints.length) return;

        let cost = 0;
        if (unlockedHints === 0) cost = 0;       // 1st Hint Free
        else if (unlockedHints === 1) cost = 5;  // 2nd Hint 5 XP
        else if (unlockedHints === 2) cost = 10; // 3rd Hint 10 XP

        if (cost > 0) {
            if (userXP < cost) {
                toast.error(`Not enough XP! You need ${cost} XP.`);
                return;
            }

            // Deduct XP
            try {
                const res = await fetch('http://localhost:8000/api/spend_xp', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...authHeaders() },
                    body: JSON.stringify({ session_id: sessionId, amount: cost })
                });
                const data = await res.json();
                if (!data.success) {
                    toast.error(data.message || "Failed to spend XP");
                    return;
                }
                setUserXP(prev => prev - cost);
                toast.success(`Spent ${cost} XP for a hint!`);
            } catch (e) {
                toast.error("Network error spending XP");
                return;
            }
        }

        setUnlockedHints(prev => prev + 1);
    };

    const loadAssessment = async () => {
        setLoading(true);
        try {
            const res = await fetch('http://localhost:8000/api/assessment/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({ session_id: sessionId, level })
            });
            const data = await res.json();

            if (data.questions) {
                setQuestions(data.questions);
            }
        } catch (error) {
            toast.error("Failed to load assessment.");
        } finally {
            setLoading(false);
        }
    };

    const handleAnswerInitial = (answer: string) => {
        if (result || feedback) return; // Prevent multiple clicks

        const currentQ = questions[currentIndex];
        const isCorrect = isAnswerCorrect(currentQ, answer);

        setUserAnswers(prev => ({
            ...prev,
            [currentQ.id]: answer
        }));

        if (isCorrect) {
            setFeedback({ type: 'success', message: 'good work! +10 XP' });
        } else {
            setFeedback({ type: 'error', message: 'got it wrong, but its okay keep going!' });
            setWrongQuestions(prev => [...prev, {
                question: currentQ.question,
                correct_answer: resolveCorrectOptionText(currentQ),
                explanation: (currentQ as any).explanation,
                user_answer: answer
            }]);
        }

        // Auto-transition
        setTimeout(() => {
            setFeedback(null);
            if (currentIndex < questions.length - 1) {
                setCurrentIndex(prev => prev + 1);
            } else {
                submitAssessment();
            }
        }, 2000);
    };

    const submitAssessment = async () => {
        setLoading(true);
        // Calculate basic score locally for display, strict validation happens backend
        let score = 0;
        questions.forEach(q => {
            if (isAnswerCorrect(q, userAnswers[q.id])) {
                score++;
            } else if (q.type === 'short_answer' && userAnswers[q.id]?.length > 5) {
                // Heuristic for open ended
                score++;
            }
        });

        try {
            const res = await fetch('http://localhost:8000/api/assessment/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({
                    session_id: sessionId,
                    level,
                    score,
                    max_score: questions.length,
                    mistakes: wrongQuestions
                })
            });
            const data = await res.json();
            setResult(data);
        } catch (error) {
            toast.error("Failed to submit assessment.");
        } finally {
            setLoading(false);
        }
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 backdrop-blur-md">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-card w-full max-w-3xl h-[80vh] rounded-2xl border border-border shadow-2xl flex flex-col overflow-hidden"
            >
                {/* HEADER */}
                <div className="p-6 border-b border-border flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-bold">Level {level} Assessment</h2>
                        {!result && <p className="text-sm text-muted-foreground">Question {currentIndex + 1} of {questions.length}</p>}
                    </div>
                    <div className="flex items-center gap-4">
                        {!result && (
                            <div className={`flex items-center gap-2 font-mono font-bold text-lg ${timer < 60 ? 'text-destructive animate-pulse' : 'text-primary'}`}>
                                <Clock size={20} />
                                {formatTime(timer)}
                            </div>
                        )}
                        <button onClick={onClose} className="p-2 hover:bg-accent rounded-full">
                            <X size={24} />
                        </button>
                    </div>
                </div>

                {/* CONTENT */}
                <div className="flex-1 p-8 overflow-y-auto">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center h-full gap-4">
                            <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                            <p>Loading your quest...</p>
                        </div>
                    ) : result && !isReviewMode ? (
                        <div className="flex flex-col items-center justify-center h-full text-center space-y-6">
                            <motion.div
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                className={`w-24 h-24 rounded-full flex items-center justify-center ${result.passed ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}
                            >
                                {result.passed ? <Trophy size={48} /> : <AlertCircle size={48} />}
                            </motion.div>

                            <div>
                                <h3 className="text-3xl font-black mb-2">{result.passed ? 'Level Complete!' : 'Try Again'}</h3>
                                <div className="flex justify-center gap-8 my-6">
                                    <div className="text-center">
                                        <div className="text-4xl font-black text-green-500">{result.score || (questions.length - wrongQuestions.length)}</div>
                                        <div className="text-sm text-muted-foreground uppercase font-bold tracking-wider">Correct</div>
                                    </div>
                                    <div className="text-center">
                                        <div className="text-4xl font-black text-red-500">{wrongQuestions.length}</div>
                                        <div className="text-sm text-muted-foreground uppercase font-bold tracking-wider">Mistakes</div>
                                    </div>
                                    <div className="text-center">
                                        <div className="text-4xl font-black text-yellow-500">+{result.xp_gained}</div>
                                        <div className="text-sm text-muted-foreground uppercase font-bold tracking-wider">XP</div>
                                    </div>
                                </div>
                                <p className="text-muted-foreground max-w-md mx-auto">
                                    {result.passed
                                        ? `You've earned ${result.xp_gained} XP and unlocked the next challenge!`
                                        : "Don't give up! Review your answers and try again to improve."}
                                </p>
                            </div>

                            <div className="flex gap-4">
                                <button
                                    onClick={() => setIsReviewMode(true)}
                                    className="px-6 py-3 rounded-xl border border-border hover:bg-accent flex items-center gap-2 font-semibold"
                                >
                                    <Eye size={18} /> Review Answers
                                </button>
                                <button
                                    onClick={onComplete}
                                    className="px-6 py-3 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 font-bold"
                                >
                                    Continue
                                </button>
                            </div>
                        </div>
                    ) : isReviewMode ? (
                        <div className="space-y-8">
                            {questions.map((q, idx) => {
                                const userAnswer = userAnswers[q.id];
                                const isCorrect = isAnswerCorrect(q, userAnswer || '');
                                const resolvedCorrectAnswer = resolveCorrectOptionText(q);
                                return (
                                    <div key={q.id} className={`p-6 rounded-xl border ${isCorrect ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
                                        <div className="flex gap-3 mb-4">
                                            <span className="font-bold text-muted-foreground">#{idx + 1}</span>
                                            <h4 className="font-semibold text-lg">{q.question}</h4>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-8">
                                            {q.options?.map((opt) => (
                                                <div
                                                    key={opt}
                                                    className={`p-3 rounded-lg border text-sm font-medium
                                                        ${normalizeText(opt) === normalizeText(resolvedCorrectAnswer) ? 'bg-green-500 text-white border-green-600' :
                                                            opt === userAnswer ? 'bg-red-500 text-white border-red-600' : 'bg-card border-border opacity-50'}
                                                    `}
                                                >
                                                    {opt}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                            <div className="flex justify-center pt-8">
                                <button
                                    onClick={onComplete}
                                    className="px-8 py-3 bg-primary text-primary-foreground rounded-xl font-bold"
                                >
                                    Back to Map
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="max-w-2xl mx-auto">
                            {questions.length > 0 && (
                                <AnimatePresence mode='wait'>
                                    <motion.div
                                        key={questions[currentIndex].id}
                                        initial={{ opacity: 0, x: 20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: -20 }}
                                        className="space-y-8 relative"
                                    >
                                        <AnimatePresence>
                                            {feedback && (
                                                <motion.div
                                                    initial={{ opacity: 0, y: 10, scale: 0.9 }}
                                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                                    exit={{ opacity: 0, scale: 0.9 }}
                                                    className={`absolute -top-12 left-1/2 -translate-x-1/2 px-6 py-2 rounded-full font-bold text-white shadow-lg z-20 whitespace-nowrap ${feedback.type === 'success' ? 'bg-green-500' : 'bg-red-500'
                                                        }`}
                                                >
                                                    {feedback.message}
                                                </motion.div>
                                            )}
                                        </AnimatePresence>

                                        <h3 className="text-2xl font-bold leading-relaxed">
                                            {questions[currentIndex].question}
                                        </h3>

                                        <div className="space-y-3">
                                            {questions[currentIndex].options?.map((option) => (
                                                <button
                                                    key={option}
                                                    onClick={() => handleAnswerInitial(option)}
                                                    disabled={!!feedback}
                                                    className={`w-full text-left p-4 rounded-xl border-2 transition-all font-medium text-lg flex items-center justify-between
                                                        ${userAnswers[questions[currentIndex].id] === option
                                                            ? (feedback?.type === 'success' ? 'border-green-500 bg-green-500/10 text-green-500' :
                                                                feedback?.type === 'error' && userAnswers[questions[currentIndex].id] === option ? 'border-red-500 bg-red-500/10 text-red-500' :
                                                                    'border-primary bg-primary/10 text-primary')
                                                            : 'border-border hover:border-primary/50 hover:bg-accent'}`}
                                                >
                                                    {option}
                                                    {userAnswers[questions[currentIndex].id] === option && (
                                                        feedback?.type === 'success' ? <CheckCircle size={20} /> :
                                                            feedback?.type === 'error' ? <AlertCircle size={20} /> :
                                                                <CheckCircle size={20} />
                                                    )}
                                                </button>
                                            ))}

                                            {/* Short Answer Fallback */}
                                            {!questions[currentIndex].options && (
                                                <div className="space-y-3">
                                                    <textarea
                                                        className="w-full p-4 rounded-xl border border-border bg-background min-h-[150px] focus:ring-2 focus:ring-primary outline-none"
                                                        placeholder="Type your answer here..."
                                                        value={userAnswers[questions[currentIndex].id] || ''}
                                                        onChange={(e) => setUserAnswers(prev => ({
                                                            ...prev,
                                                            [questions[currentIndex].id]: e.target.value
                                                        }))}
                                                        disabled={!!feedback}
                                                    />
                                                    <button
                                                        onClick={() => handleAnswerInitial(userAnswers[questions[currentIndex].id] || '')}
                                                        disabled={!!feedback || !(userAnswers[questions[currentIndex].id] || '').trim()}
                                                        className="px-5 py-2 rounded-lg bg-primary text-primary-foreground font-semibold disabled:opacity-50"
                                                    >
                                                        Submit Answer
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        {/* HINT SECTION */}
                                        <div className="pt-4 border-t border-border mt-8">
                                            <div className="flex items-center justify-between mb-4">
                                                <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
                                                    <Lightbulb size={16} className={unlockedHints > 0 ? "text-yellow-500 fill-yellow-500" : ""} />
                                                    <span>Hints ({unlockedHints}/{questions[currentIndex].hints?.length || 0})</span>
                                                </div>
                                                <div className="text-xs font-mono text-muted-foreground">
                                                    XP Balance: {userXP}
                                                </div>
                                            </div>

                                            <div className="space-y-3">
                                                {questions[currentIndex].hints?.slice(0, unlockedHints).map((hint, i) => (
                                                    <motion.div
                                                        key={i}
                                                        initial={{ opacity: 0, height: 0 }}
                                                        animate={{ opacity: 1, height: 'auto' }}
                                                        className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-sm italic text-muted-foreground"
                                                    >
                                                        💡 {hint}
                                                    </motion.div>
                                                ))}
                                            </div>

                                            {unlockedHints < (questions[currentIndex].hints?.length || 0) && (
                                                <button
                                                    onClick={handleUnlockHint}
                                                    className="mt-4 text-xs font-bold px-4 py-2 rounded-full bg-secondary hover:bg-secondary/80 transition-colors flex items-center gap-2"
                                                >
                                                    Unlock Next Hint
                                                    <span className="bg-background px-2 py-0.5 rounded text-[10px] border">
                                                        {unlockedHints === 0 ? "FREE" : unlockedHints === 1 ? "5 XP" : "10 XP"}
                                                    </span>
                                                </button>
                                            )}
                                        </div>
                                    </motion.div>
                                </AnimatePresence>
                            )}
                        </div>
                    )}
                </div>

                {/* FOOTER */}
                {!result && !isReviewMode && !loading && (
                    <div className="p-4 border-t border-border bg-muted/20 text-center">
                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                            Questions auto-advance after each attempt. Back navigation is disabled.
                        </p>
                    </div>
                )}
            </motion.div>

            {/* Confetti or background particles could be added here */}
        </div>
    );
};

// Simple Trophy Icon Wrapper just in case
const Trophy = ({ size, className }: { size?: number, className?: string }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size || 24}
        height={size || 24}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
    >
        <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
        <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
        <path d="M4 22h16" />
        <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
        <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
        <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
);
